import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';
import { config } from './config.js';

const QOBUZ_API_BASE = 'https://www.qobuz.com/api.json/0.2';
const LAMBDA_PROXY_URL = process.env.LAMBDA_PROXY_URL || '';
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 300;
const REQUEST_TIMEOUT = 15_000;

const apiClient = axios.create({ timeout: REQUEST_TIMEOUT });

const MAX_CONCURRENT = 1000;
let activeRequests = 0;
const waitQueue: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
    if (activeRequests < MAX_CONCURRENT) { activeRequests++; return; }
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
        const response = await apiClient.get(LAMBDA_PROXY_URL, {
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
    const available = config.qobuz.authTokens.filter(t => !failedTokens.has(t));
    if (available.length === 0) {
        failedTokens.clear();
        if (config.qobuz.authTokens.length === 0) throw new Error('No auth tokens available');
        return config.qobuz.authTokens[Math.floor(Math.random() * config.qobuz.authTokens.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
}

function markTokenAsFailed(token: string): void { failedTokens.add(token); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function isRetryableError(error: AxiosError): boolean {
    if ((error as any).isPermanent) return false;
    if (!(error as any).isAxiosError) return false;
    if (!error.response) return true;
    const s = error.response.status;
    return s === 403 || s === 429 || s >= 500;
}

function shouldRotateToken(error: AxiosError): boolean {
    if (!(error as any).isAxiosError) return false;
    return error.response?.status === 401 || error.response?.status === 403 || error.response?.status === 429;
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
            console.error(`[${context}] Attempt ${attempt}/${MAX_RETRIES}:`, {
                status: axiosError.response?.status,
                message: axiosError.message,
            });
            if (shouldRotateToken(axiosError)) {
                markTokenAsFailed(token);
                if (failedTokens.size < config.qobuz.authTokens.length) { attempt--; continue; }
            }
            if (!isRetryableError(axiosError)) throw new Error(`${context} failed (permanent): ${axiosError.message}`);
            if (attempt === MAX_RETRIES) throw new Error(`${context} failed after ${attempt} attempts`);
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1) + Math.random() * 1000;
            await sleep(delay);
        }
    }
    throw lastError || new Error(`${context} failed after ${MAX_RETRIES} attempts`);
}

export async function getAlbumInfo(albumId: string, country?: string, meta?: { albumTitle?: string; artistName?: string }): Promise<any> {
    const isUPC = /^\d{10,}$/.test(albumId);
    if (isUPC) {
        try {
            const resolved = await resolveUPCToAlbumId(albumId, country);
            if (resolved) albumId = resolved;
        } catch {}
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
            const searchData = await qobuzGet('/catalog/search',
                { query: `${meta.artistName} ${meta.albumTitle}`, type: 'albums', limit: 10, app_id: config.qobuz.appId },
                { 'X-User-Auth-Token': getRandomToken(), ...(country && { 'X-App-Country': country }) },
            );
            const albums = searchData?.albums?.items;
            if (Array.isArray(albums) && albums.length > 0) {
                const titleLower = meta.albumTitle.toLowerCase();
                const artistLower = meta.artistName.toLowerCase();
                const match = albums.find((a: any) =>
                    a.title?.toLowerCase() === titleLower && a.artist?.name?.toLowerCase() === artistLower
                ) || albums[0];
                return await retryableRequest(async (token) => {
                    const data = await qobuzGet('/album/get',
                        { album_id: String(match.id), app_id: config.qobuz.appId },
                        { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
                    );
                    if (!data || !data.id) throw new Error(`Invalid album data for ${match.id}`);
                    return data;
                }, `getAlbumInfo(${match.id})`);
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
            const exact = albums.find((a: any) => String(a.upc) === upc);
            return String(exact ? exact.id : albums[0].id);
        }
    } catch {}
    return null;
}

export async function getTrackInfo(trackId: string, country?: string): Promise<any> {
    return retryableRequest(async (token) => {
        const data = await qobuzGet('/track/get',
            { track_id: trackId, app_id: config.qobuz.appId },
            { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) },
        );
        if (!data || !data.id) throw new Error(`Invalid track data for ${trackId}`);
        return data;
    }, `getTrackInfo(${trackId})`);
}

export async function getTrackFileUrl(trackId: string, quality: number, country?: string): Promise<{ url: string; mimeType: string }> {
    return retryableRequest(async (token) => {
        const timestamp = Math.floor(Date.now() / 1000);
        const sig = generateSignature(trackId, quality, timestamp, config.qobuz.secret);
        const data = await qobuzGet('/track/getFileUrl', {
            track_id: trackId,
            format_id: quality,
            intent: 'stream',
            request_ts: timestamp,
            request_sig: sig,
            app_id: config.qobuz.appId,
        }, { 'X-User-Auth-Token': token, ...(country && { 'X-App-Country': country }) });

        if (!data?.url) {
            const err: any = new Error(`No download URL for track ${trackId}`);
            err.isPermanent = true;
            throw err;
        }
        return { url: data.url, mimeType: data.mime_type || 'audio/flac' };
    }, `getTrackFileUrl(${trackId})`);
}

function generateSignature(trackId: string, quality: number, timestamp: number, secret: string): string {
    const data = `trackgetFileUrlformat_id${quality}intentstreamtrack_id${trackId}${timestamp}${secret}`;
    return crypto.createHash('md5').update(data).digest('hex');
}

export function initSocksAgent(): void {}
