/**
 * Lyrics Routes — /v2/lyrics
 * Sources: Apple/Spotify (KPoe workers.dev) → Musixmatch (direct API) → LRCLIB (fallback)
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import axios from 'axios';

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const KPOE_APPLE_URL = 'https://lyricsplus.prjktla.workers.dev/v2/lyrics/get';
const MXM_API_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';

// In-memory cache (persistent across requests)
const lyricsCache = new Map<string, any>();

function getCacheKey(title: string, artist: string, album?: string): string {
    return `${artist.toLowerCase().trim()}:${title.toLowerCase().trim()}:${(album || '').toLowerCase().trim()}`;
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

// --- Apple/Spotify via LyricsPlus (KPoe workers.dev) ---

function convertKpoeLyrics(payload: any) {
    if (!payload) return { lines: [], sourceLabel: 'Unknown', isWordSynced: false };
    let rawLyrics = Array.isArray(payload.lyrics) ? payload.lyrics
        : Array.isArray(payload.data?.lyrics) ? payload.data.lyrics
            : Array.isArray(payload.data) ? payload.data : null;

    if (!rawLyrics) return { lines: [], sourceLabel: 'Unknown', isWordSynced: false };

    const sourceLabel = payload.metadata?.source || payload.metadata?.provider || 'LyricsPlus';
    const isLineType = payload.type === 'Line';
    const lines: any[] = [];
    let hasWordSync = false;
    let hasTiming = false;

    for (const entry of rawLyrics) {
        if (!entry) continue;
        const lineText = typeof entry.text === 'string' ? entry.text : '';
        const lineStart = toMilliseconds(entry.time ?? entry.startTimeMs ?? 0, 0);
        const lineDuration = toMilliseconds(entry.duration, 0);
        const lineEnd = toMilliseconds(entry.endTime, 0) || (lineStart + lineDuration);

        if (lineStart > 0) hasTiming = true;

        const syllabus: any[] = Array.isArray(entry.syllabus) ? entry.syllabus : [];
        const mainSyllables: any[] = [];
        const backgroundSyllables: any[] = [];

        if (!isLineType && syllabus.length > 0) {
            for (const syl of syllabus) {
                if (!syl) continue;
                const sylStart = toMilliseconds(syl.time, lineStart);
                const sylDuration = toMilliseconds(syl.duration, 0);
                const sylEnd = sylDuration > 0 ? sylStart + sylDuration : lineEnd;
                const syllableData = { text: syl.text || '', timestamp: sylStart, endtime: sylEnd, part: !!syl.part };
                if (syl.isBackground) backgroundSyllables.push(syllableData);
                else mainSyllables.push(syllableData);
            }
        }

        if (mainSyllables.length === 0 && lineText) {
            mainSyllables.push({ text: lineText, timestamp: lineStart, endtime: lineEnd, part: false });
        }
        hasWordSync = hasWordSync || mainSyllables.length > 1 || backgroundSyllables.length > 0;
        lines.push({
            text: mainSyllables, backgroundText: backgroundSyllables,
            timestamp: lineStart, endtime: lineEnd,
            isWordSynced: mainSyllables.length > 1 || backgroundSyllables.length > 0,
        });
    }
    return { lines, sourceLabel, isWordSynced: hasWordSync, hasTiming };
}

function linesToLrc(lines: any[], title = '', artist = '', album = '', source = ''): string {
    const lrcLines: string[] = [];
    if (title) lrcLines.push(`[ti:${title}]`);
    if (artist) lrcLines.push(`[ar:${artist}]`);
    if (album) lrcLines.push(`[al:${album}]`);
    if (source) lrcLines.push(`[re:${source}]`);

    for (const line of lines) {
        if (!line.text || line.text.length === 0) continue;
        const timestamp = formatLrcTimestamp(line.timestamp || 0);
        const lineText = line.text.map((s: any) => s.text || '').join('').trim();
        if (lineText) lrcLines.push(`[${timestamp}]${lineText}`);
    }
    return lrcLines.join('\n');
}

async function fetchFromApple(title: string, artist: string, album?: string, duration?: number): Promise<any> {
    const params: any = { title: title.trim(), artist: artist.trim(), source: 'spotify,apple,lyricsplus' };
    if (album) params.album = album.trim();
    if (duration && duration > 0) params.duration = String(Math.round(duration));

    try {
        const response = await axios.get(KPOE_APPLE_URL, { params, timeout: 10000 });
        if (response.status === 200) {
            const { lines, sourceLabel, isWordSynced, hasTiming } = convertKpoeLyrics(response.data);
            if (lines.length > 0) {
                const lrc = linesToLrc(lines, title, artist, album || '', sourceLabel);
                return {
                    lyrics: lrc,
                    synced: hasTiming,
                    format: 'lrc',
                    source: sourceLabel,
                    timing: !hasTiming ? 'None' : (isWordSynced ? 'Word' : 'Line'),
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
            mxmTokenExpiry = Date.now() + 8 * 60 * 1000;
            return token;
        }
    } catch { }
    return null;
}

async function fetchFromMusixmatch(title: string, artist: string, album?: string, duration?: number): Promise<any> {
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

        const matcherStatus = macroCalls['matcher.track.get']?.message?.header?.status_code;
        if (matcherStatus !== 200) return null;

        // Check if token needs renewal
        const hint = macroCalls['matcher.track.get']?.message?.header?.hint;
        if (hint === 'renew') {
            mxmToken = null;
            mxmTokenExpiry = 0;
        }

        // Try synced subtitles
        const subsMsg = macroCalls['track.subtitles.get']?.message;
        if (subsMsg?.header?.status_code === 200) {
            const subtitleList = subsMsg.body?.subtitle_list;
            if (Array.isArray(subtitleList) && subtitleList.length > 0) {
                const subtitleBody = subtitleList[0]?.subtitle?.subtitle_body;
                if (subtitleBody && typeof subtitleBody === 'string' && subtitleBody.includes('[')) {
                    return { lyrics: subtitleBody, synced: true, format: 'lrc', source: 'Musixmatch', timing: 'Line' };
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
                    return { lyrics: lyricsBody, synced: false, format: 'plain', source: 'Musixmatch', timing: 'None' };
                }
            }
        }
    } catch { }
    return null;
}

// --- LRCLIB (fallback) ---

async function fetchFromLrclib(title: string, artist: string, album?: string, duration?: number): Promise<any> {
    try {
        const params: any = { artist_name: artist.trim(), track_name: title.trim() };
        if (album) params.album_name = album.trim();
        if (duration && duration > 0) params.duration = Math.round(duration);

        const response = await axios.get(`${LRCLIB_BASE_URL}/get`, {
            params, timeout: 8000,
            headers: { 'User-Agent': 'ARCOD-Qobuz-DL/1.0 (https://arcod.app)' },
        });

        if (response.status === 200 && response.data) {
            if (response.data.syncedLyrics) {
                return { lyrics: response.data.syncedLyrics, synced: true, format: 'lrc', source: 'LRCLIB', timing: 'Line' };
            }
            if (response.data.plainLyrics) {
                return { lyrics: response.data.plainLyrics, synced: false, format: 'plain', source: 'LRCLIB', timing: 'None' };
            }
        }
    } catch (err: any) {
        if (err.response?.status !== 404) console.log(`[LRCLIB] Error: ${err.message}`);
    }

    // Search fallback
    try {
        const searchResponse = await axios.get(`${LRCLIB_BASE_URL}/search`, {
            params: { artist_name: artist.trim(), track_name: title.trim() },
            timeout: 8000,
            headers: { 'User-Agent': 'ARCOD-Qobuz-DL/1.0 (https://arcod.app)' },
        });
        if (searchResponse.status === 200 && Array.isArray(searchResponse.data) && searchResponse.data.length > 0) {
            const best = searchResponse.data.find((r: any) => r.syncedLyrics) || searchResponse.data[0];
            if (best.syncedLyrics) return { lyrics: best.syncedLyrics, synced: true, format: 'lrc', source: 'LRCLIB', timing: 'Line' };
            if (best.plainLyrics) return { lyrics: best.plainLyrics, synced: false, format: 'plain', source: 'LRCLIB', timing: 'None' };
        }
    } catch { }

    return null;
}

// --- Main orchestrator: prefer synced from any source, then best plain ---

async function fetchLyricsWithFallback(title: string, artist: string, album?: string, duration?: number) {
    if (!title || !artist) return { lyrics: null, synced: false, format: 'lrc', source: 'none', error: 'Title and artist required' };

    // 1. Apple/Spotify via LyricsPlus (best synced)
    let result = await fetchFromApple(title, artist, album, duration);
    if (result?.lyrics && result?.synced) return result;

    // 2. Musixmatch direct API
    let mxmResult = await fetchFromMusixmatch(title, artist, album, duration);
    if (mxmResult?.lyrics && mxmResult?.synced) return mxmResult;

    // 3. LRCLIB (community-sourced)
    let lrclibResult = await fetchFromLrclib(title, artist, album, duration);
    if (lrclibResult?.lyrics && lrclibResult?.synced) return lrclibResult;

    // 4. No synced found — return best plain text
    if (result?.lyrics) return result;
    if (mxmResult?.lyrics) return mxmResult;
    if (lrclibResult?.lyrics) return lrclibResult;

    return { lyrics: null, synced: false, format: 'lrc', source: 'none', error: 'No lyrics found' };
}

export async function lyricsRoutes(fastify: FastifyInstance) {

    // GET & POST /v2/lyrics
    fastify.route({
        method: ['GET', 'POST'],
        url: '/v2/lyrics',
        handler: async (req: FastifyRequest, reply: FastifyReply) => {
            let request: any;
            if (req.method === 'POST') {
                request = req.body;
            } else {
                const params = req.query as any;
                request = { title: params.title, artist: params.artist, album: params.album, duration: params.duration ? parseFloat(params.duration) : undefined };
            }

            if (!request?.title || !request?.artist) {
                return reply.code(400).send({ error: 'Title and artist are required' });
            }

            const cleanTitle = cleanForSearch(request.title);
            const cleanArtist = cleanForSearch(request.artist);
            const cleanAlbum = request.album ? cleanForSearch(request.album) : undefined;

            const cacheKey = getCacheKey(cleanTitle, cleanArtist, cleanAlbum);
            if (lyricsCache.has(cacheKey)) {
                return reply.send(lyricsCache.get(cacheKey));
            }

            const result = await fetchLyricsWithFallback(cleanTitle, cleanArtist, cleanAlbum, request.duration);
            lyricsCache.set(cacheKey, result);
            return reply.send(result);
        },
    });

    // GET /v2/lyrics/health
    fastify.get('/v2/lyrics/health', async (_req, reply) => {
        return reply.send({
            status: 'ok',
            service: 'Lyrics Service (Fastify)',
            version: '2.1.0',
            sources: ['Apple/Spotify (LyricsPlus)', 'Musixmatch (Direct)', 'LRCLIB'],
            cacheSize: lyricsCache.size,
        });
    });
}
