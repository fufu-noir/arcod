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
exports.processAlbumDownload = processAlbumDownload;
const admin = __importStar(require("firebase-admin"));
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const qobuz_api_1 = require("./qobuz-api");
const archiver = require('archiver');
// Retry configuration
const MAX_DOWNLOAD_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000;
function getDb() {
    return admin.firestore();
}
function getStorage() {
    return admin.storage();
}
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function updateJobStatus(jobId, updates) {
    await getDb().collection('jobs').doc(jobId).update({
        ...updates,
        updatedAt: new Date().toISOString()
    });
}
async function isJobCancelled(jobId) {
    const doc = await getDb().collection('jobs').doc(jobId).get();
    return doc.exists && doc.data()?.status === 'cancelled';
}
function sanitizeFileName(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}
function formatTrackFileName(trackNumber, title, artist, format) {
    const num = trackNumber.toString().padStart(2, '0');
    return `${num} - ${sanitizeFileName(artist)} - ${sanitizeFileName(title)}.${format}`;
}
async function processAlbumDownload(jobId, albumInfo, settings, country, trackId) {
    const tempDir = path.join(os.tmpdir(), `qobuz-${jobId}`);
    let tracks = albumInfo.tracks.items.filter((t) => t.streamable !== false);
    if (trackId !== undefined && trackId !== null) {
        console.log(`Filtering tracks by trackId: ${trackId}`);
        const trackIdStr = String(trackId);
        tracks = tracks.filter((t) => String(t.id) === trackIdStr);
        console.log(`Found ${tracks.length} matching track(s)`);
    }
    try {
        fs.mkdirSync(tempDir, { recursive: true });
        await updateJobStatus(jobId, {
            status: 'downloading',
            progress: 5,
            description: `Starting download of ${tracks.length} tracks...`
        });
        const CONCURRENCY = 3;
        const processedFiles = [];
        let completed = 0;
        const processTrackWithProgress = async (track, index) => {
            if (await isJobCancelled(jobId))
                return null;
            try {
                const outputFile = await downloadAndProcessTrack(track, albumInfo, settings, tempDir, country);
                completed++;
                const progress = 5 + Math.floor((completed / tracks.length) * 70);
                await updateJobStatus(jobId, {
                    progress,
                    description: `Downloaded ${completed}/${tracks.length}: ${track.title}`
                });
                return outputFile;
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error(`Failed to process track ${track.id}:`, errorMessage);
                await updateJobStatus(jobId, {
                    description: `Warning: Failed to download "${track.title}": ${errorMessage}`
                }).catch(() => { });
                completed++;
                return null;
            }
        };
        for (let i = 0; i < tracks.length; i += CONCURRENCY) {
            if (await isJobCancelled(jobId)) {
                console.log(`Job ${jobId} was cancelled`);
                cleanup(tempDir);
                return;
            }
            const batch = tracks.slice(i, i + CONCURRENCY);
            const results = await Promise.all(batch.map((track, idx) => processTrackWithProgress(track, i + idx)));
            for (const result of results) {
                if (result)
                    processedFiles.push(result);
            }
        }
        if (processedFiles.length === 0) {
            throw new Error('No tracks were successfully downloaded');
        }
        const bucket = getStorage().bucket();
        let publicUrl;
        let fileName;
        const streamUpload = async (filePath, gcsPath, contentType) => {
            const file = bucket.file(gcsPath);
            return new Promise((resolve, reject) => {
                const readStream = fs.createReadStream(filePath);
                const writeStream = file.createWriteStream({
                    resumable: true,
                    contentType,
                    metadata: {
                        contentDisposition: `attachment; filename="${path.basename(filePath)}"`,
                        albumId: albumInfo.id,
                        albumTitle: albumInfo.title
                    },
                    public: true
                });
                readStream.on('error', reject);
                writeStream.on('error', reject);
                writeStream.on('finish', resolve);
                readStream.pipe(writeStream);
            });
        };
        if (processedFiles.length === 1) {
            await updateJobStatus(jobId, {
                progress: 90,
                description: 'Uploading file...'
            });
            fileName = path.basename(processedFiles[0]);
            const gcsPath = `downloads/${jobId}/${fileName}`;
            await streamUpload(processedFiles[0], gcsPath, 'audio/flac');
            publicUrl = `https://storage.googleapis.com/${bucket.name}/${gcsPath}`;
        }
        else {
            await updateJobStatus(jobId, {
                progress: 80,
                description: 'Creating archive...'
            });
            const albumName = sanitizeFileName(`${albumInfo.artist?.name || 'Unknown'} - ${albumInfo.title}`);
            fileName = `${albumName}.zip`;
            const zipPath = path.join(tempDir, fileName);
            await createZipArchive(processedFiles, zipPath, albumName);
            await updateJobStatus(jobId, {
                progress: 90,
                description: 'Uploading archive...'
            });
            const gcsPath = `downloads/${jobId}/${fileName}`;
            await streamUpload(zipPath, gcsPath, 'application/zip');
            publicUrl = `https://storage.googleapis.com/${bucket.name}/${gcsPath}`;
        }
        const fileStats = processedFiles.length === 1
            ? fs.statSync(processedFiles[0])
            : fs.statSync(path.join(tempDir, fileName));
        const fileSize = fileStats.size;
        await updateJobStatus(jobId, {
            status: 'completed',
            progress: 100,
            description: 'Download complete!',
            downloadUrl: publicUrl,
            fileName,
            fileSize
        });
        const deleteAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await getDb().collection('jobs').doc(jobId).update({
            deleteAt,
            completedAt: new Date().toISOString()
        }).catch(() => { });
        console.log(`Job ${jobId} completed successfully`);
    }
    catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        await updateJobStatus(jobId, {
            status: 'failed',
            description: 'Download failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
    finally {
        cleanup(tempDir);
    }
}
async function downloadAndProcessTrack(track, albumInfo, settings, tempDir, country) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
        try {
            const { url } = await (0, qobuz_api_1.getTrackFileUrl)(track.id.toString(), settings.quality, country);
            const outputFileName = formatTrackFileName(track.track_number, track.title, track.performer?.name || albumInfo.artist?.name || 'Unknown', 'flac');
            const outputPath = path.join(tempDir, outputFileName);
            const response = await (0, axios_1.default)({
                method: 'get',
                url,
                responseType: 'stream',
                timeout: 300000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
            if (response.status !== 200) {
                throw new Error(`Unexpected status code: ${response.status}`);
            }
            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(outputPath);
                response.data.on('error', (err) => {
                    writer.destroy();
                    reject(new Error(`Stream error: ${err.message}`));
                });
                writer.on('finish', () => {
                    if (fs.existsSync(outputPath)) {
                        const stats = fs.statSync(outputPath);
                        if (stats.size > 0) {
                            resolve();
                        }
                        else {
                            fs.unlinkSync(outputPath);
                            reject(new Error('Downloaded file is empty'));
                        }
                    }
                    else {
                        reject(new Error('File was not created'));
                    }
                });
                writer.on('error', (err) => {
                    reject(new Error(`Write error: ${err.message}`));
                });
                response.data.pipe(writer);
            });
            return outputPath;
        }
        catch (error) {
            lastError = error;
            const axiosError = error;
            console.error(`[Track ${track.id}] Download attempt ${attempt}/${MAX_DOWNLOAD_RETRIES} failed:`, {
                message: lastError.message,
                status: axiosError.response?.status
            });
            if (axiosError.response?.status === 404 || axiosError.response?.status === 403) {
                throw new Error(`Track not available: ${axiosError.response.status}`);
            }
            if (attempt < MAX_DOWNLOAD_RETRIES) {
                const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
                console.log(`[Track ${track.id}] Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    throw lastError || new Error(`Failed to download track ${track.id} after ${MAX_DOWNLOAD_RETRIES} attempts`);
}
async function createZipArchive(files, outputPath, folderName) {
    console.log(`Creating ZIP archive: ${outputPath} with ${files.length} files`);
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 0 } });
        const timeout = setTimeout(() => {
            archive.abort();
            reject(new Error('Archive creation timed out after 5 minutes'));
        }, 5 * 60 * 1000);
        output.on('close', () => {
            clearTimeout(timeout);
            console.log(`ZIP archive created successfully: ${archive.pointer()} bytes`);
            resolve();
        });
        output.on('error', (err) => {
            clearTimeout(timeout);
            console.error('Output stream error:', err);
            reject(err);
        });
        archive.on('error', (err) => {
            clearTimeout(timeout);
            console.error('Archive error:', err);
            reject(err);
        });
        archive.pipe(output);
        for (const file of files) {
            if (fs.existsSync(file)) {
                const fileName = path.basename(file);
                archive.file(file, { name: `${folderName}/${fileName}` });
                console.log(`Added to archive: ${fileName}`);
            }
            else {
                console.warn(`File not found, skipping: ${file}`);
            }
        }
        console.log('Finalizing archive...');
        archive.finalize();
    });
}
function cleanup(dir) {
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    catch (error) {
        console.error('Cleanup error:', error);
    }
}
//# sourceMappingURL=download.js.map