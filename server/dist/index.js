"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const admin = __importStar(require("firebase-admin"));
const uuid_1 = require("uuid");
const download_1 = require("./download");
const qobuz_api_1 = require("./qobuz-api");
// Initialize Firebase Admin SDK with explicit config
const projectId = process.env.FIREBASE_PROJECT_ID || 'qobuz-dl-web';
admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: projectId,
    storageBucket: `${projectId}.firebasestorage.app`
});
const db = admin.firestore();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Middleware to verify Firebase Auth token
async function verifyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    }
    catch (error) {
        return res.status(401).json({ success: false, error: 'Invalid authentication token' });
    }
}
// Middleware to check blocked IPs
async function checkBlockedIP(req, res, next) {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
    const blockedIPDoc = await db.collection('blockedIPs').doc(clientIp.replace(/\./g, '_')).get();
    if (blockedIPDoc.exists) {
        console.warn('Banned IP', { ip: clientIp });
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    req.clientIp = clientIp;
    next();
}
// ==================== API ENDPOINTS ====================
// Create a download job
app.post('/api/createJob', checkBlockedIP, verifyAuth, async (req, res) => {
    try {
        const user = req.user;
        const clientIp = req.clientIp;
        const { albumId, settings, country, metadata, type, trackId } = req.body;
        if (!albumId || !settings) {
            return res.status(400).json({ success: false, error: 'Missing albumId or settings' });
        }
        // Check rate limiting
        const rateLimitDoc = await db.collection('rateLimitedIPs').doc(clientIp.replace(/\./g, '_')).get();
        if (rateLimitDoc.exists) {
            const rateLimitData = rateLimitDoc.data();
            const maxDownloadsPerHour = rateLimitData?.maxDownloadsPerHour || 0;
            if (maxDownloadsPerHour > 0) {
                const now = new Date();
                const startOfHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
                const startOfHourISO = startOfHour.toISOString();
                const recentJobsSnapshot = await db.collection('downloadLogs')
                    .where('ip', '==', clientIp)
                    .where('createdAt', '>=', startOfHourISO)
                    .get();
                if (recentJobsSnapshot.size >= maxDownloadsPerHour) {
                    const minutesUntilReset = 60 - now.getMinutes();
                    return res.status(429).json({
                        success: false,
                        error: `Limite atteinte (${maxDownloadsPerHour}/heure). Réessayez dans ${minutesUntilReset} minute${minutesUntilReset > 1 ? 's' : ''}.`,
                        retryAfter: minutesUntilReset * 60
                    });
                }
            }
        }
        const job = {
            id: (0, uuid_1.v4)(),
            type: type || 'album',
            status: 'pending',
            progress: 0,
            description: 'Job created...',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            settings,
            albumId,
            trackId: trackId ?? null,
            albumTitle: metadata?.title,
            artistName: metadata?.artistName,
            trackCount: metadata?.trackCount,
            userId: user.uid,
            userEmail: user.email || null
        };
        // Save job to Firestore
        await db.collection('jobs').doc(job.id).set({
            ...job,
            albumInfo: metadata?.albumInfo ? JSON.stringify(metadata.albumInfo) : null,
            country: country || null
        });
        // Log download for rate limiting
        await db.collection('downloadLogs').add({
            ip: clientIp,
            jobId: job.id,
            userId: user.uid,
            userEmail: user.email,
            createdAt: new Date().toISOString()
        });
        console.log('Job created', { jobId: job.id, type: job.type, albumId, user: user.email || user.uid });
        // If not in worker mode, process inline (for single-instance setup)
        // If workers are running, they will pick up the job via polling
        const isWorkerMode = process.env.WORKER_MODE === 'true';
        if (!isWorkerMode) {
            // Process job asynchronously (don't await)
            processJobAsync(job.id);
        }
        res.status(201).json({ success: true, job });
    }
    catch (error) {
        console.error('Create job error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal error'
        });
    }
});
// Async job processor
async function processJobAsync(jobId) {
    try {
        const doc = await db.collection('jobs').doc(jobId).get();
        if (!doc.exists)
            return;
        const jobData = doc.data();
        if (jobData.status !== 'pending')
            return;
        // Mark as processing
        await db.collection('jobs').doc(jobId).update({
            status: 'processing',
            description: 'Démarrage...',
            updatedAt: new Date().toISOString()
        });
        let albumInfo = jobData.albumInfo ? JSON.parse(jobData.albumInfo) : null;
        const settings = jobData.settings;
        const country = jobData.country;
        if (!albumInfo) {
            console.log(`[${jobId}] Fetching album info...`);
            albumInfo = await (0, qobuz_api_1.getAlbumInfoFromQobuz)(jobData.albumId, country);
            await db.collection('jobs').doc(jobId).update({
                albumTitle: albumInfo.title,
                artistName: albumInfo.artist?.name,
                trackCount: albumInfo.tracks?.items?.length || 0,
                updatedAt: new Date().toISOString()
            });
        }
        console.log(`[${jobId}] Processing download...`);
        await (0, download_1.processAlbumDownload)(jobId, albumInfo, settings, country, jobData.trackId);
        console.log(`[${jobId}] Completed successfully`);
    }
    catch (error) {
        console.error(`[${jobId}] Failed:`, error);
        await db.collection('jobs').doc(jobId).update({
            status: 'failed',
            description: 'Échec du téléchargement',
            error: error instanceof Error ? error.message : 'Unknown error',
            updatedAt: new Date().toISOString()
        });
    }
}
// Get job status
app.get('/api/getJob/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const doc = await db.collection('jobs').doc(jobId).get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }
        res.json({ success: true, job: doc.data() });
    }
    catch (error) {
        console.error('Get job error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal error'
        });
    }
});
// Get album info from Qobuz
app.get('/api/getAlbumInfo/:albumId', async (req, res) => {
    try {
        const { albumId } = req.params;
        const country = req.headers['token-country'];
        const albumInfo = await (0, qobuz_api_1.getAlbumInfoFromQobuz)(albumId, country);
        res.json({ success: true, data: albumInfo });
    }
    catch (error) {
        console.error('Get album info error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal error'
        });
    }
});
// List jobs
app.get('/api/listJobs', async (req, res) => {
    try {
        const snapshot = await db.collection('jobs')
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        const jobs = snapshot.docs.map(doc => doc.data());
        res.json({ success: true, jobs });
    }
    catch (error) {
        console.error('List jobs error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal error'
        });
    }
});
// Cancel job
app.post('/api/cancelJob/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const docRef = db.collection('jobs').doc(jobId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }
        const job = doc.data();
        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
            return res.status(400).json({ success: false, error: 'Cannot cancel finished job' });
        }
        await docRef.update({
            status: 'cancelled',
            description: 'Cancelled by user',
            updatedAt: new Date().toISOString()
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Cancel job error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal error'
        });
    }
});
// Get stats
app.get('/api/getStats', async (req, res) => {
    try {
        const startTime = Date.now();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayISO = today.toISOString();
        // Count users
        let totalUsers = 0;
        let nextPageToken;
        do {
            const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
            totalUsers += listUsersResult.users.length;
            nextPageToken = listUsersResult.pageToken;
        } while (nextPageToken);
        const [activeJobsSnapshot, todayLogsSnapshot, allTimeLogsSnapshot] = await Promise.all([
            db.collection('jobs').where('status', 'in', ['pending', 'downloading', 'processing']).get(),
            db.collection('downloadLogs').where('createdAt', '>=', todayISO).get(),
            db.collection('downloadLogs').get()
        ]);
        const pingMs = Date.now() - startTime;
        const activeJobs = activeJobsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                status: data.status,
                progress: data.progress || 0,
                albumTitle: data.albumTitle || 'Unknown',
                artistName: data.artistName || 'Unknown',
                type: data.type || 'album'
            };
        });
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            ping: pingMs,
            downloads: {
                active: activeJobsSnapshot.size,
                today: todayLogsSnapshot.size,
                allTime: allTimeLogsSnapshot.size,
                activeJobs
            },
            users: { total: totalUsers },
            server: { status: 'online', type: 'self-hosted' }
        });
    }
    catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal error'
        });
    }
});
// Start server
app.listen(PORT, () => {
    console.log(`🚀 Qobuz-DL API Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
// Cleanup old jobs every 5 minutes
setInterval(async () => {
    try {
        const cutoffTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const snapshot = await db.collection('jobs')
            .where('status', 'in', ['completed', 'failed', 'cancelled'])
            .get();
        let deleted = 0;
        const batch = db.batch();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const jobTime = data.completedAt || data.updatedAt;
            if (jobTime && jobTime < cutoffTime) {
                batch.delete(doc.ref);
                deleted++;
            }
        }
        if (deleted > 0) {
            await batch.commit();
            console.log(`Cleanup: Deleted ${deleted} old jobs`);
        }
    }
    catch (error) {
        console.error('Cleanup error:', error);
    }
}, 5 * 60 * 1000);
// ==================== WORKER MODE ====================
// Workers poll for pending jobs and process them
// Workers auto-generate unique IDs so you can add workers from any machine
const isWorkerMode = process.env.WORKER_MODE === 'true';
const hostname = require('os').hostname();
const workerId = process.env.WORKER_ID || `${hostname}-${Math.random().toString(36).substring(2, 8)}`;
if (isWorkerMode) {
    console.log(`🔧 Worker ${workerId} started - polling for jobs...`);
    console.log(`   Add more workers by running this on any machine!`);
    // Track if this worker is currently processing a job
    let isBusy = false;
    // Poll for pending jobs every 2 seconds
    setInterval(async () => {
        // Skip if already processing a job
        if (isBusy)
            return;
        try {
            // Find a pending job
            const snapshot = await db.collection('jobs')
                .where('status', '==', 'pending')
                .orderBy('createdAt', 'asc')
                .limit(1)
                .get();
            if (snapshot.empty)
                return;
            const doc = snapshot.docs[0];
            const jobId = doc.id;
            // Try to claim this job atomically
            // Use a transaction to prevent race conditions
            const claimed = await db.runTransaction(async (transaction) => {
                const jobDoc = await transaction.get(doc.ref);
                if (!jobDoc.exists)
                    return false;
                const data = jobDoc.data();
                if (data.status !== 'pending')
                    return false; // Already claimed by another worker
                // Claim it!
                transaction.update(doc.ref, {
                    status: 'processing',
                    description: `Worker ${workerId} processing...`,
                    workerId: workerId,
                    updatedAt: new Date().toISOString()
                });
                return true;
            });
            if (!claimed) {
                // Another worker got it first, no problem
                return;
            }
            // Mark as busy BEFORE processing
            isBusy = true;
            console.log(`[Worker ${workerId}] 🎵 Processing job ${jobId}`);
            try {
                // Process the job
                const jobData = doc.data();
                let albumInfo = jobData.albumInfo ? JSON.parse(jobData.albumInfo) : null;
                const settings = jobData.settings;
                const country = jobData.country;
                if (!albumInfo) {
                    console.log(`[Worker ${workerId}][${jobId}] Fetching album info...`);
                    albumInfo = await (0, qobuz_api_1.getAlbumInfoFromQobuz)(jobData.albumId, country);
                    await db.collection('jobs').doc(jobId).update({
                        albumTitle: albumInfo.title,
                        artistName: albumInfo.artist?.name,
                        trackCount: albumInfo.tracks?.items?.length || 0,
                        updatedAt: new Date().toISOString()
                    });
                }
                console.log(`[Worker ${workerId}][${jobId}] Processing download...`);
                await (0, download_1.processAlbumDownload)(jobId, albumInfo, settings, country, jobData.trackId);
                console.log(`[Worker ${workerId}][${jobId}] ✅ Completed!`);
            }
            finally {
                // Always mark as not busy when done
                isBusy = false;
            }
        }
        catch (error) {
            isBusy = false; // Reset on error
            console.error(`[Worker ${workerId}] ❌ Error:`, error);
        }
    }, 2000); // Poll every 2 seconds
}
//# sourceMappingURL=index.js.map