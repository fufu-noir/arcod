import {
    S3Client,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';

const r2Client = new S3Client({
    region: 'auto',
    endpoint: config.r2.endpoint,
    credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
    },
});

const BUCKET = config.r2.bucket;

export function buildPublicUrl(key: string): string {
    const baseUrl = config.r2.publicUrl.replace(/\/+$/, '');
    const encodedKey = key.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `${baseUrl}/${encodedKey}`;
}

const MAX_CONCURRENT_UPLOADS = 3;
let activeUploads = 0;
const uploadQueue: (() => void)[] = [];

async function acquireUploadSlot(): Promise<void> {
    if (activeUploads < MAX_CONCURRENT_UPLOADS) { activeUploads++; return; }
    await new Promise<void>(resolve => uploadQueue.push(resolve));
    activeUploads++;
}

function releaseUploadSlot(): void {
    activeUploads--;
    const next = uploadQueue.shift();
    if (next) next();
}

function buildContentDisposition(fileName: string): string {
    const ascii = fileName.replace(/[^\x20-\x7E]/g, '_');
    try {
        const encoded = encodeURIComponent(fileName);
        return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
    } catch {
        return `attachment; filename="${ascii}"`;
    }
}

export async function uploadToR2(
    filePath: string,
    key: string,
    contentType: string,
): Promise<string> {
    await acquireUploadSlot();
    try {
        const fileName = path.basename(filePath);
        const fileSize = fs.statSync(filePath).size;
        const MULTIPART_THRESHOLD = 64 * 1024 * 1024;

        if (fileSize < MULTIPART_THRESHOLD) {
            const body = fs.readFileSync(filePath);
            await r2Client.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: key,
                Body: body,
                ContentType: contentType,
                ContentDisposition: buildContentDisposition(fileName),
            }));
        } else {
            const upload = new Upload({
                client: r2Client,
                params: {
                    Bucket: BUCKET,
                    Key: key,
                    Body: fs.createReadStream(filePath),
                    ContentType: contentType,
                    ContentDisposition: buildContentDisposition(fileName),
                },
                partSize: 8 * 1024 * 1024,
                queueSize: 4,
            });
            await upload.done();
        }

        return buildPublicUrl(key);
    } finally {
        releaseUploadSlot();
    }
}

export async function startUploadStreamToR2(key: string, contentType: string, fileName?: string) {
    await acquireUploadSlot();
    const passThrough = new PassThrough();
    const upload = new Upload({
        client: r2Client,
        params: {
            Bucket: BUCKET,
            Key: key,
            Body: passThrough,
            ContentType: contentType,
            ContentDisposition: fileName ? buildContentDisposition(fileName) : undefined,
        },
    });
    const originalDone = upload.done.bind(upload);
    upload.done = async () => {
        try { return await originalDone(); }
        finally { releaseUploadSlot(); }
    };
    return { stream: passThrough, upload };
}
