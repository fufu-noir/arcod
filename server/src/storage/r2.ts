/**
 * R2 Storage Client — S3-compatible
 * Drop-in replacement for aws/functions/src/s3.ts
 */
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    GetObjectCommand,
    HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { config } from '../config.js';
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
    metadata?: Record<string, string>
): Promise<string> {
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const MULTIPART_THRESHOLD = 64 * 1024 * 1024; // 64 MB

    if (fileSize < MULTIPART_THRESHOLD) {
        // Small files: single PUT request — no multipart overhead
        const body = fs.readFileSync(filePath);
        await r2Client.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: body,
            ContentType: contentType,
            ContentDisposition: buildContentDisposition(fileName),
            Metadata: metadata,
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
                Metadata: metadata,
            },
            partSize: 8 * 1024 * 1024,
            queueSize: 4,
        });
        await upload.done();
    }

    return buildPublicUrl(key);
}

export async function uploadBufferToR2(
    buffer: Buffer,
    key: string,
    contentType: string,
    fileName?: string
): Promise<string> {
    await r2Client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentDisposition: fileName ? buildContentDisposition(fileName) : undefined,
    }));
    return buildPublicUrl(key);
}

export function startUploadStreamToR2(key: string, contentType: string, fileName?: string) {
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

    return { stream: passThrough, upload };
}

export async function deleteFromR2(key: string): Promise<void> {
    await r2Client.send(new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
    }));
}

export async function deleteFolder(prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
        const listResult = await r2Client.send(new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));

        if (listResult.Contents) {
            for (const object of listResult.Contents) {
                if (object.Key) {
                    await deleteFromR2(object.Key);
                    deleted++;
                }
            }
        }

        continuationToken = listResult.NextContinuationToken;
    } while (continuationToken);

    return deleted;
}

export async function generatePresignedUrl(key: string, expiresIn: number = 300): Promise<string> {
    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
    });
    return getSignedUrl(r2Client, command, { expiresIn });
}

export async function objectExistsInR2(key: string): Promise<boolean> {
    try {
        await r2Client.send(new HeadObjectCommand({
            Bucket: BUCKET,
            Key: key,
        }));
        return true;
    } catch (err: any) {
        const status = err?.$metadata?.httpStatusCode;
        if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') {
            return false;
        }
        throw err;
    }
}

export function extractKeyFromUrl(url: string): string {
    // Handles both full R2 URLs and CloudFront URLs
    // e.g., https://dl.arcod.xyz/downloads/xxx/file.zip → downloads/xxx/file.zip
    // Decode URI components so encoded public URLs map back to the raw R2 key.
    // Some older rows stored literal "%" characters; escape invalid percent signs
    // before decoding so "100%_No..." still extracts to the real key.
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname.replace(/^\//, '');
        const safePathname = pathname.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
        return decodeURIComponent(safePathname);
    } catch {
        return url;
    }
}

export { r2Client, BUCKET };
