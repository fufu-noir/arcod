import axios from 'axios';
import { QobuzTrack } from './qobuz-dl';

/**
 * Lyrics result with source info
 */
export interface LyricsResult {
    lyrics: string;
    synced: boolean;
    source: string;
    timing?: string; // 'Line' or 'Word' for Apple Music TTML
}

// Apple Music TTML Lyrics Service URL (deployed on AWS Lambda via API Gateway)
const LYRICS_SERVICE_URL = process.env.NEXT_PUBLIC_LYRICS_SERVICE_URL || process.env.NEXT_PUBLIC_AWS_API_URL || '';


// Cache for lyrics to avoid re-fetching
const lyricsCache = new Map<string, string | null>();

/**
 * Clean track/artist names for better API matching
 */
function cleanForSearch(text: string): string {
    return text
        .replace(/\s*\(feat\..*?\)/gi, '') // Remove (feat. ...)
        .replace(/\s*\[.*?\]/g, '')         // Remove [...]
        .replace(/\s*-\s*Remaster(ed)?.*$/gi, '') // Remove remaster info
        .replace(/\s*-\s*\d{4}\s*(Remaster)?.*$/gi, '') // Remove year/remaster
        .replace(/\s*\(Deluxe.*?\)/gi, '') // Remove (Deluxe Edition)
        .replace(/\s*\(Bonus.*?\)/gi, '') // Remove bonus track info
        .trim();
}

/**
 * Fetches lyrics from Apple Music TTML via microservice
 * Returns synced lyrics in LRC format (converted from TTML)
 */
async function fetchFromAppleMusic(
    trackTitle: string,
    artistName: string,
    albumTitle: string,
    duration: number
): Promise<LyricsResult | null> {
    try {
        console.log(`[Apple Music] Fetching TTML lyrics for: ${artistName} - ${trackTitle}`);

        const response = await axios.post(
            `${LYRICS_SERVICE_URL}/lyrics`,
            {
                title: cleanForSearch(trackTitle),
                artist: cleanForSearch(artistName),
                album: cleanForSearch(albumTitle),
                duration: Math.round(duration)
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            }
        );

        const data = response.data;

        if (data.lyrics && !data.error) {
            console.log(`[Apple Music] Found ${data.timing || 'synced'} lyrics for: ${trackTitle}`);
            return {
                lyrics: data.lyrics,
                synced: data.synced || false,
                source: data.source || 'applemusic-ttml',
                timing: data.timing
            };
        }

        if (data.error) {
            console.log(`[Apple Music] ${data.error} for: ${trackTitle}`);
        }

    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                console.log(`[Apple Music] Lyrics service unavailable`);
            } else {
                console.log(`[Apple Music] Error: ${error.message}`);
            }
        } else {
            console.log(`[Apple Music] Error: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
    }
    return null;
}

/**
 * Main function to fetch lyrics from Apple Music TTML
 * Uses only Apple Music as the source for high-quality synced lyrics
 */
export async function fetchLyrics(
    track: QobuzTrack
): Promise<string | null> {
    const trackTitle = track.title;
    const artistName = track.performer?.name || track.album?.artist?.name || 'Unknown Artist';
    const albumTitle = track.album?.title || 'Unknown Album';
    const duration = track.duration;

    const cacheKey = `${trackTitle}-${artistName}-${albumTitle}-${duration}`;

    // Check cache first
    if (lyricsCache.has(cacheKey)) {
        const cached = lyricsCache.get(cacheKey);
        if (cached) console.log(`[Lyrics] Cache hit for: ${trackTitle}`);
        return cached || null;
    }

    console.log(`[Lyrics] Fetching Apple Music TTML for: ${artistName} - ${trackTitle}`);

    // Fetch from Apple Music TTML service only
    const result = await fetchFromAppleMusic(trackTitle, artistName, albumTitle, duration);

    if (result) {
        console.log(`[Lyrics] Found ${result.synced ? 'synced' : 'plain'} lyrics from ${result.source} (${result.timing || 'unknown'} timing) for: ${trackTitle}`);
        lyricsCache.set(cacheKey, result.lyrics);
        return result.lyrics;
    }

    console.log(`[Lyrics] No lyrics found for: ${trackTitle}`);
    lyricsCache.set(cacheKey, null);
    return null;
}
