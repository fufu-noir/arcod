/**
 * Tidal API client for AWS Lambda
 * Uses the unofficial Tidal API (api.tidal.com/v1) for album info and track streaming
 */
import axios, { AxiosError } from 'axios';

const TIDAL_API_BASE = 'https://api.tidal.com/v1';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const REQUEST_TIMEOUT = 15000;

function getTidalConfig() {
    return {
        authToken: process.env.TIDAL_AUTH_TOKEN || '',
        countryCode: process.env.TIDAL_COUNTRY_CODE || 'US',
    };
}

function getTidalHeaders() {
    const config = getTidalConfig();
    return {
        'X-Tidal-Token': config.authToken,
        'Content-Type': 'application/json',
    };
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryableRequest<T>(
    requestFn: () => Promise<T>,
    context: string
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await requestFn();
        } catch (error) {
            lastError = error as Error;
            const axiosError = error as AxiosError;

            console.error(`[Tidal ${context}] Attempt ${attempt}/${MAX_RETRIES} failed:`, {
                status: axiosError.response?.status,
                message: axiosError.message,
            });

            if (attempt === MAX_RETRIES || (axiosError.response?.status && axiosError.response.status < 500 && axiosError.response.status !== 429)) {
                throw new Error(`${context} failed after ${attempt} attempts: ${axiosError.response?.status || 'network error'} - ${axiosError.message}`);
            }

            const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1) + Math.random() * 1000;
            console.log(`[Tidal ${context}] Retrying in ${Math.round(delay)}ms...`);
            await sleep(delay);
        }
    }

    throw lastError || new Error(`${context} failed after ${MAX_RETRIES} attempts`);
}

/**
 * Get album info from Tidal
 */
export async function getAlbumInfoFromTidal(albumId: string, country?: string): Promise<any> {
    const config = getTidalConfig();
    const countryCode = country || config.countryCode;

    return retryableRequest(async () => {
        // Fetch album details
        const albumResponse = await axios.get(`${TIDAL_API_BASE}/albums/${albumId}`, {
            params: { countryCode },
            headers: getTidalHeaders(),
            timeout: REQUEST_TIMEOUT,
        });

        // Fetch album tracks
        const tracksResponse = await axios.get(`${TIDAL_API_BASE}/albums/${albumId}/tracks`, {
            params: { countryCode, limit: 100, offset: 0 },
            headers: getTidalHeaders(),
            timeout: REQUEST_TIMEOUT,
        });

        const album = albumResponse.data;
        const tracks = tracksResponse.data;

        // Normalize to a format compatible with our existing AlbumInfo interface
        return {
            id: String(album.id),
            title: album.title,
            artist: { name: album.artist?.name || 'Unknown' },
            genre: { name: '' }, // Tidal doesn't provide genre in basic album info
            label: { name: '' },
            release_date_original: album.releaseDate || '',
            tracks_count: album.numberOfTracks || 0,
            media_count: album.numberOfVolumes || 1,
            upc: album.upc || '',
            copyright: album.copyright || '',
            image: {
                large: album.cover ? `https://resources.tidal.com/images/${album.cover.replace(/-/g, '/')}/1280x1280.jpg` : '',
                small: album.cover ? `https://resources.tidal.com/images/${album.cover.replace(/-/g, '/')}/320x320.jpg` : '',
            },
            tracks: {
                items: (tracks.items || []).map((track: any) => ({
                    id: track.id,
                    title: track.title,
                    track_number: track.trackNumber,
                    duration: track.duration,
                    streamable: track.streamReady !== false,
                    performer: { name: track.artist?.name || album.artist?.name || 'Unknown' },
                    version: track.version || undefined,
                    isrc: track.isrc || undefined,
                    copyright: track.copyright || album.copyright || '',
                    media_number: track.volumeNumber || 1,
                })),
            },
            _source: 'tidal',
        };
    }, `getAlbumInfo(${albumId})`);
}

/**
 * Get track stream URL from Tidal
 */
export async function getTrackFileUrlFromTidal(
    trackId: string,
    quality: number,
    country?: string
): Promise<{ url: string; mimeType: string }> {
    const config = getTidalConfig();
    const countryCode = country || config.countryCode;

    // Map Qobuz quality numbers to Tidal quality strings
    let tidalQuality = 'LOSSLESS';
    if (quality <= 5) tidalQuality = 'LOW';
    else if (quality <= 6) tidalQuality = 'HIGH';
    else if (quality <= 7) tidalQuality = 'LOSSLESS';
    else if (quality >= 27) tidalQuality = 'HI_RES_LOSSLESS';

    return retryableRequest(async () => {
        const response = await axios.get(`${TIDAL_API_BASE}/tracks/${trackId}/streamUrl`, {
            params: {
                soundQuality: tidalQuality,
                countryCode,
            },
            headers: getTidalHeaders(),
            timeout: REQUEST_TIMEOUT,
        });

        if (!response.data || !response.data.url) {
            throw new Error(`No stream URL received for track ${trackId}`);
        }

        return {
            url: response.data.url,
            mimeType: response.data.mimeType || 'audio/flac',
        };
    }, `getTrackFileUrl(${trackId})`);
}
