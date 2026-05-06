/**
 * download processor — in-process job queue
 * handles downloading, tagging, and uploading
 */
import fastq from 'fastq';
import type { queueAsPromised } from 'fastq';
import { getDownload, updateDownload, deleteDownload, getExpiredGuestDownloads, getPendingDownloads, resetOrphanedActiveJobs, failStaleActiveJobs, releaseExpiredWorkerJobs, getRoutingConfig } from '../db/client.js';
import { config } from '../config.js';
import { uploadToR2, startUploadStreamToR2, buildPublicUrl } from '../storage/r2.js';
import { getAlbumInfoFromQobuz, getTrackInfoFromQobuz, getTrackFileUrl } from '../services/qobuz-api.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import https from 'https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { spawn } from 'child_process';

const directHttpAgent = new http.Agent({ family: 4 });
const directHttpsAgent = new https.Agent({ family: 4 });
const warpAgent = new SocksProxyAgent('socks5h://127.0.0.1:40000');
import archiver from 'archiver';

const WORK_DIR = process.env.PROCESSING_DIR || '/opt/arcod-processing';
const TRACK_CONCURRENCY = 4;

// Global cap on simultaneous audio downloads to avoid bandwidth starvation
const MAX_GLOBAL_DOWNLOADS = 16;
let globalActiveDownloads = 0;
const globalDownloadWaiters: (() => void)[] = [];

async function acquireDownloadSlot(): Promise<void> {
    if (globalActiveDownloads < MAX_GLOBAL_DOWNLOADS) {
        globalActiveDownloads++;
        return;
    }
    await new Promise<void>(resolve => globalDownloadWaiters.push(resolve));
    globalActiveDownloads++;
}

function releaseDownloadSlot(): void {
    globalActiveDownloads--;
    const next = globalDownloadWaiters.shift();
    if (next) next();
}

// Ensure work directory exists
if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

interface ProcessJob {
    downloadId: string;
}

// Singles/small: dedicated fast lane, never blocked by albums
// Albums: separate queue
const fastQueue: queueAsPromised<ProcessJob> = fastq.promise(processDownload, 4);
const albumQueue: queueAsPromised<ProcessJob> = fastq.promise(processDownload, 6);

export function enqueueDownload(downloadId: string): void {
    const routing = getRoutingConfig();

    // Worker-only mode: VPS never processes
    if (routing.mode === 'worker_only' && config.worker.apiKey) return;

    const totalQueued = fastQueue.length() + albumQueue.length();

    // In hybrid mode, VPS only takes small jobs up to its concurrency cap
    if (routing.mode === 'hybrid' && config.worker.apiKey) {
        if (totalQueued >= routing.vpsMaxConcurrent) return;
        const download = getDownload(downloadId);
        const trackCount = download?.tracksCount || 0;
        const isFast = download && (download.trackId || trackCount <= routing.vpsMaxTracks);
        if (!isFast) return;
    }

    // VPS-only mode or job passes hybrid filter
    const download = getDownload(downloadId);
    const isFast = download && (download.trackId || (download.tracksCount || 0) <= 3);
    const q = isFast ? fastQueue : albumQueue;
    q.push({ downloadId }).catch(err => {
        console.error(`[Queue] Error processing download ${downloadId}:`, err);
    });
    console.log(`[Queue] Enqueued ${isFast ? 'fast' : 'album'} download ${downloadId}. Queue: fast=${fastQueue.length()} album=${albumQueue.length()}`);
}

// ======================== Lyrics fetching (Apple/Spotify + Musixmatch direct + LRCLIB) ========================

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const KPOE_APPLE_URL = 'https://lyricsplus.prjktla.workers.dev/v2/lyrics/get';
const MXM_API_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';

interface LyricsResult {
    synced: string | null;
    plain: string | null;
    source: string;
}

function cleanForSearch(text: string): string {
    return text
        .replace(/\s*\(feat\..*?\)/gi, '')
        .replace(/\s*\[.*?\]/g, '')
        .replace(/\s*-\s*Remaster(ed)?.*$/gi, '')
        .replace(/\s*-\s*\d{4}\s*(Remaster)?.*$/gi, '')
        .replace(/\s*\(Deluxe.*?\)/gi, '')
        .replace(/\s*\(Bonus.*?\)/gi, '')
        .trim();
}

function formatLrcTimestamp(ms: number): string {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function toMilliseconds(value: any, fallback: number = 0): number {
    try {
        const num = parseFloat(value);
        if (!num || num < 0) return fallback;
        if (num < 1000 && !Number.isInteger(num)) return Math.round(num * 1000);
        return Math.max(0, Math.round(num));
    } catch { return fallback; }
}

// --- LRCLIB ---

async function fetchLyricsFromLrclib(title: string, artist: string, album?: string, duration?: number): Promise<LyricsResult | null> {
    function extractResult(data: any): LyricsResult | null {
        if (!data) return null;
        const synced = data.syncedLyrics || null;
        const plain = data.plainLyrics || null;
        if (!synced && !plain) return null;
        return { synced, plain, source: 'LRCLIB' };
    }

    try {
        const params: any = { artist_name: artist.trim(), track_name: title.trim() };
        if (album) params.album_name = album.trim();
        if (duration && duration > 0) params.duration = Math.round(duration);
        const response = await axios.get(`${LRCLIB_BASE_URL}/get`, {
            params, timeout: 5000,
            headers: { 'User-Agent': 'ARCOD-Qobuz-DL/1.0' },
        });
        if (response.status === 200) {
            const result = extractResult(response.data);
            if (result) return result;
        }
    } catch { }

    try {
        const searchResponse = await axios.get(`${LRCLIB_BASE_URL}/search`, {
            params: { artist_name: artist.trim(), track_name: title.trim() },
            timeout: 5000,
            headers: { 'User-Agent': 'ARCOD-Qobuz-DL/1.0' },
        });
        if (searchResponse.status === 200 && Array.isArray(searchResponse.data) && searchResponse.data.length > 0) {
            const best = searchResponse.data.find((r: any) => r.syncedLyrics) || searchResponse.data[0];
            const result = extractResult(best);
            if (result) return result;
        }
    } catch { }

    return null;
}

// --- LyricsPlus / Apple / Spotify (KPoe workers.dev — still alive) ---

async function fetchLyricsFromApple(title: string, artist: string, album?: string, duration?: number): Promise<LyricsResult | null> {
    const params: any = { title: title.trim(), artist: artist.trim(), source: 'spotify,apple,lyricsplus' };
    if (album) params.album = album.trim();
    if (duration && duration > 0) params.duration = String(Math.round(duration));

    try {
        const response = await axios.get(KPOE_APPLE_URL, { params, timeout: 10000 });
        if (response.status === 200 && response.data) {
            const payload = response.data;
            const rawLyrics = Array.isArray(payload.lyrics) ? payload.lyrics
                : Array.isArray(payload.data?.lyrics) ? payload.data.lyrics
                    : Array.isArray(payload.data) ? payload.data : null;
            if (!rawLyrics || rawLyrics.length === 0) return null;

            const sourceLabel = payload.metadata?.source || 'Apple';
            const lrcLines: string[] = [];
            const plainLines: string[] = [];
            let hasTiming = false;

            for (const entry of rawLyrics) {
                if (!entry) continue;
                let lineText = '';
                const syllabus: any[] = Array.isArray(entry.syllabus) ? entry.syllabus : [];
                if (typeof entry.text === 'string' && entry.text) {
                    lineText = entry.text;
                } else if (syllabus.length > 0) {
                    lineText = syllabus.map((s: any) => s.text || '').join('');
                }
                if (!lineText) continue;

                const lineStart = toMilliseconds(entry.time ?? entry.startTimeMs ?? 0, 0);
                if (lineStart > 0) hasTiming = true;
                lrcLines.push(`[${formatLrcTimestamp(lineStart)}]${lineText}`);
                plainLines.push(lineText);
            }

            if (lrcLines.length > 0) {
                return {
                    synced: hasTiming ? lrcLines.join('\n') : null,
                    plain: plainLines.join('\n'),
                    source: sourceLabel,
                };
            }
        }
    } catch { }
    return null;
}

// --- Musixmatch Desktop API (direct) ---

let mxmToken: string | null = null;
let mxmTokenExpiry = 0;

async function getMxmToken(): Promise<string | null> {
    if (mxmToken && Date.now() < mxmTokenExpiry) return mxmToken;
    try {
        const response = await axios.get(`${MXM_API_BASE}/token.get`, {
            params: { user_language: 'en', app_id: 'web-desktop-app-v1.0', t: Date.now() },
            timeout: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const token = response.data?.message?.body?.user_token;
        if (token && typeof token === 'string' && token.length > 10) {
            mxmToken = token;
            mxmTokenExpiry = Date.now() + 8 * 60 * 1000; // 8 min cache
            return token;
        }
    } catch (err: any) {
        console.warn(`[Lyrics] Musixmatch token.get failed: ${err.message}`);
    }
    return null;
}

async function fetchLyricsFromMusixmatch(title: string, artist: string, album?: string, duration?: number): Promise<LyricsResult | null> {
    const token = await getMxmToken();
    if (!token) return null;

    try {
        const params: any = {
            format: 'json',
            namespace: 'lyrics_richsynched',
            subtitle_format: 'lrc',
            app_id: 'web-desktop-app-v1.0',
            q_artist: artist.trim(),
            q_track: title.trim(),
            usertoken: token,
            t: Date.now(),
        };
        if (album) params.q_album = album.trim();
        if (duration && duration > 0) params.f_subtitle_length = Math.floor(duration);

        const response = await axios.get(`${MXM_API_BASE}/macro.subtitles.get`, {
            params,
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'authority': 'apic-desktop.musixmatch.com',
                'cookie': 'x-mxm-token-guid=',
            },
        });

        const macroCalls = response.data?.message?.body?.macro_calls;
        if (!macroCalls) return null;

        // Check if track was matched
        const matcherStatus = macroCalls['matcher.track.get']?.message?.header?.status_code;
        if (matcherStatus !== 200) return null;

        // Check if token needs renewal
        const hint = macroCalls['matcher.track.get']?.message?.header?.hint;
        if (hint === 'renew') {
            mxmToken = null;
            mxmTokenExpiry = 0;
        }

        // Try synced subtitles first
        const subsMsg = macroCalls['track.subtitles.get']?.message;
        if (subsMsg?.header?.status_code === 200) {
            const subtitleList = subsMsg.body?.subtitle_list;
            if (Array.isArray(subtitleList) && subtitleList.length > 0) {
                const subtitleBody = subtitleList[0]?.subtitle?.subtitle_body;
                if (subtitleBody && typeof subtitleBody === 'string' && subtitleBody.includes('[')) {
                    // subtitleBody is LRC format from Musixmatch
                    const plain = subtitleBody.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '');
                    return { synced: subtitleBody, plain, source: 'Musixmatch' };
                }
            }
        }

        // Fallback to plain lyrics
        const lyricsMsg = macroCalls['track.lyrics.get']?.message;
        if (lyricsMsg?.header?.status_code === 200) {
            const lyricsBody = lyricsMsg.body?.lyrics?.lyrics_body;
            if (lyricsBody && typeof lyricsBody === 'string' && lyricsBody.length > 10) {
                const restricted = lyricsMsg.body?.lyrics?.restricted;
                if (!restricted) {
                    return { synced: null, plain: lyricsBody, source: 'Musixmatch' };
                }
            }
        }
    } catch (err: any) {
        console.warn(`[Lyrics] Musixmatch API error: ${err.message}`);
    }
    return null;
}

// --- Main orchestrator — all 3 sources in parallel ---

async function fetchLyricsForTrack(title: string, artist: string, album?: string, duration?: number): Promise<LyricsResult | null> {
    const cleanTitle = cleanForSearch(title);
    const cleanArtist = cleanForSearch(artist);
    const cleanAlbum = album ? cleanForSearch(album) : undefined;

    const [appleRes, mxmRes, lrclibRes] = await Promise.allSettled([
        fetchLyricsFromApple(cleanTitle, cleanArtist, cleanAlbum, duration),
        fetchLyricsFromMusixmatch(cleanTitle, cleanArtist, cleanAlbum, duration),
        fetchLyricsFromLrclib(cleanTitle, cleanArtist, cleanAlbum, duration),
    ]);

    const apple = appleRes.status === 'fulfilled' ? appleRes.value : null;
    const mxm   = mxmRes.status   === 'fulfilled' ? mxmRes.value   : null;
    const lrclib = lrclibRes.status === 'fulfilled' ? lrclibRes.value : null;

    // Prefer synced, then best plain
    return (apple?.synced ? apple : null)
        ?? (mxm?.synced   ? mxm   : null)
        ?? (lrclib?.synced ? lrclib : null)
        ?? apple ?? mxm ?? lrclib ?? null;
}

// ======================== Cover art downloading ========================

async function downloadCoverArt(albumInfo: any, jobDir: string): Promise<string | null> {
    // Try to get highest resolution cover
    const coverUrl = albumInfo.image?.large
        || albumInfo.image?.extralarge
        || albumInfo.image?.mega
        || albumInfo.image?.small
        || albumInfo.image?.thumbnail
        || null;

    if (!coverUrl) {
        // Try constructing high-res URL from Qobuz pattern
        if (albumInfo.image?.small) {
            const hiRes = albumInfo.image.small.replace(/_\d+\.jpg/, '_max.jpg');
            try {
                const res = await axios.get(hiRes, { responseType: 'arraybuffer', timeout: 10000 });
                const coverPath = path.join(jobDir, 'cover.jpg');
                fs.writeFileSync(coverPath, Buffer.from(res.data));
                console.log(`[Processor] Cover art downloaded (hi-res): ${formatBytes(res.data.byteLength)}`);
                return coverPath;
            } catch { }
        }
        return null;
    }

    try {
        // Try max resolution first
        let url = coverUrl;
        if (url.includes('_600.jpg')) url = url.replace('_600.jpg', '_max.jpg');
        else if (url.includes('_230.jpg')) url = url.replace('_230.jpg', '_max.jpg');
        else if (url.includes('_50.jpg')) url = url.replace('_50.jpg', '_max.jpg');

        let res;
        try {
            res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
        } catch {
            // Fallback to original URL
            res = await axios.get(coverUrl, { responseType: 'arraybuffer', timeout: 10000 });
        }

        const coverPath = path.join(jobDir, 'cover.jpg');
        fs.writeFileSync(coverPath, Buffer.from(res.data));
        console.log(`[Processor] Cover art downloaded: ${formatBytes(res.data.byteLength)}`);
        return coverPath;
    } catch (err: any) {
        console.warn(`[Processor] Failed to download cover art: ${err.message}`);
        return null;
    }
}

// ======================== Booklet / goodies downloading ========================

async function downloadBooklet(albumInfo: any, jobDir: string): Promise<string | null> {
    const goodies = albumInfo.goodies;
    if (!Array.isArray(goodies) || goodies.length === 0) return null;

    // Find the first PDF booklet (file_format_id 21 = PDF, but also accept any goodie with a URL)
    const booklet = goodies.find((g: any) => g.file_format_id === 21) || goodies[0];
    const url = booklet?.url || booklet?.original_url;
    if (!url) return null;

    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        // Determine extension from content-type or URL
        const contentType = response.headers['content-type'] || '';
        let ext = 'pdf';
        if (contentType.includes('pdf')) ext = 'pdf';
        else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
        else if (contentType.includes('png')) ext = 'png';
        else {
            const urlExt = url.split('?')[0].split('.').pop()?.toLowerCase();
            if (urlExt && ['pdf', 'jpg', 'jpeg', 'png'].includes(urlExt)) ext = urlExt;
        }

        const bookletName = `booklet.${ext}`;
        const bookletPath = path.join(jobDir, bookletName);
        fs.writeFileSync(bookletPath, Buffer.from(response.data));
        console.log(`[Processor] Booklet downloaded: ${bookletName} (${formatBytes(response.data.byteLength)})`);
        return bookletPath;
    } catch (err: any) {
        console.warn(`[Processor] Failed to download booklet: ${err.message}`);
        return null;
    }
}

// ======================== Main processor ========================

const MAX_JOB_DURATION_MS = 90 * 60 * 1000; // 90 min hard cap (upload of large hi-res albums can take 20+ min)

async function processDownload(job: ProcessJob): Promise<void> {
    const { downloadId } = job;
    const download = getDownload(downloadId);

    if (!download) {
        console.warn(`[Processor] Download ${downloadId} not found`);
        return;
    }

    if (download.status === 'cancelled') {
        console.log(`[Processor] Download ${downloadId} was cancelled`);
        return;
    }

    if (download.status !== 'pending') {
        console.warn(`[Processor] Download ${downloadId} already ${download.status}, skipping`);
        return;
    }

    const jobStartTime = Date.now();

    console.log(`[Processor] Processing ${downloadId}: ${download.artistName} - ${download.albumTitle}`);

    try {
        updateDownload(downloadId, { status: 'processing', description: 'Fetching album info...' });

        // 1. Resolve albumId if missing (e.g. old library entries for single tracks)
        let albumId = download.albumId;
        if (download.trackId && !albumId) {
            console.log(`[Processor] No albumId for track ${download.trackId}, fetching track info...`);
            const trackInfo = await getTrackInfoFromQobuz(String(download.trackId), download.country);
            albumId = String(trackInfo.album?.id || '');
            if (albumId) {
                updateDownload(downloadId, { albumId });
            }
        }

        if (!albumId) {
            throw new Error('No album ID available');
        }

        const albumInfo = await getAlbumInfoFromQobuz(albumId, download.country, {
            albumTitle: download.albumTitle,
            artistName: download.artistName,
        });
        const tracks = albumInfo.tracks?.items || [];

        if (tracks.length === 0) {
            throw new Error('No tracks found in album');
        }

        // Determine which tracks to download
        let tracksToDownload = tracks;
        if (download.trackId) {
            const singleTrack = tracks.find((t: any) => String(t.id) === String(download.trackId));
            if (singleTrack) {
                tracksToDownload = [singleTrack];
            } else {
                // Track not in album's track list — fetch track info directly and use it
                console.log(`[Processor] Track ${download.trackId} not in album tracks, fetching directly...`);
                const trackInfo = await getTrackInfoFromQobuz(String(download.trackId), download.country);
                tracksToDownload = [trackInfo];
            }
        }

        const totalTracks = tracksToDownload.length;
        const jobDir = path.join(WORK_DIR, downloadId);
        if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

        // 2. Download cover art once for the album
        updateDownload(downloadId, { status: 'processing', description: 'Downloading cover art...' });
        const coverPath = await downloadCoverArt(albumInfo, jobDir);

        const downloadedFiles: string[] = []; // audio files only (ordered)
        const sidecarFiles: string[] = [];    // .lrc files for sidecar mode

        const wantLyrics = download.embedLyrics !== false && download.embedLyrics !== 0;
        const lyricsSidecar = download.lyricsMode === 'sidecar';

        // Track download progress atomically
        let completedTracks = 0;

        // pre-fetch all track file urls in parallel
        updateDownload(downloadId, { status: 'processing', description: `Resolving ${totalTracks} track URLs...` });
        interface PrefetchedUrl { url: string; mimeType: string }
        const prefetchedUrls = new Map<string, PrefetchedUrl>();
        const urlResults = await Promise.allSettled(
            tracksToDownload.map((track: any) =>
                getTrackFileUrl(String(track.id), download.quality, download.country)
                    .then(result => { prefetchedUrls.set(String(track.id), result); })
            )
        );
        console.log(`[Processor] Pre-fetched ${prefetchedUrls.size}/${totalTracks} track URLs for ${downloadId}`);

        // Process a single track: download + lyrics + ffmpeg
        async function processTrack(track: any, i: number): Promise<{ outPath: string; lrcPath?: string } | null> {
            const currentJob = getDownload(downloadId);
            if (currentJob?.status === 'cancelled') return null;

            const trackPattern = download.trackName || '{track} - {name}';
            const resolvedName = applyNamingPattern(trackPattern, track, albumInfo, download);
            const rawPath = path.join(jobDir, `raw_${i}.tmp`);

            const lyricsPromise: Promise<LyricsResult | null> = wantLyrics
                ? fetchLyricsForTrack(
                    track.title,
                    track.performer?.name || download.artistName || '',
                    albumInfo.title,
                    track.duration || undefined
                ).catch(() => null)
                : Promise.resolve(null);

            let sourceMimeType = 'audio/flac';
            let downloaded = false;

            const streamTo = async (trackUrl: string, agents: { http: any; https: any }): Promise<void> => {
                const response = await axios.get(trackUrl, {
                    responseType: 'stream', timeout: 120000,
                    httpAgent: agents.http, httpsAgent: agents.https,
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

            // Use pre-fetched URL first, fall back to fresh fetch
            const prefetched = prefetchedUrls.get(String(track.id));

            await acquireDownloadSlot();
            try {
                // Pass 1: pre-fetched URL + direct IPv4
                if (prefetched) {
                    try {
                        sourceMimeType = prefetched.mimeType;
                        await streamTo(prefetched.url, { http: directHttpAgent, https: directHttpsAgent });
                        downloaded = true;
                    } catch (dlErr: any) {
                        try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch { }
                        if (dlErr.isPermanent) throw dlErr;
                    }
                }

                // Pass 2: fresh URL + direct IPv4
                if (!downloaded) {
                    try {
                        const { url: trackUrl, mimeType } = await getTrackFileUrl(String(track.id), download.quality, download.country);
                        sourceMimeType = mimeType;
                        await streamTo(trackUrl, { http: directHttpAgent, https: directHttpsAgent });
                        downloaded = true;
                    } catch (dlErr: any) {
                        try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch { }
                        if (dlErr.isPermanent) throw dlErr;
                    }
                }

                // Pass 3: WARP proxy fallback
                if (!downloaded) {
                    try {
                        const { url: trackUrl, mimeType } = await getTrackFileUrl(String(track.id), download.quality, download.country);
                        sourceMimeType = mimeType;
                        await streamTo(trackUrl, { http: warpAgent, https: warpAgent });
                        downloaded = true;
                    } catch (dlErr: any) {
                        try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch { }
                        if (dlErr.isPermanent) throw dlErr;
                    }
                }

                // Pass 4: CD quality fallback
                if (!downloaded && download.quality >= 7) {
                    console.log(`[Processor] ⚠️ Hi-res failed for ${track.id}, trying CD quality...`);
                    try {
                        const { url: trackUrl, mimeType } = await getTrackFileUrl(String(track.id), 6, download.country);
                        sourceMimeType = mimeType;
                        await streamTo(trackUrl, { http: directHttpAgent, https: directHttpsAgent });
                        downloaded = true;
                        console.log(`[Processor] ✅ ${track.title} CD quality fallback`);
                    } catch (dlErr: any) {
                        try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch { }
                    }
                }
            } finally {
                releaseDownloadSlot();
            }

            if (!downloaded) throw new Error('All download attempts failed');

            const lyricsResult = await lyricsPromise;
            if (lyricsResult) {
                console.log(`[Processor] Lyrics: ${track.title} (${lyricsResult.source}, synced: ${!!lyricsResult.synced})`);
            }

            const ext = getExtensionFromFormat(download.format, sourceMimeType);
            const outPath = path.join(jobDir, `${resolvedName}.${ext}`);
            const embedLyrics = wantLyrics && !lyricsSidecar ? lyricsResult : null;
            const metadata = buildMetadataTags(track, albumInfo, download, totalTracks, embedLyrics);
            const needsConv = needsConversion(download.format, sourceMimeType);
            await processWithMetadata(rawPath, outPath, download.format, download.bitrate || 320, metadata, coverPath, needsConv);

            try { fs.unlinkSync(rawPath); } catch { }

            completedTracks++;
            const progress = Math.round((completedTracks / totalTracks) * 85);
            updateDownload(downloadId, {
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

        // Run tracks in parallel batches of TRACK_CONCURRENCY
        updateDownload(downloadId, { status: 'downloading', progress: 0, description: `Downloading ${totalTracks} tracks...` });

        for (let batchStart = 0; batchStart < tracksToDownload.length; batchStart += TRACK_CONCURRENCY) {
            const currentJob = getDownload(downloadId);
            if (currentJob?.status === 'cancelled') { cleanup(jobDir); return; }
            if (Date.now() - jobStartTime > MAX_JOB_DURATION_MS) {
                throw new Error(`Job timed out after ${Math.round((Date.now() - jobStartTime) / 60000)} minutes`);
            }

            const batch = tracksToDownload.slice(batchStart, batchStart + TRACK_CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map((track: any, j: number) => processTrack(track, batchStart + j))
            );

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    downloadedFiles.push(result.value.outPath);
                    if (result.value.lrcPath) sidecarFiles.push(result.value.lrcPath);
                } else if (result.status === 'rejected') {
                    console.error(`[Processor] ❌ Track failed:`, result.reason?.message);
                }
            }
        }

        const failedCount = tracksToDownload.length - downloadedFiles.length;
        if (failedCount > 0) {
            console.warn(`[Processor] ${failedCount}/${tracksToDownload.length} tracks failed for ${downloadId}`);
        }
        if (downloadedFiles.length === 0) {
            throw new Error(`Failed to download any tracks (${tracksToDownload.length} tried, all failed)`);
        }

        // 2b. Attach cover art as separate file if enabled
        const coverFiles: string[] = [];
        const wantAttachCover = download.attachCover !== false && download.attachCover !== 0;
        if (wantAttachCover && coverPath && fs.existsSync(coverPath)) {
            coverFiles.push(coverPath);
        }

        // 2c. Download booklet if enabled and available
        const bookletFiles: string[] = [];
        const wantBooklet = download.downloadBooklet !== false && download.downloadBooklet !== 0;
        if (wantBooklet) {
            try {
                updateDownload(downloadId, { description: 'Checking for booklet...' });
                const bookletPath = await downloadBooklet(albumInfo, jobDir);
                if (bookletPath) {
                    bookletFiles.push(bookletPath);
                }
            } catch (err: any) {
                console.warn(`[Processor] Booklet download error: ${err.message}`);
            }
        }

        // 3. Package + upload
        updateDownload(downloadId, {
            status: 'processing',
            progress: 90,
            description: 'Uploading...',
        });

        let finalFileName: string;
        let contentType: string;
        let publicUrl: string;
        let fileSize: number = 0;

        const allFiles = [...downloadedFiles, ...sidecarFiles, ...coverFiles, ...bookletFiles];

        if (downloadedFiles.length === 1 && sidecarFiles.length === 0 && coverFiles.length === 0 && bookletFiles.length === 0) {
            // Single audio file — upload directly
            const filePath = downloadedFiles[0];
            const ext = path.extname(filePath);
            const track0 = tracksToDownload[0];
            finalFileName = applyNamingPattern(download.trackName || '{track} - {name}', track0, albumInfo, download) + ext;
            contentType = getContentType(download.format);
            const safeFileName = finalFileName.replace(/\s+/g, '_');
            if (getDownload(downloadId)?.status === 'cancelled') throw new Error('cancelled');
            publicUrl = await uploadToR2(filePath, `downloads/${downloadId}/${safeFileName}`, contentType);
            fileSize = fs.statSync(filePath).size;
        } else {
            // Multiple files — stream ZIP directly to R2 without writing to disk
            const zipPattern = download.zipName || '{artists} - {album}';
            finalFileName = applyZipNamingPattern(zipPattern, albumInfo, download) + '.zip';
            contentType = 'application/zip';
            const safeFileName = finalFileName.replace(/\s+/g, '_');
            const r2Key = `downloads/${downloadId}/${safeFileName}`;

            if (getDownload(downloadId)?.status === 'cancelled') throw new Error('cancelled');
            const { stream, upload } = startUploadStreamToR2(r2Key, contentType, finalFileName);
            const archive = archiver('zip', { zlib: { level: 0 } });
            archive.pipe(stream);
            for (const file of allFiles) {
                archive.file(file, { name: path.basename(file) });
            }
            await Promise.all([archive.finalize(), upload.done()]);
            fileSize = archive.pointer();
            publicUrl = buildPublicUrl(r2Key);
        }

        // 4. Update download record — files are temporary, metadata is permanent
        if (fileSize < 1000) {
            throw new Error(`Output file suspiciously small (${fileSize} bytes) — likely empty ZIP`);
        }

        const isGuest = download.userId.startsWith('guest_');
        const deleteAfter = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        updateDownload(downloadId, {
            status: 'completed',
            progress: 100,
            description: 'Download ready!',
            fileName: finalFileName,
            fileSize,
            downloadUrl: publicUrl,
            guestDownloadIssuedAt: new Date().toISOString(),
            guestDeleteAfter: deleteAfter,
        });
        console.log(`[Processor] ✅ ${downloadId} completed: ${finalFileName} (${formatBytes(fileSize)})`);

        // 5. Cleanup temp files
        cleanup(jobDir);

    } catch (error: any) {
        console.error(`[Processor] ❌ ${downloadId} failed:`, error.message);
        updateDownload(downloadId, {
            status: 'failed',
            description: 'Download failed',
            error: error.message || 'Unknown error',
        });

        // Cleanup
        const jobDir = path.join(WORK_DIR, downloadId);
        cleanup(jobDir);
    }
}

// ======================== Metadata helpers ========================

interface MetadataTags {
    title: string;
    artist: string;
    album: string;
    album_artist: string;
    date: string;
    year: string;
    track: string;        // "5/13"
    disc: string;         // "1/1"
    genre: string;
    copyright: string;
    publisher: string;    // label
    isrc: string;
    barcode: string;      // UPC
    comment: string;
    syncedLyrics: string | null;   // with timestamps [mm:ss.xx]
    plainLyrics: string | null;    // text only
    composer: string;
}

function buildMetadataTags(
    track: any, albumInfo: any, download: any,
    totalTracks: number, lyrics: LyricsResult | null
): MetadataTags {
    const artist = track.performer?.name || download.artistName || 'Unknown';
    const title = track.version ? `${track.title} (${track.version})` : (track.title || 'Unknown');
    const album = albumInfo.title || download.albumTitle || 'Unknown Album';
    const albumArtist = albumInfo.artist?.name || artist;
    const releaseDate = albumInfo.release_date_original || albumInfo.released_at?.split('T')[0] || '';
    const year = releaseDate ? new Date(releaseDate).getFullYear().toString() : '';
    const trackNumber = track.track_number || 1;
    const discNumber = track.media_number || 1;
    const totalDiscs = albumInfo.media_count || 1;
    const genre = albumInfo.genre?.name || albumInfo.genres_list?.join(', ') || '';
    const copyright = albumInfo.copyright || '';
    const publisher = albumInfo.label?.name || '';
    const isrc = track.isrc || '';
    const barcode = albumInfo.upc || '';
    const composer = track.composer?.name || '';

    return {
        title,
        artist,
        album,
        album_artist: albumArtist,
        date: releaseDate,
        year,
        track: `${trackNumber}/${totalTracks}`,
        disc: `${discNumber}/${totalDiscs}`,
        genre,
        copyright,
        publisher,
        isrc,
        barcode,
        comment: '',
        syncedLyrics: lyrics?.synced || null,
        plainLyrics: lyrics?.plain || null,
        composer,
    };
}

// ======================== FFmpeg with metadata ========================

async function processWithMetadata(
    inputPath: string, outputPath: string,
    format: string, bitrate: number,
    metadata: MetadataTags, coverPath: string | null,
    needsConv: boolean
): Promise<void> {
    const fmt = format?.toUpperCase() || 'FLAC';
    const isFLAC = fmt === 'FLAC' || (!needsConv && outputPath.endsWith('.flac'));
    const isMP3 = fmt === 'MP3' || outputPath.toLowerCase().endsWith('.mp3');

    await new Promise<void>((resolve, reject) => {
        const args: string[] = [];

        // Input: audio file
        args.push('-i', inputPath);

        // WAV doesn't support embedded cover art or complex metadata
        const isWAV = fmt === 'WAV';
        const embedCoverViaFFmpeg = coverPath && fs.existsSync(coverPath) && !isFLAC && !isWAV;
        if (embedCoverViaFFmpeg) {
            args.push('-i', coverPath!);
        }

        args.push('-y'); // Overwrite

        // Strip ALL source metadata so our tags always win
        args.push('-map_metadata', '-1');

        // Map streams
        args.push('-map', '0:a'); // Audio from first input

        if (embedCoverViaFFmpeg) {
            args.push('-map', '1:v'); // Video (cover) from second input
            args.push('-c:v', 'copy');
            args.push('-disposition:v:0', 'attached_pic');
        }

        // Audio codec
        if (needsConv) {
            switch (fmt) {
                case 'MP3':
                    args.push('-codec:a', 'libmp3lame', '-b:a', `${bitrate}k`);
                    break;
                case 'WAV':
                    args.push('-codec:a', 'pcm_s16le');
                    break;
                case 'AAC':
                    args.push('-codec:a', 'aac', '-b:a', `${bitrate}k`);
                    break;
                case 'OGG':
                    args.push('-codec:a', 'libvorbis', '-b:a', `${bitrate}k`);
                    break;
                case 'OPUS':
                    args.push('-codec:a', 'libopus', '-b:a', `${bitrate}k`);
                    break;
                case 'ALAC':
                    args.push('-codec:a', 'alac');
                    break;
                default:
                    args.push('-codec:a', 'flac');
            }
        } else {
            args.push('-codec:a', 'copy');
        }

        if (isMP3) {
            args.push('-id3v2_version', '3');
        }

        // ====== Metadata tags ======
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

        // Lyrics embedding — synced in LYRICS tag, plain text in UNSYNCEDLYRICS
        if (metadata.syncedLyrics) {
            args.push('-metadata', `LYRICS=${metadata.syncedLyrics}`);
        }
        if (metadata.plainLyrics) {
            args.push('-metadata', `UNSYNCEDLYRICS=${metadata.plainLyrics}`);
        } else if (metadata.syncedLyrics && !metadata.plainLyrics) {
            // If we only have synced, strip timestamps for UNSYNCEDLYRICS
            const stripped = metadata.syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '');
            args.push('-metadata', `UNSYNCEDLYRICS=${stripped}`);
        }

        args.push(outputPath);

        console.log(`[FFmpeg] Running: ffmpeg ${args.map(a => a.length > 200 ? a.slice(0, 50) + '...' : a).join(' ')}`);

        const ffmpeg = spawn('ffmpeg', args, { stdio: 'pipe' });

        let stderr = '';
        ffmpeg.stderr?.on('data', (data) => { stderr += data.toString(); });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                console.error(`[FFmpeg] stderr: ${stderr.slice(-1000)}`);
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(err);
        });
    });

    // For FLAC: embed cover art via metaflac (avoids ffmpeg re-encode overhead)
    if (isFLAC && coverPath && fs.existsSync(coverPath) && fs.existsSync(outputPath)) {
        try {
            await embedFLACCover(outputPath, coverPath);
        } catch (err: any) {
            console.warn(`[Processor] metaflac failed, skipping cover: ${err.message}`);
        }
    }
}

function embedFLACCover(flacPath: string, coverPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const metaflac = spawn('metaflac', [
            '--import-picture-from', coverPath,
            flacPath,
        ], { stdio: 'pipe' });

        let stderr = '';
        metaflac.stderr?.on('data', (d) => { stderr += d.toString(); });
        metaflac.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`metaflac exit ${code}: ${stderr}`));
        });
        metaflac.on('error', reject);
    });
}

function embedCoverFallback(audioPath: string, coverPath: string): Promise<void> {
    const tmpOut = audioPath + '.tmp' + path.extname(audioPath);
    return new Promise((resolve, reject) => {
        const args = [
            '-i', audioPath,
            '-i', coverPath,
            '-y',
            '-map', '0', '-map', '1:v',
            '-c', 'copy',
            '-disposition:v:0', 'attached_pic',
            '-map_metadata', '0',
            tmpOut,
        ];
        const ffmpeg = spawn('ffmpeg', args, { stdio: 'pipe' });
        let stderr = '';
        ffmpeg.stderr?.on('data', (d) => { stderr += d.toString(); });
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                try {
                    fs.unlinkSync(audioPath);
                    fs.renameSync(tmpOut, audioPath);
                    resolve();
                } catch (e: any) { reject(e); }
            } else {
                try { fs.unlinkSync(tmpOut); } catch { }
                reject(new Error(`ffmpeg cover fallback exit ${code}`));
            }
        });
        ffmpeg.on('error', reject);
    });
}

// ======================== Helpers ========================

function sanitizeFilename(name: string): string {
    return name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\.+$/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
}

/**
 * Apply naming pattern with variable substitution
 * Supported variables: {artists}, {name}, {album}, {year}, {track}, {disc}, {genre}, {version}
 */
function applyNamingPattern(
    pattern: string,
    track: any,
    albumInfo: any,
    download: any
): string {
    const artist = track.performer?.name || download.artistName || 'Unknown';
    const title = track.version ? `${track.title} (${track.version})` : (track.title || 'Unknown');
    const album = albumInfo.title || download.albumTitle || 'Unknown Album';
    const year = albumInfo.release_date_original
        ? new Date(albumInfo.release_date_original).getFullYear().toString()
        : '';
    const trackNum = String(track.track_number || 1).padStart(2, '0');
    const discNum = String(track.media_number || 1).padStart(2, '0');
    const genre = albumInfo.genre?.name || '';
    const version = track.version || '';

    const result = pattern
        .replace(/\{artists?\}/gi, artist)
        .replace(/\{name\}/gi, title)
        .replace(/\{album\}/gi, album)
        .replace(/\{year\}/gi, year)
        .replace(/\{track\}/gi, trackNum)
        .replace(/\{disc\}/gi, discNum)
        .replace(/\{genre\}/gi, genre)
        .replace(/\{version\}/gi, version);

    return sanitizeFilename(result);
}

/**
 * Apply zip naming pattern for album downloads
 * Supported variables: {artists}, {name}, {album}, {year}, {genre}
 */
function applyZipNamingPattern(
    pattern: string,
    albumInfo: any,
    download: any
): string {
    const artist = albumInfo.artist?.name || download.artistName || 'Unknown';
    const name = albumInfo.title || download.albumTitle || 'Unknown Album';
    const year = albumInfo.release_date_original
        ? new Date(albumInfo.release_date_original).getFullYear().toString()
        : '';
    const genre = albumInfo.genre?.name || '';

    const result = pattern
        .replace(/\{artists?\}/gi, artist)
        .replace(/\{name\}/gi, name)
        .replace(/\{album\}/gi, name)
        .replace(/\{year\}/gi, year)
        .replace(/\{genre\}/gi, genre);

    return sanitizeFilename(result);
}

function getExtensionFromFormat(format: string, mimeType: string): string {
    const fmt = format?.toUpperCase() || 'FLAC';
    switch (fmt) {
        case 'MP3': return 'mp3';
        case 'WAV': return 'wav';
        case 'ALAC': return 'm4a';
        case 'AAC': return 'm4a';
        case 'OGG': return 'ogg';
        case 'OPUS': return 'opus';
        case 'FLAC': return 'flac';
        default: return 'flac';
    }
}

function getContentType(format: string): string {
    const fmt = format?.toUpperCase() || 'FLAC';
    switch (fmt) {
        case 'MP3': return 'audio/mpeg';
        case 'WAV': return 'audio/wav';
        case 'AAC': return 'audio/mp4';
        case 'OGG': return 'audio/ogg';
        case 'OPUS': return 'audio/opus';
        default: return 'audio/flac';
    }
}

function needsConversion(targetFormat: string, sourceMimeType: string): boolean {
    const fmt = targetFormat?.toUpperCase() || 'FLAC';
    const mime = sourceMimeType?.toLowerCase() || '';
    // No conversion needed if source already matches target
    if (fmt === 'FLAC' && (mime.includes('flac') || mime.includes('x-flac'))) return false;
    if (fmt === 'MP3' && mime.includes('mpeg')) return false;
    if (fmt === 'WAV' && (mime.includes('wav') || mime.includes('wave'))) return false;
    if (fmt === 'AAC' && (mime.includes('aac') || mime.includes('mp4'))) return false;
    if (fmt === 'ALAC' && mime.includes('alac')) return false;
    if (fmt === 'OPUS' && mime.includes('opus')) return false;
    // If source is FLAC and target is FLAC, no conversion (even if mime is generic)
    if (fmt === 'FLAC' && !mime.includes('mpeg')) return false;
    return true; // Source doesn't match target — needs conversion
}


function cleanup(dir: string): void {
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } catch (err) {
        console.warn(`[Processor] Cleanup failed for ${dir}:`, err);
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ======================== Stale job sweeper ========================

function sweepStaleJobs(): void {
    const failed = failStaleActiveJobs(30 * 60 * 1000);
    if (failed > 0) {
        console.warn(`[Processor] Stale sweeper: failed ${failed} job(s) with no progress for 30+ minutes`);
    }
    const released = releaseExpiredWorkerJobs(config.worker.leaseTimeoutMs);
    if (released > 0) {
        console.warn(`[Processor] Released ${released} expired worker job(s)`);
    }
}

function cleanupOrphanedDirs(): void {
    try {
        const dirs = fs.readdirSync(WORK_DIR);
        let cleaned = 0;
        for (const dir of dirs) {
            const fullPath = path.join(WORK_DIR, dir);
            if (!fs.statSync(fullPath).isDirectory()) continue;
            const download = getDownload(dir);
            if (!download || !['downloading', 'processing', 'pending'].includes(download.status)) {
                try { fs.rmSync(fullPath, { recursive: true, force: true }); cleaned++; } catch { }
            }
        }
        if (cleaned > 0) console.log(`[Processor] Cleaned up ${cleaned} orphaned processing dirs`);
    } catch (err: any) {
        console.warn(`[Processor] Dir cleanup error: ${err.message}`);
    }
}

// ======================== Startup: Process pending jobs ========================

export function processPendingJobs(): void {
    // Reset orphaned active jobs left over from previous process crash/restart
    const orphaned = resetOrphanedActiveJobs();
    if (orphaned > 0) {
        console.log(`[Processor] Reset ${orphaned} orphaned active jobs to pending`);
    }

    const pending = getPendingDownloads();
    for (const job of pending) {
        enqueueDownload(job.id);
    }
    if (pending.length > 0) {
        console.log(`[Processor] Re-queued ${pending.length} pending jobs from DB`);
    }

    // Periodic stale job sweeper — every 2 minutes
    setInterval(sweepStaleJobs, 2 * 60 * 1000);

    // Cleanup orphaned processing dirs every 10 minutes
    cleanupOrphanedDirs();
    setInterval(cleanupOrphanedDirs, 10 * 60 * 1000);
}
