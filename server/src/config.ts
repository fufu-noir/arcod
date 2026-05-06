import 'dotenv/config';

export const config = {
    port: parseInt(process.env.PORT || '3000'),
    nodeEnv: process.env.NODE_ENV || 'development',

    // R2
    r2: {
        accountId: process.env.R2_ACCOUNT_ID!,
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        bucket: process.env.R2_BUCKET || 'arcod-downloads',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        publicUrl: process.env.R2_PUBLIC_URL || 'https://dl.arcod.xyz',
    },

    // Supabase Auth
    supabase: {
        url: process.env.SUPABASE_URL || '',
        jwtSecret: process.env.SUPABASE_JWT_SECRET || '',
    },

    // Qobuz
    qobuz: {
        appId: process.env.QOBUZ_APP_ID || '',
        secret: process.env.QOBUZ_SECRET || '',
        authTokens: JSON.parse(process.env.QOBUZ_AUTH_TOKENS || '[]') as string[],
    },




    // Worker
    worker: {
        apiKey: process.env.WORKER_API_KEY || '',
        leaseTimeoutMs: 10 * 60 * 1000,
    },

    // DB
    dbPath: process.env.DB_PATH || './data/arcod.db',

    // Limits
    // Files are temporary (24h auth, 2h guest) — no storage limit needed
    guestHourlyLimit: 3,
    guestReleaseTrackLimit: 20,
    authUserHourlyLimit: 20,
    authUserDailyLimit: 100,
    authUserConcurrentLimit: 15,
    ipHourlyLimit: 30,
    autobanHourlyThreshold: 50,
    autobanDailyThreshold: 200,
    autobanRapidThreshold: 10,
    rapidWindowMs: 5 * 60 * 1000,
    tempBanDurationMs: 15 * 60 * 1000,
};
