/**
 * qobuz api client — routes requests through a proxy to avoid ip bans
 */
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';
import { config } from '../config.js';

const QOBUZ_API_BASE = 'https://www.qobuz.com/api.json/0.2';
const LAMBDA_PROXY_URL = process.env.LAMBDA_PROXY_URL || '';
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 300;
const REQUEST_TIMEOUT = 15000;

const proxyClient = axios.create({ timeout: REQUEST_TIMEOUT });

const MAX_CONCURRENT = 1000;
let activeRequests = 0;
const waitQueue: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
    if (activeRequests < MAX_CONCURRENT) {
        activeRequests++;
        return;
    }
    await new Promise<void>(resolve => waitQueue.push(resolve));
    activeRequests++;
}

function releaseSlot(): void {
    activeRequests--;
    const next = waitQueue.shift();
    if (next) next();
}

async function qobuzGet(path: string, params: Record<string, any>, headers: Record<string, string>): Promise<any> {
    await acquireSlot();
    try {
        const response = await proxyClient.get(LAMBDA_PROXY_URL, {
            params: { path, ...params },
            headers,
            timeout: REQUEST_TIMEOUT,
        });
        return response.data;
    } finally {
        releaseSlot();
    }
}

const failedTokens = new Set<string>();

function getRandomToken(): string {
    const availableTokens = config.qobuz.authTokens.filter(t => !failedTokens.has(t));
    if (availableTokens.length === 0) {
        failedTokens.clear();
        if (config.qobuz.authTokens.length === 0) throw new Error('No auth tokens available');
        return config.qobuz.authTokens[Math.floor(Math.random() * config.qobuz.authTokens.length)];
    }
    return availableTokens[Math.floor(Math.random() * availableTokens.length)];
}

function markTokenAsFailed(token: string): void {
    failedTokens.add(token);
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: AxiosError): boolean {
    if ((error as any).isPermanent) return false;
    if (!(error as any).isAxiosError) return false;
    if (!error.response) return true;
    const s = error.response.status;
    return s === 403 || s === 429 || s >= 500;
}

function shouldRotateToken(error: AxiosError): boolean {
    if (!(error as any).isAxiosError) return false;
    return (
        error.response?.status === 401 ||
        error.response?.status === 403 ||
        error.response?.status === 429
    );
}

async function retryableRequest<T>(requestFn: (token: string) => Promise<T>, context: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const token = getRandomToken();
        try {
            return await requestFn(token);
        } catch (error) {
            lastError = error as Error;

            if ((error as any).isPermanent) throw error;

            const axiosError = error as AxiosError;

            console.error(`[${context}] Attempt ${attempt}/${MAX_RETRIES} failed:`, {
                status: axiosError.response?.status,
                message: axiosError.message,
            });

            if (shouldRotateToken(axiosError)) {
                markTokenAsFailed(token);
                if (failedTokens.size < config.qobuz.authTokens.length) {
                    attempt--;
                    continue;
                }
            }

            if (!isRetryableError(axiosError)) {
                throw new Error(`${context} failed (permanent): ${axiosError.message}`);
            }
            if (attempt === MAX_RETRIES) {
                throw new Error(`${context} failed after ${attempt} attempts: ${axiosError.response?.status || 'network error'}`);
            }

            const delay = (INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1)) + (Math.random() * 1000);
            await sleep(delay);
        }
    }

    throw lastError || new Error(`${context} failed after ${MAX_RETRIES} attempts`);
}

export async function getAlbumInfoFromQobuz(albumId: string, country?: string, meta?: { albumTitle?: string; artistName?: string }): Promise<any> {
    const originalId = albumId;

    const isUPC = /^\d{10,}$/.test(albumId);
    if (isUPC) {
        console.log(`[Qobuz] Album ID "${albumId}" looks like a UPC/barcode, resolving...`);
        try {
            const resolved = await resolveUPCToAlbumId(albumId, country);
            if (resolved) {
                console.log(`[Qobuz] Resolved UPC ${albumId} → Qobuz ID ${resolved}`);
                albumId = resolved;
            }
        } catch (err: any) {
            console.warn(`[Qobuz] UPC resolution failed for ${albumId}: ${err.message}`);
        }
    }

    try {
        return await retryableRequest(async (token) => {
            const data = await qobuzGet('/album/get',
                { album_id: albumId, app_id: config.qobuz.appId },
                { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
            );
            if (!data || !data.id) throw new Error(`Invalid album data for ${albumId}`);
            return data;
        }, `getAlbumInfo(${albumId})`);
    } catch (err: any) {
        if (err.message?.includes('404') && meta?.albumTitle && meta?.artistName) {
            console.log(`[Qobuz] album/get 404 for ${originalId}, searching by title: "${meta.artistName} - ${meta.albumTitle}"`);
            try {
                const searchData = await qobuzGet('/catalog/search',
                    { query: `${meta.artistName} ${meta.albumTitle}`, type: 'albums', limit: 10, app_id: config.qobuz.appId },
                    { 'X-User-Auth-Token': getRandomToken(), ...(country && { 'X-App-Country': country }) },
                );

                const albums = searchData?.albums?.items;
                if (Array.isArray(albums) && albums.length > 0) {
                    const titleLower = meta.albumTitle.toLowerCase();
                    const artistLower = meta.artistName.toLowerCase();
                    const match = albums.find((a: any) =>
                        a.title?.toLowerCase() === titleLower &&
                        a.artist?.name?.toLowerCase() === artistLower
                    ) || albums[0];

                    const resolvedId = String(match.id);
                    console.log(`[Qobuz] Search fallback resolved "${meta.albumTitle}" → ${resolvedId}`);

                    return await retryableRequest(async (token) => {
                        const data = await qobuzGet('/album/get',
                            { album_id: resolvedId, app_id: config.qobuz.appId },
                            { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
                        );
                        if (!data || !data.id) throw new Error(`Invalid album data for ${resolvedId}`);
                        return data;
                    }, `getAlbumInfo(${resolvedId})`);
                }
            } catch (searchErr: any) {
                console.warn(`[Qobuz] Search fallback failed: ${searchErr.message}`);
            }
        }
        throw err;
    }
}

async function resolveUPCToAlbumId(upc: string, country?: string): Promise<string | null> {
    try {
        const data = await qobuzGet('/catalog/search',
            { query: upc, type: 'albums', limit: 5, app_id: config.qobuz.appId },
            { 'X-User-Auth-Token': getRandomToken(), ...(country && { 'X-App-Country': country }) },
        );

        const albums = data?.albums?.items;
        if (Array.isArray(albums) && albums.length > 0) {
            const exactMatch = albums.find((a: any) => String(a.upc) === upc);
            if (exactMatch) return String(exactMatch.id);
            return String(albums[0].id);
        }
    } catch (err: any) {
        console.warn(`[Qobuz] UPC catalog search failed: ${err.message}`);
    }
    return null;
}

export async function getTrackInfoFromQobuz(trackId: string, country?: string): Promise<any> {
    return retryableRequest(async (token) => {
        const data = await qobuzGet('/track/get',
            { track_id: trackId, app_id: config.qobuz.appId },
            { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
        );
        if (!data || !data.id) throw new Error(`Invalid track data for ${trackId}`);
        return data;
    }, `getTrackInfo(${trackId})`);
}

export async function getTrackFileUrl(trackId: string, quality: number, country?: string): Promise<{ url: string; mimeType: string; restrictions?: string[] }> {
    return retryableRequest(async (token) => {
        const timestamp = Math.floor(Date.now() / 1000);
        const requestSig = generateSignature(trackId, quality, timestamp, config.qobuz.secret);

        const data = await qobuzGet('/track/getFileUrl',
            {
                track_id: trackId,
                format_id: quality,
                intent: 'stream',
                request_ts: timestamp,
                request_sig: requestSig,
                app_id: config.qobuz.appId,
            },
            { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
        );

        if (!data?.url) {
            const err: any = new Error(`No download URL for track ${trackId}`);
            err.isPermanent = true;
            throw err;
        }

        const restrictions: string[] = [];
        if (Array.isArray(data.restrictions)) {
            for (const r of data.restrictions) {
                if (r.code) restrictions.push(r.code);
            }
        }

        return { url: data.url, mimeType: data.mime_type || 'audio/flac', restrictions };
    }, `getTrackFileUrl(${trackId})`);
}

function generateSignature(trackId: string, quality: number, timestamp: number, secret: string): string {
    const data = `trackgetFileUrlformat_id${quality}intentstreamtrack_id${trackId}${timestamp}${secret}`;
    return crypto.createHash('md5').update(data).digest('hex');
}

export async function searchQobuz(query: string, limit: number = 12, offset: number = 0, country?: string): Promise<any> {
    return retryableRequest(async (token) => {
        return await qobuzGet('/catalog/search',
            { query, limit, offset, app_id: config.qobuz.appId },
            { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
        );
    }, `searchQobuz(${query})`);
}

export async function getArtistFromQobuz(artistId: string, country?: string): Promise<any> {
    return retryableRequest(async (token) => {
        return await qobuzGet('/artist/page',
            { artist_id: artistId, sort: 'release_date', app_id: config.qobuz.appId },
            { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
        );
    }, `getArtist(${artistId})`);
}

export async function getArtistReleasesFromQobuz(
    artistId: string, releaseType: string = 'album',
    limit: number = 10, offset: number = 0,
    country?: string
): Promise<any> {
    return retryableRequest(async (token) => {
        return await qobuzGet('/artist/getReleasesList',
            { artist_id: artistId, release_type: releaseType, limit, offset, app_id: config.qobuz.appId },
            { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
        );
    }, `getArtistReleases(${artistId})`);
}

export async function getPlaylistFromQobuz(playlistId: string, limit: number = 500, offset: number = 0, country?: string): Promise<any> {
    return retryableRequest(async (token) => {
        const data = await qobuzGet('/playlist/get',
            { playlist_id: playlistId, extra: 'tracks,subscribers,focusAll', limit, offset, app_id: config.qobuz.appId },
            { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
        );
        if (!data || !data.id) throw new Error(`Invalid playlist data for ${playlistId}`);
        return data;
    }, `getPlaylist(${playlistId})`);
}
