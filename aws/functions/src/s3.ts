/**
 * S3 client and helper functions
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';

// Initialize S3 client
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'eu-north-1' });

export const S3_BUCKET = process.env.S3_BUCKET || 'qobuz-dl-downloads';
export const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || '';

/**
 * Upload a file to S3 using streaming
 */
export async function uploadToS3(
    filePath: string,
    key: string,
    contentType: string,
    metadata?: Record<string, string>
): Promise<string> {
    const fileStream = fs.createReadStream(filePath);
    const fileName = path.basename(filePath);

    await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: fileStream,
        ContentType: contentType,
        ContentDisposition: `attachment; filename="${fileName}"`,
        Metadata: metadata
    }));

    // Return CloudFront URL if available, otherwise S3 URL
    if (CLOUDFRONT_DOMAIN) {
        return `https://${CLOUDFRONT_DOMAIN}/${key}`;
    }
    return `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'eu-north-1'}.amazonaws.com/${key}`;
}

/**
 * Upload a buffer to S3
 */
export async function uploadBufferToS3(
    buffer: Buffer,
    key: string,
    contentType: string,
    fileName: string,
    metadata?: Record<string, string>
): Promise<string> {
    await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentDisposition: `attachment; filename="${fileName}"`,
        Metadata: metadata
    }));

    // Return CloudFront URL if available, otherwise S3 URL
    if (CLOUDFRONT_DOMAIN) {
        return `https://${CLOUDFRONT_DOMAIN}/${key}`;
    }
    return `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'eu-north-1'}.amazonaws.com/${key}`;
}

/**
 * Delete a file from S3
 */
export async function deleteFromS3(key: string): Promise<void> {
    await s3Client.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: key
    }));
}

/**
 * Delete all files in a folder (prefix)
 */
export async function deleteFolder(prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
        const listResult = await s3Client.send(new ListObjectsV2Command({
            Bucket: S3_BUCKET,
            Prefix: prefix,
            ContinuationToken: continuationToken
        }));

        if (listResult.Contents) {
            for (const object of listResult.Contents) {
                if (object.Key) {
                    await deleteFromS3(object.Key);
                    deleted++;
                }
            }
        }

        continuationToken = listResult.NextContinuationToken;
    } while (continuationToken);

    return deleted;
}

/**
 * Generate a presigned URL for direct upload (if needed)
 */
export async function getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ContentType: contentType
    });

    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

/**
 * Get content type based on output format
 */
export function getContentType(format: string | undefined, quality: number | string): string {
    const normalizedFormat = format?.toUpperCase();
    const codecMap: Record<string, string> = {
        FLAC: 'audio/flac',
        WAV: 'audio/wav',
        ALAC: 'audio/mp4',
        MP3: 'audio/mpeg',
        AAC: 'audio/mp4',
        OPUS: 'audio/opus'
    };

    if (normalizedFormat && codecMap[normalizedFormat]) {
        return codecMap[normalizedFormat];
    }

    // Fallback to source format
    const qualityNum = typeof quality === 'string' ? parseInt(quality, 10) : quality;
    return qualityNum === 5 ? 'audio/mpeg' : 'audio/flac';
}
