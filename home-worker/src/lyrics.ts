import axios from 'axios';

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const KPOE_APPLE_URL = 'https://lyricsplus.prjktla.workers.dev/v2/lyrics/get';
const MXM_API_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';

export interface LyricsResult {
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
    } catch {}

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
    } catch {}

    return null;
}

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
    } catch {}
    return null;
}

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
    } catch {}
    return null;
}

async function fetchLyricsFromMusixmatch(title: string, artist: string, album?: string, duration?: number): Promise<LyricsResult | null> {
    const token = await getMxmToken();
    if (!token) return null;

    try {
        const params: any = {
            format: 'json', namespace: 'lyrics_richsynched', subtitle_format: 'lrc',
            app_id: 'web-desktop-app-v1.0', q_artist: artist.trim(), q_track: title.trim(),
            usertoken: token, t: Date.now(),
        };
        if (album) params.q_album = album.trim();
        if (duration && duration > 0) params.f_subtitle_length = Math.floor(duration);

        const response = await axios.get(`${MXM_API_BASE}/macro.subtitles.get`, {
            params, timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0', authority: 'apic-desktop.musixmatch.com', cookie: 'x-mxm-token-guid=' },
        });

        const macroCalls = response.data?.message?.body?.macro_calls;
        if (!macroCalls) return null;
        if (macroCalls['matcher.track.get']?.message?.header?.status_code !== 200) return null;
        if (macroCalls['matcher.track.get']?.message?.header?.hint === 'renew') {
            mxmToken = null; mxmTokenExpiry = 0;
        }

        const subsMsg = macroCalls['track.subtitles.get']?.message;
        if (subsMsg?.header?.status_code === 200) {
            const subtitleBody = subsMsg.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
            if (subtitleBody && typeof subtitleBody === 'string' && subtitleBody.includes('[')) {
                const plain = subtitleBody.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '');
                return { synced: subtitleBody, plain, source: 'Musixmatch' };
            }
        }

        const lyricsMsg = macroCalls['track.lyrics.get']?.message;
        if (lyricsMsg?.header?.status_code === 200) {
            const lyricsBody = lyricsMsg.body?.lyrics?.lyrics_body;
            if (lyricsBody && typeof lyricsBody === 'string' && lyricsBody.length > 10 && !lyricsMsg.body?.lyrics?.restricted) {
                return { synced: null, plain: lyricsBody, source: 'Musixmatch' };
            }
        }
    } catch {}
    return null;
}

export async function fetchLyricsForTrack(title: string, artist: string, album?: string, duration?: number): Promise<LyricsResult | null> {
    const cleanTitle = cleanForSearch(title);
    const cleanArtist = cleanForSearch(artist);
    const cleanAlbum = album ? cleanForSearch(album) : undefined;

    const [appleRes, mxmRes, lrclibRes] = await Promise.allSettled([
        fetchLyricsFromApple(cleanTitle, cleanArtist, cleanAlbum, duration),
        fetchLyricsFromMusixmatch(cleanTitle, cleanArtist, cleanAlbum, duration),
        fetchLyricsFromLrclib(cleanTitle, cleanArtist, cleanAlbum, duration),
    ]);

    const apple = appleRes.status === 'fulfilled' ? appleRes.value : null;
    const mxm = mxmRes.status === 'fulfilled' ? mxmRes.value : null;
    const lrclib = lrclibRes.status === 'fulfilled' ? lrclibRes.value : null;

    return (apple?.synced ? apple : null)
        ?? (mxm?.synced ? mxm : null)
        ?? (lrclib?.synced ? lrclib : null)
        ?? apple ?? mxm ?? lrclib ?? null;
}
