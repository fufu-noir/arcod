/**
 * Process Job Lambda Function
 * Triggered by DynamoDB Stream when a new job is created
 * Downloads tracks from Qobuz, processes them, and uploads to S3
 */
import type { DynamoDBStreamEvent, DownloadJob, AlbumInfo, TrackInfo } from './types.js';
import { getJobById, updateJob, updateDownloadLog } from './dynamodb.js';
import { uploadToS3, getContentType } from './s3.js';
import { getAlbumInfoFromQobuz, getTrackFileUrl } from './qobuz-api.js';
import axios, { AxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { unmarshall } from '@aws-sdk/util-dynamodb';

// We'll use archiver for ZIP creation
import archiver from 'archiver';

const MAX_DOWNLOAD_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000;
const CONCURRENCY = 3;

const REGION_NAME = 'Stockholm';
const LYRICS_SERVICE_URL = process.env.LYRICS_SERVICE_URL || 'https://lyrics-service-1012349904662.europe-west1.run.app';

// Codec mapping
const codecMap: Record<string, { extension: string; contentType: string }> = {
    FLAC: { extension: 'flac', contentType: 'audio/flac' },
    WAV: { extension: 'wav', contentType: 'audio/wav' },
    ALAC: { extension: 'm4a', contentType: 'audio/mp4' },
    MP3: { extension: 'mp3', contentType: 'audio/mpeg' },
    AAC: { extension: 'm4a', contentType: 'audio/mp4' },
    OPUS: { extension: 'opus', contentType: 'audio/opus' }
};

// Caches
const lyricsCache = new Map<string, string | null>();
const lyricsPendingPromises = new Map<string, Promise<string | null>>();

/**
 * DynamoDB Stream handler
 */
export async function handler(event: DynamoDBStreamEvent): Promise<void> {
    for (const record of event.Records) {
        if (record.eventName !== 'INSERT') continue;
        if (!record.dynamodb?.NewImage) continue;

        // Unmarshall the DynamoDB record
        const job = unmarshall(record.dynamodb.NewImage) as DownloadJob;

        // Only process pending jobs
        if (job.status !== 'pending') {
            console.log(`Job ${job.id} is not pending (${job.status}), skipping`);
            continue;
        }

        // Process the job
        await processJob(job);
    }
}

/**
 * Main job processing function
 */
async function processJob(job: DownloadJob): Promise<void> {
    const jobId = job.id;
    const tempDir = path.join(os.tmpdir(), `qobuz-${jobId}`);

    // Add small jitter to avoid simultaneous API bursts
    const jitter = Math.random() * 3000;
    await sleep(jitter);

    console.log(`[${jobId}] Starting job processing...`);

    try {
        // Mark as processing
        await updateJob(jobId, {
            status: 'processing',
            description: `Démarrage du traitement...`
        });

        // 1. FETCH METADATA (Always fetch fresh to ensure correctness)
        let albumInfo: AlbumInfo;
        try {
            console.log(`[${jobId}] Fetching album info from Qobuz...`);
            albumInfo = await getAlbumInfoFromQobuz(job.albumId, job.country);
        } catch (e: any) {
            throw new Error(`Erreur lors de la récupération des infos Qobuz: ${e.message}`);
        }

        if (!albumInfo || !albumInfo.tracks?.items) {
            throw new Error("Structure de l'album invalide ou vide reçue de Qobuz");
        }

        const artistName = albumInfo.artist?.name || 'Unknown Artist';
        const albumTitle = albumInfo.title || 'Unknown Album';
        const coverUrl = albumInfo.image?.large || albumInfo.image?.small || '';

        // 2. UPDATE PERSISTENCE (Job & Logs)
        console.log(`[${jobId}] Persisting metadata: ${artistName} - ${albumTitle}`);

        await updateJob(jobId, {
            albumTitle,
            artistName,
            trackCount: albumInfo.tracks.items.length,
            albumInfo: JSON.stringify(albumInfo)
        });

        if (job.logId) {
            // Updated simplified info for library view
            const simplifiedInfo = {
                id: albumInfo.id,
                title: albumTitle,
                artist: artistName,
                coverUrl: coverUrl,
                quality: job.settings.quality === 27 ? 'Hi-Res' : (job.settings.quality >= 6 ? 'CD' : 'MP3')
            };

            await updateDownloadLog(job.logId, {
                albumTitle,
                artistName,
                albumInfo: JSON.stringify(simplifiedInfo)
            });
        }

        // 3. DOWNLOAD
        await processAlbumDownload(jobId, albumInfo, job.settings, job.country, job.trackId, tempDir, job.logId);

        console.log(`[${jobId}] Completed successfully`);

    } catch (error: any) {
        console.error(`[${jobId}] Failed:`, error);

        const errorMessage = error.message || 'Unknown error';

        await updateJob(jobId, {
            status: 'failed',
            description: 'Échec: ' + errorMessage.substring(0, 100),
            error: errorMessage
        });
    } finally {
        cleanup(tempDir);
    }
}

/**
 * Main album download processing
 */
async function processAlbumDownload(
    jobId: string,
    albumInfo: AlbumInfo,
    settings: DownloadJob['settings'],
    country?: string,
    trackId?: string | number | null,
    tempDir?: string,
    logId?: string
): Promise<void> {
    const workDir = tempDir || path.join(os.tmpdir(), `qobuz-${jobId}`);
    fs.mkdirSync(workDir, { recursive: true });

    // Filter tracks
    let tracks: TrackInfo[] = [];
    if (albumInfo.tracks && albumInfo.tracks.items) {
        tracks = albumInfo.tracks.items.filter((t: TrackInfo) => t.streamable !== false);
    } else {
        throw new Error("Pas de pistes trouvées dans l'album");
    }

    // Filter to single track if specified
    if (trackId !== undefined && trackId !== null) {
        const trackIdStr = String(trackId);
        tracks = tracks.filter((t: TrackInfo) => String(t.id) === trackIdStr);
        if (tracks.length === 0) {
            throw new Error(`Piste ${trackId} introuvable dans l'album`);
        }
    }

    if (tracks.length === 0) {
        throw new Error("Aucune piste téléchargeable trouvée");
    }

    await updateJob(jobId, {
        status: 'downloading',
        progress: 5,
        description: `Téléchargement de ${tracks.length} pistes...`
    });

    // Prefetch lyrics
    if (settings.embedLyrics !== false) {
        prefetchAllLyrics(tracks, albumInfo).catch(err =>
            console.warn('[Lyrics] Prefetch error (non-blocking):', err)
        );
    }

    // Process tracks
    const processedFiles: string[] = [];
    let completed = 0;

    for (let i = 0; i < tracks.length; i += CONCURRENCY) {
        // Check cancel
        const currentJob = await getJobById(jobId);
        if (currentJob?.status === 'cancelled') {
            console.log(`Job ${jobId} was cancelled`);
            return;
        }

        const batch = tracks.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
            batch.map(async (track) => {
                try {
                    const files = await downloadAndProcessTrack(
                        track,
                        albumInfo,
                        settings,
                        workDir,
                        country
                    );
                    completed++;
                    const progress = 5 + Math.floor((completed / tracks.length) * 70);

                    // Don't await status update for every track if concurrency is high, to avoid DDOSing DynamoDB
                    updateJob(jobId, { // fire & forget update
                        progress,
                        description: `Téléchargé ${completed}/${tracks.length}: ${track.title}`
                    }).catch(() => { });

                    return files;
                } catch (error) {
                    console.error(`Failed to process track ${track.id}:`, error);
                    // Non-fatal error for individual tracks, but warn
                    return null;
                }
            })
        );

        for (const result of results) {
            if (result) processedFiles.push(...result);
        }
    }

    if (processedFiles.length === 0) {
        throw new Error('Aucun fichier n\'a pu être téléchargé. Vérifiez la disponibilité régionale.');
    }

    // Upload to S3
    let publicUrl: string;
    let fileName: string;
    let fileSize: number;

    if (processedFiles.length === 1) {
        // Single file
        await updateJob(jobId, { progress: 90, description: 'Envoi du fichier...' });

        fileName = path.basename(processedFiles[0]);
        const s3Key = `downloads/${jobId}/${fileName}`;

        publicUrl = await uploadToS3(
            processedFiles[0],
            s3Key,
            getContentType(settings.format, settings.quality)
        );
        fileSize = fs.statSync(processedFiles[0]).size;

    } else {
        // ZIP
        await updateJob(jobId, { progress: 85, description: 'Création de l\'archive ZIP...' });

        const albumName = sanitizeFileName(`${albumInfo.artist?.name || 'Unknown'} - ${albumInfo.title}`);
        fileName = `${albumName}.zip`;
        const zipPath = path.join(workDir, fileName);

        await createZipArchive(processedFiles, zipPath, albumName);

        await updateJob(jobId, { progress: 95, description: 'Envoi de l\'archive...' });

        const s3Key = `downloads/${jobId}/${fileName}`;
        publicUrl = await uploadToS3(zipPath, s3Key, 'application/zip');
        fileSize = fs.statSync(zipPath).size;
    }

    // Mark as completed
    await updateJob(jobId, {
        status: 'completed',
        progress: 100,
        description: 'Terminé !',
        downloadUrl: publicUrl,
        fileName,
        fileSize,
    });

    // Final Log Update
    if (logId) {
        await updateDownloadLog(logId, {
            fileSize,
            downloadUrl: publicUrl
        });
    }

    console.log(`Job ${jobId} completed with URL: ${publicUrl}`);
}

async function downloadAndProcessTrack(
    track: TrackInfo,
    albumInfo: AlbumInfo,
    settings: DownloadJob['settings'],
    tempDir: string,
    country?: string
): Promise<string[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
        try {
            const { url } = await getTrackFileUrl(track.id.toString(), settings.quality, country);

            const outputExtension = getOutputExtension(settings.format, settings.quality);
            const fileName = formatTrackFileName(
                track.track_number,
                track.title,
                track.performer?.name || albumInfo.artist?.name || 'Unknown',
                outputExtension,
                track.version
            );
            const filePath = path.join(tempDir, fileName);

            // Download
            const response = await axios({
                method: 'get',
                url,
                responseType: 'stream',
                timeout: 300000
            });

            await new Promise<void>((resolve, reject) => {
                const writer = fs.createWriteStream(filePath);
                response.data.pipe(writer);
                writer.on('finish', () => resolve());
                writer.on('error', reject);
            });

            if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                throw new Error("File empty or not created");
            }

            // Lyrics
            const outputFiles: string[] = [filePath];
            if (settings.embedLyrics !== false && settings.lyricsMode === 'sidecar') {
                const lrcPath = await saveLyricsToFile(track, albumInfo, filePath);
                if (lrcPath) outputFiles.push(lrcPath);
            }

            return outputFiles;

        } catch (error: any) {
            lastError = error;
            console.error(`[Track ${track.id}] Attempt ${attempt} failed:`, error.message);

            if (error.response?.status === 403 || error.response?.status === 404) {
                throw new Error("Track not accessible (403/404)");
            }

            if (attempt < MAX_DOWNLOAD_RETRIES) {
                await sleep(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1));
            }
        }
    }
    throw lastError || new Error(`Failed to download track ${track.id}`);
}

// ==================== Helper Functions ====================

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\.+$/, '').trim();
}

function formatTrackFileName(
    trackNumber: number,
    title: string,
    artist: string,
    format: string,
    version?: string | null
): string {
    const num = trackNumber.toString().padStart(2, '0');
    const titleWithVersion = version ? `${title} (${version})` : title;
    return `${num} - ${sanitizeFileName(artist)} - ${sanitizeFileName(titleWithVersion)}.${format}`;
}

function getSourceExtensionFromQuality(quality: number | string): string {
    const qualityNum = typeof quality === 'string' ? parseInt(quality, 10) : quality;
    return qualityNum === 5 ? 'mp3' : 'flac';
}

function getOutputExtension(format: string | undefined, quality: number | string): string {
    const normalizedFormat = format?.toUpperCase();
    if (normalizedFormat && codecMap[normalizedFormat]) {
        return codecMap[normalizedFormat].extension;
    }
    return getSourceExtensionFromQuality(quality);
}

function cleanup(dir: string): void {
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}

async function createZipArchive(
    files: string[],
    outputPath: string,
    folderName: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 0 } });

        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);

        files.forEach(file => {
            if (fs.existsSync(file)) {
                archive.file(file, { name: `${folderName}/${path.basename(file)}` });
            }
        });
        archive.finalize();
    });
}

// ==================== Lyrics Functions (Simplified) ====================

function cleanForSearch(text: string): string {
    return text.replace(/\s*\(feat\..*?\)/gi, '').replace(/\s*\[.*?\]/g, '').trim();
}

async function prefetchAllLyrics(tracks: TrackInfo[], albumInfo: AlbumInfo): Promise<void> {
    // Only prefetch a few to avoid spamming
    // Implementation kept minimal for stability
    const promises = tracks.slice(0, 5).map(track => {
        const artist = track.performer?.name || albumInfo.artist?.name || 'Unknown';
        return fetchLyrics(track.title, artist, albumInfo.title, track.duration);
    });
    await Promise.allSettled(promises);
}

async function fetchLyrics(title: string, artist: string, album: string, duration: number): Promise<string | null> {
    const key = `${title}-${artist}`;
    if (lyricsCache.has(key)) return lyricsCache.get(key) || null;

    try {
        const res = await axios.post(
            `${LYRICS_SERVICE_URL}/lyrics`,
            { title: cleanForSearch(title), artist: cleanForSearch(artist), album: cleanForSearch(album), duration: Math.round(duration) },
            { timeout: 5000 }
        );
        const lrc = res.data.lyrics;
        if (lrc) {
            lyricsCache.set(key, lrc);
            return lrc;
        }
    } catch { }
    lyricsCache.set(key, null);
    return null;
}

async function saveLyricsToFile(track: TrackInfo, albumInfo: AlbumInfo, baseFilePath: string): Promise<string | null> {
    const artist = track.performer?.name || albumInfo.artist?.name || 'Unknown';
    const lrc = await fetchLyrics(track.title, artist, albumInfo.title, track.duration);
    if (!lrc) return null;

    const lrcPath = baseFilePath.replace(/\.[^.]+$/, '.lrc');
    fs.writeFileSync(lrcPath, lrc, 'utf-8');
    return lrcPath;
}
