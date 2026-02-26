/**
 * Lyrics Service Lambda
 * Fetches synced lyrics from multiple sources with fallback:
 * 1. LRCLIB (free, open-source, reliable)
 * 2. Musixmatch via LyricsPlus (backup)
 * 3. Other sources via LyricsPlus (Spotify, Apple, etc.)
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import axios from 'axios';

// LRCLIB - Primary source (free, open, reliable)
const LRCLIB_BASE_URL = 'https://lrclib.net/api';

// LyricsPlus (KPoe) servers - Fallback
const KPOE_SERVERS = [
    'https://lyricsplus.prjktla.workers.dev',
    'https://lyrics-plus-backend.vercel.app',
    'https://lyricsplus.onrender.com',
    'https://lyricsplus.prjktla.online',
];

// Source priorities for LyricsPlus
const MUSIXMATCH_SOURCE = 'musixmatch-word,musixmatch';
const FALLBACK_SOURCE = 'spotify,apple,lyricsplus';

// In-memory cache (persists across warm Lambda invocations)
const lyricsCache = new Map<string, LyricsResponse>();

interface LyricsRequest {
    title: string;
    artist: string;
    album?: string;
    duration?: number;
}

interface LyricsResponse {
    lyrics: string | null;
    synced: boolean;
    format: string;
    source: string;
    timing?: string;
    error?: string;
}

interface Syllable {
    text: string;
    timestamp: number;
    endtime: number;
    part?: boolean;
}

function getCacheKey(title: string, artist: string, album?: string): string {
    return `${artist.toLowerCase().trim()}:${title.toLowerCase().trim()}:${(album || '').toLowerCase().trim()}`;
}

function toMilliseconds(value: any, fallback: number = 0): number {
    try {
        const num = parseFloat(value);
        if (!num || num < 0) return fallback;
        if (num < 1000 && !Number.isInteger(num)) {
            return Math.round(num * 1000);
        }
        return Math.max(0, Math.round(num));
    } catch {
        return fallback;
    }
}

function formatLrcTimestamp(ms: number): string {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

// ==================== LRCLIB Source (Primary) ====================

async function fetchFromLrclib(
    title: string,
    artist: string,
    album?: string,
    duration?: number
): Promise<LyricsResponse | null> {
    try {
        // Try exact match first with GET /api/get
        const params: any = {
            artist_name: artist.trim(),
            track_name: title.trim(),
        };
        if (album) params.album_name = album.trim();
        if (duration && duration > 0) params.duration = Math.round(duration);

        const response = await axios.get(`${LRCLIB_BASE_URL}/get`, {
            params,
            timeout: 8000,
            headers: {
                'User-Agent': 'ARCOD-Qobuz-DL/1.0 (https://arcod.app)'
            }
        });

        if (response.status === 200 && response.data) {
            const data = response.data;

            // Prefer synced lyrics
            if (data.syncedLyrics) {
                console.log(`[LRCLIB] Found synced lyrics for: ${artist} - ${title}`);
                return {
                    lyrics: data.syncedLyrics,
                    synced: true,
                    format: 'lrc',
                    source: 'LRCLIB',
                    timing: 'Line'
                };
            }

            // Fall back to plain lyrics
            if (data.plainLyrics) {
                console.log(`[LRCLIB] Found plain lyrics for: ${artist} - ${title}`);
                return {
                    lyrics: data.plainLyrics,
                    synced: false,
                    format: 'plain',
                    source: 'LRCLIB',
                    timing: 'None'
                };
            }
        }
    } catch (err: any) {
        // 404 means no lyrics found - not an error
        if (err.response?.status === 404) {
            console.log(`[LRCLIB] No exact match for: ${artist} - ${title}`);
        } else {
            console.log(`[LRCLIB] Error: ${err.message}`);
        }
    }

    // Try search endpoint as fallback
    try {
        const searchResponse = await axios.get(`${LRCLIB_BASE_URL}/search`, {
            params: {
                artist_name: artist.trim(),
                track_name: title.trim(),
            },
            timeout: 8000,
            headers: {
                'User-Agent': 'ARCOD-Qobuz-DL/1.0 (https://arcod.app)'
            }
        });

        if (searchResponse.status === 200 && Array.isArray(searchResponse.data) && searchResponse.data.length > 0) {
            // Find best match - prefer one with synced lyrics
            const withSynced = searchResponse.data.find((r: any) => r.syncedLyrics);
            const best = withSynced || searchResponse.data[0];

            if (best.syncedLyrics) {
                console.log(`[LRCLIB] Found synced lyrics via search for: ${artist} - ${title}`);
                return {
                    lyrics: best.syncedLyrics,
                    synced: true,
                    format: 'lrc',
                    source: 'LRCLIB',
                    timing: 'Line'
                };
            }

            if (best.plainLyrics) {
                console.log(`[LRCLIB] Found plain lyrics via search for: ${artist} - ${title}`);
                return {
                    lyrics: best.plainLyrics,
                    synced: false,
                    format: 'plain',
                    source: 'LRCLIB',
                    timing: 'None'
                };
            }
        }
    } catch (err: any) {
        console.log(`[LRCLIB] Search error: ${err.message}`);
    }

    return null;
}

// ==================== LyricsPlus Source (Fallback) ====================

function convertKpoeLyrics(payload: any): { lines: any[]; sourceLabel: string; isWordSynced: boolean } {
    if (!payload) return { lines: [], sourceLabel: 'Unknown', isWordSynced: false };

    let rawLyrics: any[] | null = null;

    if (Array.isArray(payload.lyrics)) {
        rawLyrics = payload.lyrics;
    } else if (Array.isArray(payload.data?.lyrics)) {
        rawLyrics = payload.data.lyrics;
    } else if (Array.isArray(payload.data)) {
        rawLyrics = payload.data;
    }

    if (!rawLyrics) return { lines: [], sourceLabel: 'Unknown', isWordSynced: false };

    const sourceLabel = payload.metadata?.source || payload.metadata?.provider || 'LyricsPlus';
    const isLineType = payload.type === 'Line';
    const lines: any[] = [];
    let hasWordSync = false;

    for (const entry of rawLyrics) {
        if (!entry) continue;

        const lineText = typeof entry.text === 'string' ? entry.text : '';
        const lineStart = toMilliseconds(entry.time, 0);
        const lineDuration = toMilliseconds(entry.duration, 0);
        const explicitEnd = toMilliseconds(entry.endTime, 0);
        const lineEnd = explicitEnd || (lineStart + lineDuration);

        const syllabus: any[] = Array.isArray(entry.syllabus) ? entry.syllabus : [];
        const mainSyllables: Syllable[] = [];
        const backgroundSyllables: Syllable[] = [];

        if (!isLineType && syllabus.length > 0) {
            for (const syl of syllabus) {
                if (!syl) continue;

                const sylStart = toMilliseconds(syl.time, lineStart);
                const sylDuration = toMilliseconds(syl.duration, 0);
                const sylEnd = sylDuration > 0 ? sylStart + sylDuration : lineEnd;

                const syllableData: Syllable = {
                    text: syl.text || '',
                    timestamp: sylStart,
                    endtime: sylEnd,
                    part: !!syl.part
                };

                if (syl.isBackground) {
                    backgroundSyllables.push(syllableData);
                } else {
                    mainSyllables.push(syllableData);
                }
            }
        }

        if (mainSyllables.length === 0 && lineText) {
            mainSyllables.push({
                text: lineText,
                timestamp: lineStart,
                endtime: lineEnd,
                part: false
            });
        }

        hasWordSync = hasWordSync || mainSyllables.length > 1 || backgroundSyllables.length > 0;

        lines.push({
            text: mainSyllables,
            backgroundText: backgroundSyllables,
            timestamp: lineStart,
            endtime: lineEnd,
            isWordSynced: mainSyllables.length > 1 || backgroundSyllables.length > 0
        });
    }

    return { lines, sourceLabel, isWordSynced: hasWordSync };
}

function linesToLrc(lines: any[], title: string = '', artist: string = '', album: string = '', source: string = ''): string {
    const lrcLines: string[] = [];

    if (title) lrcLines.push(`[ti:${title}]`);
    if (artist) lrcLines.push(`[ar:${artist}]`);
    if (album) lrcLines.push(`[al:${album}]`);
    if (source) lrcLines.push(`[re:${source}]`);

    for (const line of lines) {
        if (!line.text || line.text.length === 0) continue;

        const timestamp = formatLrcTimestamp(line.timestamp || 0);
        const lineText = line.text.map((s: Syllable) => s.text || '').join('').trim();

        if (lineText) {
            lrcLines.push(`[${timestamp}]${lineText}`);
        }
    }

    return lrcLines.join('\n');
}

async function fetchFromLyricsPlus(
    title: string,
    artist: string,
    album?: string,
    duration?: number,
    sourceOrder: string = MUSIXMATCH_SOURCE
): Promise<LyricsResponse | null> {
    const params: any = {
        title: title.trim(),
        artist: artist.trim(),
        source: sourceOrder
    };

    if (album) params.album = album.trim();
    if (duration && duration > 0) params.duration = String(Math.round(duration));

    for (const baseUrl of KPOE_SERVERS) {
        try {
            const url = `${baseUrl.replace(/\/$/, '')}/v2/lyrics/get`;
            const response = await axios.get(url, { params, timeout: 10000 });

            if (response.status === 200) {
                const { lines, sourceLabel, isWordSynced } = convertKpoeLyrics(response.data);

                if (lines.length > 0) {
                    const lrcLyrics = linesToLrc(lines, title, artist, album || '', sourceLabel);
                    const timingType = isWordSynced ? 'Word' : 'Line';

                    return {
                        lyrics: lrcLyrics,
                        synced: true,
                        format: 'lrc',
                        source: sourceLabel,
                        timing: timingType
                    };
                }
            }
        } catch (err: any) {
            console.log(`[LyricsPlus] Error from ${baseUrl}: ${err.message}`);
            continue;
        }
    }

    return null;
}

// ==================== Main Fetch Logic ====================

async function fetchLyricsWithFallback(
    title: string,
    artist: string,
    album?: string,
    duration?: number
): Promise<LyricsResponse> {
    if (!title || !artist) {
        return { lyrics: null, synced: false, format: 'lrc', source: 'none', error: 'Title and artist are required' };
    }

    console.log(`[Lyrics] Searching for: ${artist} - ${title}`);

    // Step 1: Try LRCLIB first (most reliable)
    let result = await fetchFromLrclib(title, artist, album, duration);
    if (result && result.lyrics) {
        console.log(`[Lyrics] Found from LRCLIB (${result.timing} timing, synced: ${result.synced})`);
        return result;
    }

    // Step 2: Try Musixmatch sources via LyricsPlus
    result = await fetchFromLyricsPlus(title, artist, album, duration, MUSIXMATCH_SOURCE);
    if (result && result.lyrics) {
        console.log(`[Lyrics] Found from Musixmatch (${result.timing} timing)`);
        return result;
    }

    // Step 3: Try other LyricsPlus sources (Spotify, Apple, etc.)
    result = await fetchFromLyricsPlus(title, artist, album, duration, FALLBACK_SOURCE);
    if (result && result.lyrics) {
        console.log(`[Lyrics] Found from ${result.source} (${result.timing} timing)`);
        return result;
    }

    console.log(`[Lyrics] No lyrics found for: ${artist} - ${title}`);
    return { lyrics: null, synced: false, format: 'lrc', source: 'none', error: 'No lyrics found' };
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

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        let request: LyricsRequest;

        if (event.httpMethod === 'POST') {
            request = JSON.parse(event.body || '{}');
        } else {
            // GET request
            const params = event.queryStringParameters || {};
            request = {
                title: params.title || '',
                artist: params.artist || '',
                album: params.album,
                duration: params.duration ? parseFloat(params.duration) : undefined
            };
        }

        if (!request.title || !request.artist) {
            return {
                statusCode: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Title and artist are required' })
            };
        }

        // Clean search terms
        const cleanTitle = cleanForSearch(request.title);
        const cleanArtist = cleanForSearch(request.artist);
        const cleanAlbum = request.album ? cleanForSearch(request.album) : undefined;

        // Check cache
        const cacheKey = getCacheKey(cleanTitle, cleanArtist, cleanAlbum);
        if (lyricsCache.has(cacheKey)) {
            console.log(`[Lyrics] Cache hit for: ${cleanArtist} - ${cleanTitle}`);
            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify(lyricsCache.get(cacheKey))
            };
        }

        // Fetch lyrics
        const result = await fetchLyricsWithFallback(
            cleanTitle,
            cleanArtist,
            cleanAlbum,
            request.duration
        );

        // Cache the result
        lyricsCache.set(cacheKey, result);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
        };

    } catch (error: any) {
        console.error('[Lyrics] Error:', error);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
}

// Health check endpoint
export async function healthHandler(): Promise<APIGatewayProxyResult> {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            status: 'ok',
            service: 'Lyrics Service (AWS Lambda)',
            version: '2.0.0',
            sources: ['LRCLIB', 'LyricsPlus'],
            cacheSize: lyricsCache.size
        })
    };
}
