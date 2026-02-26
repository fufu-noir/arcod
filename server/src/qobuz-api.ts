import axios, { AxiosError } from 'axios';

const QOBUZ_API_BASE = 'https://www.qobuz.com/api.json/0.2';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Get secrets from environment or Firebase config
function getQobuzConfig() {
    return {
        appId: process.env.QOBUZ_APP_ID || '',
        secret: process.env.QOBUZ_SECRET || '',
        authTokens: JSON.parse(process.env.QOBUZ_AUTH_TOKENS || '[]') as string[]
    };
}

// Track failed tokens to avoid reusing them in the same session
const failedTokens = new Set<string>();

function getRandomToken(): string {
    const config = getQobuzConfig();
    const availableTokens = config.authTokens.filter(t => !failedTokens.has(t));

    if (availableTokens.length === 0) {
        // Reset failed tokens if all have failed (give them another chance)
        failedTokens.clear();
        if (config.authTokens.length === 0) {
            throw new Error('No auth tokens available');
        }
        return config.authTokens[Math.floor(Math.random() * config.authTokens.length)];
    }

    return availableTokens[Math.floor(Math.random() * availableTokens.length)];
}

function markTokenAsFailed(token: string): void {
    failedTokens.add(token);
    console.log(`Marked token as failed. ${failedTokens.size} tokens now marked as failed.`);
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: AxiosError): boolean {
    if (!error.response) {
        // Network error, timeout, etc.
        return true;
    }
    const status = error.response.status;
    // Retry on: 429 (rate limit), 500, 502, 503, 504 (server errors)
    return status === 429 || status >= 500;
}

async function retryableRequest<T>(
    requestFn: (token: string) => Promise<T>,
    context: string
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const token = getRandomToken();

        try {
            return await requestFn(token);
        } catch (error) {
            lastError = error as Error;
            const axiosError = error as AxiosError;

            // Log the error
            console.error(`[${context}] Attempt ${attempt}/${MAX_RETRIES} failed:`, {
                status: axiosError.response?.status,
                message: axiosError.message,
                data: axiosError.response?.data
            });

            // Handle auth errors - mark token as failed
            if (axiosError.response?.status === 401 || axiosError.response?.status === 403) {
                markTokenAsFailed(token);
                // Don't count auth failures against retry limit if we have more tokens
                const config = getQobuzConfig();
                if (failedTokens.size < config.authTokens.length) {
                    attempt--; // Retry with different token
                    continue;
                }
            }

            // Check if retryable
            if (!isRetryableError(axiosError) || attempt === MAX_RETRIES) {
                // Not retryable or last attempt
                throw new Error(`${context} failed after ${attempt} attempts: ${axiosError.response?.status || 'network error'} - ${axiosError.message}`);
            }

            // Wait before retry with exponential backoff
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
            console.log(`[${context}] Retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }

    throw lastError || new Error(`${context} failed after ${MAX_RETRIES} attempts`);
}

export async function getAlbumInfoFromQobuz(albumId: string, country?: string): Promise<any> {
    const config = getQobuzConfig();

    return retryableRequest(async (token) => {
        const response = await axios.get(`${QOBUZ_API_BASE}/album/get`, {
            params: {
                album_id: albumId,
                app_id: config.appId
            },
            headers: {
                'X-User-Auth-Token': token,
                ...(country && { 'X-App-Country': country })
            },
            timeout: REQUEST_TIMEOUT
        });

        if (!response.data || !response.data.id) {
            throw new Error(`Invalid album data received for album ${albumId}`);
        }

        return response.data;
    }, `getAlbumInfo(${albumId})`);
}

export async function getTrackFileUrl(
    trackId: string,
    quality: number,
    country?: string
): Promise<{ url: string; mimeType: string }> {
    const config = getQobuzConfig();

    return retryableRequest(async (token) => {
        const timestamp = Math.floor(Date.now() / 1000);
        const requestSig = generateSignature(trackId, quality, timestamp, config.secret);

        const response = await axios.get(`${QOBUZ_API_BASE}/track/getFileUrl`, {
            params: {
                track_id: trackId,
                format_id: quality,
                intent: 'stream',
                request_ts: timestamp,
                request_sig: requestSig,
                app_id: config.appId
            },
            headers: {
                'X-User-Auth-Token': token,
                ...(country && { 'X-App-Country': country })
            },
            timeout: REQUEST_TIMEOUT
        });

        if (!response.data || !response.data.url) {
            throw new Error(`No download URL received for track ${trackId}`);
        }

        return {
            url: response.data.url,
            mimeType: response.data.mime_type || 'audio/flac'
        };
    }, `getTrackFileUrl(${trackId})`);
}

function generateSignature(trackId: string, quality: number, timestamp: number, secret: string): string {
    const crypto = require('crypto');
    const data = `trackgetFileUrlformat_id${quality}intent${`stream`}track_id${trackId}${timestamp}${secret}`;
    return crypto.createHash('md5').update(data).digest('hex');
}
