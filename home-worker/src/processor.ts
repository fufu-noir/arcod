import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import archiver from 'archiver';
import { config } from './config.js';
import { WorkerJob, updateJob } from './api-client.js';
import { getAlbumInfo, getTrackInfo, getTrackFileUrl } from './qobuz-api.js';
import { uploadToR2, startUploadStreamToR2, buildPublicUrl } from './r2.js';
import { fetchLyricsForTrack, LyricsResult } from './lyrics.js';

const WORK_DIR = '/tmp/arcod-processing';
if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

const MAX_JOB_DURATION_MS = 90 * 60 * 1000;

export async function processJob(job: WorkerJob): Promise<void> {
    const { id: downloadId } = job;
    const jobStartTime = Date.now();

    console.log(`[Worker] Processing ${downloadId}: ${job.artistName} - ${job.albumTitle}`);

    try {
        await updateJob(downloadId, { status: 'processing', description: 'Fetching album info...' });

        let albumId = job.albumId;
        if (job.trackId && !albumId) {
            const trackInfo = await getTrackInfo(String(job.trackId), job.country);
            albumId = String(trackInfo.album?.id || '');
            if (albumId) await updateJob(downloadId, { albumId });
        }
        if (!albumId) throw new Error('No album ID available');

        const albumInfo = await getAlbumInfo(albumId, job.country, {
            albumTitle: job.albumTitle,
            artistName: job.artistName,
        });
        const tracks = albumInfo.tracks?.items || [];
        if (tracks.length === 0) throw new Error('No tracks found in album');

        let tracksToDownload = tracks;
        if (job.trackId) {
            const single = tracks.find((t: any) => String(t.id) === String(job.trackId));
            if (single) {
                tracksToDownload = [single];
            } else {
                const trackInfo = await getTrackInfo(String(job.trackId), job.country);
                tracksToDownload = [trackInfo];
            }
        }

        const totalTracks = tracksToDownload.length;
        const jobDir = path.join(WORK_DIR, downloadId);
        if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

        await updateJob(downloadId, { status: 'processing', description: 'Downloading cover art...' });
        const coverPath = await downloadCoverArt(albumInfo, jobDir);

        const downloadedFiles: string[] = [];
        const sidecarFiles: string[] = [];
        const wantLyrics = job.embedLyrics !== false && job.embedLyrics !== 0;
        const lyricsSidecar = job.lyricsMode === 'sidecar';
        let completedTracks = 0;

        // Pre-fetch all track URLs
        await updateJob(downloadId, { status: 'processing', description: `Resolving ${totalTracks} track URLs...` });
        const prefetchedUrls = new Map<string, { url: string; mimeType: string }>();
        await Promise.allSettled(
            tracksToDownload.map((track: any) =>
                getTrackFileUrl(String(track.id), job.quality, job.country)
                    .then(result => { prefetchedUrls.set(String(track.id), result); })
            )
        );
        console.log(`[Worker] Pre-fetched ${prefetchedUrls.size}/${totalTracks} track URLs`);

        async function processTrack(track: any, i: number): Promise<{ outPath: string; lrcPath?: string } | null> {
            const trackPattern = job.trackName || '{track} - {name}';
            const resolvedName = applyNamingPattern(trackPattern, track, albumInfo, job);
            const rawPath = path.join(jobDir, `raw_${i}.tmp`);

            const lyricsPromise: Promise<LyricsResult | null> = wantLyrics
                ? fetchLyricsForTrack(
                    track.title,
                    track.performer?.name || job.artistName || '',
                    albumInfo.title,
                    track.duration || undefined
                ).catch(() => null)
                : Promise.resolve(null);

            let sourceMimeType = 'audio/flac';
            let downloaded = false;

            const streamTo = async (trackUrl: string): Promise<void> => {
                const response = await axios.get(trackUrl, {
                    responseType: 'stream', timeout: 120000,
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                });
                await new Promise<void>((resolve, reject) => {
                    const writer = fs.createWriteStream(rawPath);
                    response.data.pipe(writer);
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                    response.data.on('error', (err: Error) => { writer.destroy(); reject(err); });
                });
                if (fs.statSync(rawPath).size < 1000) throw new Error('File too small');
            };

            const prefetched = prefetchedUrls.get(String(track.id));

            // Pass 1: pre-fetched URL
            if (prefetched) {
                try {
                    sourceMimeType = prefetched.mimeType;
                    await streamTo(prefetched.url);
                    downloaded = true;
                } catch (e: any) {
                    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch {}
                    if (e.isPermanent) throw e;
                }
            }

            // Pass 2: fresh URL
            if (!downloaded) {
                try {
                    const { url, mimeType } = await getTrackFileUrl(String(track.id), job.quality, job.country);
                    sourceMimeType = mimeType;
                    await streamTo(url);
                    downloaded = true;
                } catch (e: any) {
                    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch {}
                    if (e.isPermanent) throw e;
                }
            }

            // Pass 3: CD quality fallback
            if (!downloaded && job.quality >= 7) {
                try {
                    const { url, mimeType } = await getTrackFileUrl(String(track.id), 6, job.country);
                    sourceMimeType = mimeType;
                    await streamTo(url);
                    downloaded = true;
                } catch {
                    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch {}
                }
            }

            if (!downloaded) throw new Error('All download attempts failed');

            const lyricsResult = await lyricsPromise;
            const ext = getExtensionFromFormat(job.format, sourceMimeType);
            const outPath = path.join(jobDir, `${resolvedName}.${ext}`);
            const embedLyrics = wantLyrics && !lyricsSidecar ? lyricsResult : null;
            const metadata = buildMetadataTags(track, albumInfo, job, totalTracks, embedLyrics);
            const needsConv = needsConversion(job.format, sourceMimeType);
            await processWithMetadata(rawPath, outPath, job.format, job.bitrate || 320, metadata, coverPath, needsConv);

            try { fs.unlinkSync(rawPath); } catch {}

            completedTracks++;
            const progress = Math.round((completedTracks / totalTracks) * 85);
            await updateJob(downloadId, {
                status: 'downloading',
                progress,
                description: `Downloaded ${completedTracks}/${totalTracks} tracks`,
            });

            let lrcPath: string | undefined;
            if (lyricsSidecar && lyricsResult) {
                const lrcContent = lyricsResult.synced || lyricsResult.plain || '';
                lrcPath = path.join(jobDir, `${resolvedName}.lrc`);
                fs.writeFileSync(lrcPath, lrcContent, 'utf-8');
            }

            return { outPath, lrcPath };
        }

        await updateJob(downloadId, { status: 'downloading', progress: 0, description: `Downloading ${totalTracks} tracks...` });

        for (let batchStart = 0; batchStart < tracksToDownload.length; batchStart += config.trackConcurrency) {
            if (Date.now() - jobStartTime > MAX_JOB_DURATION_MS) {
                throw new Error(`Job timed out after ${Math.round((Date.now() - jobStartTime) / 60000)} minutes`);
            }
            const batch = tracksToDownload.slice(batchStart, batchStart + config.trackConcurrency);
            const results = await Promise.allSettled(
                batch.map((track: any, j: number) => processTrack(track, batchStart + j))
            );
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    downloadedFiles.push(result.value.outPath);
                    if (result.value.lrcPath) sidecarFiles.push(result.value.lrcPath);
                } else if (result.status === 'rejected') {
                    console.error(`[Worker] Track failed:`, result.reason?.message);
                }
            }
        }

        if (downloadedFiles.length === 0) {
            throw new Error(`Failed to download any tracks (${tracksToDownload.length} tried)`);
        }

        // Cover & booklet
        const coverFiles: string[] = [];
        const wantAttachCover = job.attachCover !== false && job.attachCover !== 0;
        if (wantAttachCover && coverPath && fs.existsSync(coverPath)) coverFiles.push(coverPath);

        const bookletFiles: string[] = [];
        const wantBooklet = job.downloadBooklet !== false && job.downloadBooklet !== 0;
        if (wantBooklet) {
            try {
                const bookletPath = await downloadBooklet(albumInfo, jobDir);
                if (bookletPath) bookletFiles.push(bookletPath);
            } catch {}
        }

        // Upload
        await updateJob(downloadId, { status: 'processing', progress: 90, description: 'Uploading...' });

        let finalFileName: string;
        let contentType: string;
        let publicUrl: string;
        let fileSize: number = 0;

        const allFiles = [...downloadedFiles, ...sidecarFiles, ...coverFiles, ...bookletFiles];

        if (downloadedFiles.length === 1 && sidecarFiles.length === 0 && coverFiles.length === 0 && bookletFiles.length === 0) {
            const filePath = downloadedFiles[0];
            const ext = path.extname(filePath);
            const track0 = tracksToDownload[0];
            finalFileName = applyNamingPattern(job.trackName || '{track} - {name}', track0, albumInfo, job) + ext;
            contentType = getContentType(job.format);
            const safeFileName = finalFileName.replace(/\s+/g, '_');
            publicUrl = await uploadToR2(filePath, `downloads/${downloadId}/${safeFileName}`, contentType);
            fileSize = fs.statSync(filePath).size;
        } else {
            const zipPattern = job.zipName || '{artists} - {album}';
            finalFileName = applyZipNamingPattern(zipPattern, albumInfo, job) + '.zip';
            contentType = 'application/zip';
            const safeFileName = finalFileName.replace(/\s+/g, '_');
            const r2Key = `downloads/${downloadId}/${safeFileName}`;
            const { stream, upload } = await startUploadStreamToR2(r2Key, contentType, finalFileName);
            const archive = archiver('zip', { zlib: { level: 0 } });
            archive.pipe(stream);
            for (const file of allFiles) {
                archive.file(file, { name: path.basename(file) });
            }
            await Promise.all([archive.finalize(), upload.done()]);
            fileSize = archive.pointer();
            publicUrl = buildPublicUrl(r2Key);
        }

        if (fileSize < 1000) throw new Error(`Output file suspiciously small (${fileSize} bytes)`);

        const deleteAfter = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await updateJob(downloadId, {
            status: 'completed',
            progress: 100,
            description: 'Download ready!',
            fileName: finalFileName,
            fileSize,
            downloadUrl: publicUrl,
            guestDownloadIssuedAt: new Date().toISOString(),
            guestDeleteAfter: deleteAfter,
        });
        console.log(`[Worker] Done ${downloadId}: ${finalFileName} (${formatBytes(fileSize)})`);

        cleanup(jobDir);
    } catch (error: any) {
        console.error(`[Worker] Failed ${downloadId}:`, error.message);
        try {
            await updateJob(downloadId, {
                status: 'failed',
                description: 'Download failed',
                error: error.message || 'Unknown error',
            });
        } catch {}
        cleanup(path.join(WORK_DIR, downloadId));
    }
}

// ======================== Cover art ========================

async function downloadCoverArt(albumInfo: any, jobDir: string): Promise<string | null> {
    const coverUrl = albumInfo.image?.large || albumInfo.image?.extralarge
        || albumInfo.image?.mega || albumInfo.image?.small || albumInfo.image?.thumbnail || null;

    if (!coverUrl) {
        if (albumInfo.image?.small) {
            const hiRes = albumInfo.image.small.replace(/_\d+\.jpg/, '_max.jpg');
            try {
                const res = await axios.get(hiRes, { responseType: 'arraybuffer', timeout: 10000 });
                const coverPath = path.join(jobDir, 'cover.jpg');
                fs.writeFileSync(coverPath, Buffer.from(res.data));
                return coverPath;
            } catch {}
        }
        return null;
    }

    try {
        let url = coverUrl;
        if (url.includes('_600.jpg')) url = url.replace('_600.jpg', '_max.jpg');
        else if (url.includes('_230.jpg')) url = url.replace('_230.jpg', '_max.jpg');
        else if (url.includes('_50.jpg')) url = url.replace('_50.jpg', '_max.jpg');

        let res;
        try { res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 }); }
        catch { res = await axios.get(coverUrl, { responseType: 'arraybuffer', timeout: 10000 }); }

        const coverPath = path.join(jobDir, 'cover.jpg');
        fs.writeFileSync(coverPath, Buffer.from(res.data));
        return coverPath;
    } catch {
        return null;
    }
}

// ======================== Booklet ========================

async function downloadBooklet(albumInfo: any, jobDir: string): Promise<string | null> {
    const goodies = albumInfo.goodies;
    if (!Array.isArray(goodies) || goodies.length === 0) return null;
    const booklet = goodies.find((g: any) => g.file_format_id === 21) || goodies[0];
    const url = booklet?.url || booklet?.original_url;
    if (!url) return null;

    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
        const contentType = String(response.headers['content-type'] || '');
        let ext = 'pdf';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
        else if (contentType.includes('png')) ext = 'png';
        const bookletPath = path.join(jobDir, `booklet.${ext}`);
        fs.writeFileSync(bookletPath, Buffer.from(response.data));
        return bookletPath;
    } catch {
        return null;
    }
}

// ======================== Metadata ========================

interface MetadataTags {
    title: string; artist: string; album: string; album_artist: string;
    date: string; year: string; track: string; disc: string;
    genre: string; copyright: string; publisher: string; isrc: string;
    barcode: string; composer: string;
    syncedLyrics: string | null; plainLyrics: string | null;
}

function buildMetadataTags(track: any, albumInfo: any, job: any, totalTracks: number, lyrics: LyricsResult | null): MetadataTags {
    const artist = track.performer?.name || job.artistName || 'Unknown';
    const title = track.version ? `${track.title} (${track.version})` : (track.title || 'Unknown');
    const album = albumInfo.title || job.albumTitle || 'Unknown Album';
    const albumArtist = albumInfo.artist?.name || artist;
    const releaseDate = albumInfo.release_date_original || albumInfo.released_at?.split('T')[0] || '';
    const year = releaseDate ? new Date(releaseDate).getFullYear().toString() : '';
    const trackNumber = track.track_number || 1;
    const discNumber = track.media_number || 1;
    const totalDiscs = albumInfo.media_count || 1;

    return {
        title, artist, album, album_artist: albumArtist,
        date: releaseDate, year,
        track: `${trackNumber}/${totalTracks}`,
        disc: `${discNumber}/${totalDiscs}`,
        genre: albumInfo.genre?.name || '',
        copyright: albumInfo.copyright || '',
        publisher: albumInfo.label?.name || '',
        isrc: track.isrc || '',
        barcode: albumInfo.upc || '',
        composer: track.composer?.name || '',
        syncedLyrics: lyrics?.synced || null,
        plainLyrics: lyrics?.plain || null,
    };
}

// ======================== FFmpeg ========================

async function processWithMetadata(
    inputPath: string, outputPath: string, format: string, bitrate: number,
    metadata: MetadataTags, coverPath: string | null, needsConv: boolean,
): Promise<void> {
    const fmt = format?.toUpperCase() || 'FLAC';
    const isFLAC = fmt === 'FLAC' || (!needsConv && outputPath.endsWith('.flac'));
    const isMP3 = fmt === 'MP3' || outputPath.toLowerCase().endsWith('.mp3');

    await new Promise<void>((resolve, reject) => {
        const args: string[] = ['-i', inputPath];

        const isWAV = fmt === 'WAV';
        const embedCoverViaFFmpeg = coverPath && fs.existsSync(coverPath) && !isFLAC && !isWAV;
        if (embedCoverViaFFmpeg) args.push('-i', coverPath!);

        args.push('-y', '-map_metadata', '-1', '-map', '0:a');

        if (embedCoverViaFFmpeg) {
            args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
        }

        if (needsConv) {
            switch (fmt) {
                case 'MP3': args.push('-codec:a', 'libmp3lame', '-b:a', `${bitrate}k`); break;
                case 'WAV': args.push('-codec:a', 'pcm_s16le'); break;
                case 'AAC': args.push('-codec:a', 'aac', '-b:a', `${bitrate}k`); break;
                case 'OGG': args.push('-codec:a', 'libvorbis', '-b:a', `${bitrate}k`); break;
                case 'OPUS': args.push('-codec:a', 'libopus', '-b:a', `${bitrate}k`); break;
                case 'ALAC': args.push('-codec:a', 'alac'); break;
                default: args.push('-codec:a', 'flac');
            }
        } else {
            args.push('-codec:a', 'copy');
        }

        if (isMP3) {
            args.push('-id3v2_version', '3');
        }

        args.push('-metadata', `TITLE=${metadata.title}`);
        args.push('-metadata', `ARTIST=${metadata.artist}`);
        args.push('-metadata', `ALBUM=${metadata.album}`);
        args.push('-metadata', `ALBUMARTIST=${metadata.album_artist}`);
        args.push('-metadata', `TRACKNUMBER=${metadata.track}`);
        args.push('-metadata', `DISCNUMBER=${metadata.disc}`);
        if (metadata.date) args.push('-metadata', `DATE=${metadata.date}`);
        if (metadata.year) args.push('-metadata', `YEAR=${metadata.year}`);
        if (metadata.genre) args.push('-metadata', `GENRE=${metadata.genre}`);
        if (metadata.copyright) args.push('-metadata', `COPYRIGHT=${metadata.copyright}`);
        if (metadata.publisher) {
            args.push('-metadata', `PUBLISHER=${metadata.publisher}`);
            args.push('-metadata', `LABEL=${metadata.publisher}`);
            args.push('-metadata', `ORGANIZATION=${metadata.publisher}`);
        }
        if (metadata.isrc) args.push('-metadata', `ISRC=${metadata.isrc}`);
        if (metadata.barcode) {
            args.push('-metadata', `BARCODE=${metadata.barcode}`);
            args.push('-metadata', `UPC=${metadata.barcode}`);
        }
        if (metadata.composer) args.push('-metadata', `COMPOSER=${metadata.composer}`);
        if (metadata.syncedLyrics) args.push('-metadata', `LYRICS=${metadata.syncedLyrics}`);
        if (metadata.plainLyrics) {
            args.push('-metadata', `UNSYNCEDLYRICS=${metadata.plainLyrics}`);
        } else if (metadata.syncedLyrics) {
            args.push('-metadata', `UNSYNCEDLYRICS=${metadata.syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '')}`);
        }

        args.push(outputPath);

        const ffmpeg = spawn('ffmpeg', args, { stdio: 'pipe' });
        let stderr = '';
        ffmpeg.stderr?.on('data', (data) => { stderr += data.toString(); });
        ffmpeg.on('close', (code) => {
            if (code === 0) resolve();
            else { console.error(`[FFmpeg] stderr: ${stderr.slice(-500)}`); reject(new Error(`ffmpeg exit ${code}`)); }
        });
        ffmpeg.on('error', reject);
    });

    if (isFLAC && coverPath && fs.existsSync(coverPath) && fs.existsSync(outputPath)) {
        try { await embedFLACCover(outputPath, coverPath); } catch {}
    }
}

function embedFLACCover(flacPath: string, coverPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const metaflac = spawn('metaflac', ['--import-picture-from', coverPath, flacPath], { stdio: 'pipe' });
        let stderr = '';
        metaflac.stderr?.on('data', (d) => { stderr += d.toString(); });
        metaflac.on('close', (code) => { if (code === 0) resolve(); else reject(new Error(`metaflac exit ${code}`)); });
        metaflac.on('error', reject);
    });
}

// ======================== Helpers ========================

function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\.+$/, '').replace(/\s+/g, ' ').trim().substring(0, 200);
}

function applyNamingPattern(pattern: string, track: any, albumInfo: any, job: any): string {
    const artist = track.performer?.name || job.artistName || 'Unknown';
    const title = track.version ? `${track.title} (${track.version})` : (track.title || 'Unknown');
    const album = albumInfo.title || job.albumTitle || 'Unknown Album';
    const year = albumInfo.release_date_original ? new Date(albumInfo.release_date_original).getFullYear().toString() : '';
    const trackNum = String(track.track_number || 1).padStart(2, '0');
    const discNum = String(track.media_number || 1).padStart(2, '0');

    return sanitizeFilename(pattern
        .replace(/\{artists?\}/gi, artist)
        .replace(/\{name\}/gi, title)
        .replace(/\{album\}/gi, album)
        .replace(/\{year\}/gi, year)
        .replace(/\{track\}/gi, trackNum)
        .replace(/\{disc\}/gi, discNum)
        .replace(/\{genre\}/gi, albumInfo.genre?.name || '')
        .replace(/\{version\}/gi, track.version || ''));
}

function applyZipNamingPattern(pattern: string, albumInfo: any, job: any): string {
    const artist = albumInfo.artist?.name || job.artistName || 'Unknown';
    const name = albumInfo.title || job.albumTitle || 'Unknown Album';
    const year = albumInfo.release_date_original ? new Date(albumInfo.release_date_original).getFullYear().toString() : '';

    return sanitizeFilename(pattern
        .replace(/\{artists?\}/gi, artist)
        .replace(/\{name\}/gi, name)
        .replace(/\{album\}/gi, name)
        .replace(/\{year\}/gi, year)
        .replace(/\{genre\}/gi, albumInfo.genre?.name || ''));
}

function getExtensionFromFormat(format: string, mimeType: string): string {
    switch (format?.toUpperCase()) {
        case 'MP3': return 'mp3'; case 'WAV': return 'wav';
        case 'ALAC': case 'AAC': return 'm4a';
        case 'OGG': return 'ogg'; case 'OPUS': return 'opus';
        default: return 'flac';
    }
}

function getContentType(format: string): string {
    switch (format?.toUpperCase()) {
        case 'MP3': return 'audio/mpeg'; case 'WAV': return 'audio/wav';
        case 'AAC': return 'audio/mp4'; case 'OGG': return 'audio/ogg';
        case 'OPUS': return 'audio/opus'; default: return 'audio/flac';
    }
}

function needsConversion(targetFormat: string, sourceMimeType: string): boolean {
    const fmt = targetFormat?.toUpperCase() || 'FLAC';
    const mime = sourceMimeType?.toLowerCase() || '';
    if (fmt === 'FLAC' && (mime.includes('flac') || mime.includes('x-flac'))) return false;
    if (fmt === 'MP3' && mime.includes('mpeg')) return false;
    if (fmt === 'WAV' && (mime.includes('wav') || mime.includes('wave'))) return false;
    if (fmt === 'AAC' && (mime.includes('aac') || mime.includes('mp4'))) return false;
    if (fmt === 'ALAC' && mime.includes('alac')) return false;
    if (fmt === 'OPUS' && mime.includes('opus')) return false;
    if (fmt === 'FLAC' && !mime.includes('mpeg')) return false;
    return true;
}

function cleanup(dir: string): void {
    try {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            let size = 0;
            for (const f of files) {
                try { size += fs.statSync(path.join(dir, f)).size; } catch {}
            }
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`[Cleanup] Deleted ${dir} (${files.length} files, ${(size / 1024 / 1024).toFixed(1)} MB)`);
        }
    } catch (err: any) {
        console.error(`[Cleanup] FAILED to delete ${dir}:`, err.message);
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
