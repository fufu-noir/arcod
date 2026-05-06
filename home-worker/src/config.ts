import 'dotenv/config';

export const config = {
    server: {
        url: process.env.SERVER_URL || 'https://api.arcod.xyz',
        apiKey: process.env.WORKER_API_KEY || '',
    },
    workerId: process.env.WORKER_ID || `home-worker-${Date.now()}`,

    ssh: {
        user: process.env.SSH_USER || 'root',
        host: process.env.SSH_HOST || '',
        port: parseInt(process.env.SSH_PORT || '22'),
        password: process.env.SSH_PASSWORD || '',
        socksPort: parseInt(process.env.SOCKS_PORT || '41080'),
    },

    qobuz: {
        appId: process.env.QOBUZ_APP_ID || '',
        secret: process.env.QOBUZ_SECRET || '',
        authTokens: JSON.parse(process.env.QOBUZ_AUTH_TOKENS || '[]') as string[],
    },

    r2: {
        accountId: process.env.R2_ACCOUNT_ID || '',
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        bucket: process.env.R2_BUCKET || 'arcod-downloads',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        publicUrl: process.env.R2_PUBLIC_URL || 'https://dl.arcod.xyz',
    },

    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '3000'),
    claimCount: parseInt(process.env.CLAIM_COUNT || '4'),
    trackConcurrency: parseInt(process.env.TRACK_CONCURRENCY || '4'),
    heartbeatIntervalMs: 60_000,
};
