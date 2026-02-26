/**
 * DynamoDB client and helper functions
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
    QueryCommand,
    ScanCommand
} from '@aws-sdk/lib-dynamodb';
import type { DownloadJob } from './types.js';

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-north-1' });
export const dynamodb = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
        removeUndefinedValues: true
    }
});

// Table names from environment
export const JOBS_TABLE = process.env.JOBS_TABLE || 'qobuz-jobs';
export const DOWNLOAD_LOGS_TABLE = process.env.DOWNLOAD_LOGS_TABLE || 'qobuz-download-logs';
export const BLOCKED_IPS_TABLE = process.env.BLOCKED_IPS_TABLE || 'qobuz-blocked-ips';
export const RATE_LIMITED_IPS_TABLE = process.env.RATE_LIMITED_IPS_TABLE || 'qobuz-rate-limited-ips';

/**
 * Get a job by ID
 */
export async function getJobById(jobId: string): Promise<DownloadJob | null> {
    const result = await dynamodb.send(new GetCommand({
        TableName: JOBS_TABLE,
        Key: { id: jobId }
    }));
    return result.Item as DownloadJob | null;
}

/**
 * Create a new job
 */
export async function createJob(job: DownloadJob): Promise<void> {
    await dynamodb.send(new PutCommand({
        TableName: JOBS_TABLE,
        Item: job
    }));
}

/**
 * Update job status and fields
 */
export async function updateJob(
    jobId: string,
    updates: Partial<DownloadJob>
): Promise<void> {
    const now = new Date().toISOString();

    // Build update expression dynamically
    const updateExpressions: string[] = ['#updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const expressionAttributeValues: Record<string, any> = { ':updatedAt': now };

    for (const [key, value] of Object.entries(updates)) {
        if (key !== 'id' && value !== undefined) {
            updateExpressions.push(`#${key} = :${key}`);
            expressionAttributeNames[`#${key}`] = key;
            expressionAttributeValues[`:${key}`] = value;
        }
    }

    await dynamodb.send(new UpdateCommand({
        TableName: JOBS_TABLE,
        Key: { id: jobId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues
    }));
}

/**
 * Delete a job
 */
export async function deleteJob(jobId: string): Promise<void> {
    await dynamodb.send(new DeleteCommand({
        TableName: JOBS_TABLE,
        Key: { id: jobId }
    }));
}

/**
 * Query jobs by status
 */
export async function queryJobsByStatus(
    status: string | string[],
    options?: {
        limit?: number;
        sortKey?: 'createdAt' | 'updatedAt';
        sortOrder?: 'asc' | 'desc';
    }
): Promise<DownloadJob[]> {
    const statusArray = Array.isArray(status) ? status : [status];
    const sortKey = options?.sortKey || 'createdAt';
    const sortOrder = options?.sortOrder || 'desc';
    const limit = options?.limit || 50;

    const allJobs: DownloadJob[] = [];

    for (const s of statusArray) {
        const result = await dynamodb.send(new QueryCommand({
            TableName: JOBS_TABLE,
            IndexName: `status-${sortKey}-index`,
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':status': s },
            ScanIndexForward: sortOrder === 'asc',
            Limit: limit
        }));

        if (result.Items) {
            allJobs.push(...(result.Items as DownloadJob[]));
        }
    }

    // Sort combined results
    allJobs.sort((a, b) => {
        const dateA = new Date(a[sortKey] || a.createdAt).getTime();
        const dateB = new Date(b[sortKey] || b.createdAt).getTime();
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    return allJobs.slice(0, limit);
}

/**
 * Query jobs by User ID (History)
 */
export async function queryJobsByUser(
    userId: string,
    options?: {
        limit?: number;
        sortOrder?: 'asc' | 'desc';
    }
): Promise<DownloadJob[]> {
    const limit = options?.limit || 50;
    const sortOrder = options?.sortOrder || 'desc';

    const result = await dynamodb.send(new QueryCommand({
        TableName: JOBS_TABLE,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ScanIndexForward: sortOrder === 'asc',
        Limit: limit
    }));

    return (result.Items as DownloadJob[]) || [];
}

/**
 * Count active jobs
 */
export async function countActiveJobs(): Promise<number> {
    const statuses = ['pending', 'downloading', 'processing'];
    let total = 0;

    for (const status of statuses) {
        const result = await dynamodb.send(new QueryCommand({
            TableName: JOBS_TABLE,
            IndexName: 'status-createdAt-index',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':status': status },
            Select: 'COUNT'
        }));
        total += result.Count || 0;
    }

    return total;
}

/**
 * Check if an IP is blocked
 */
export async function isIPBlocked(ip: string): Promise<boolean> {
    const normalizedIP = ip.replace(/\./g, '_');
    const result = await dynamodb.send(new GetCommand({
        TableName: BLOCKED_IPS_TABLE,
        Key: { ip: normalizedIP }
    }));
    return !!result.Item;
}

/**
 * Get rate limit for an IP
 */
export async function getRateLimit(ip: string): Promise<{ maxDownloadsPerHour: number } | null> {
    const normalizedIP = ip.replace(/\./g, '_');
    const result = await dynamodb.send(new GetCommand({
        TableName: RATE_LIMITED_IPS_TABLE,
        Key: { ip: normalizedIP }
    }));
    return result.Item as { maxDownloadsPerHour: number } | null;
}

/**
 * Count downloads for an IP since a given time
 */
export async function countDownloadsSince(ip: string, since: string): Promise<number> {
    const result = await dynamodb.send(new QueryCommand({
        TableName: DOWNLOAD_LOGS_TABLE,
        IndexName: 'ip-createdAt-index',
        KeyConditionExpression: '#ip = :ip AND #createdAt >= :since',
        ExpressionAttributeNames: {
            '#ip': 'ip',
            '#createdAt': 'createdAt'
        },
        ExpressionAttributeValues: {
            ':ip': ip,
            ':since': since
        },
        Select: 'COUNT'
    }));
    return result.Count || 0;
}

/**
 * Log a download
 */
export async function logDownload(data: any): Promise<void> {
    await dynamodb.send(new PutCommand({
        TableName: DOWNLOAD_LOGS_TABLE,
        Item: data
    }));
}

/**
 * Get a download log by ID
 */
export async function getDownloadLogById(logId: string): Promise<DownloadJob | null> {
    const result = await dynamodb.send(new GetCommand({
        TableName: DOWNLOAD_LOGS_TABLE,
        Key: { id: logId }
    }));
    return result.Item as DownloadJob | null;
}

/**
 * Delete a download log
 */
export async function deleteDownloadLog(logId: string): Promise<void> {
    await dynamodb.send(new DeleteCommand({
        TableName: DOWNLOAD_LOGS_TABLE,
        Key: { id: logId }
    }));
}

/**
 * Update a download log with additional info (file size, url)
 */
export async function updateDownloadLog(logId: string, updates: any): Promise<void> {
    try {
        const updateExpressions: string[] = [];
        const expressionAttributeNames: Record<string, string> = {};
        const expressionAttributeValues: Record<string, any> = {};

        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                updateExpressions.push(`#${key} = :${key}`);
                expressionAttributeNames[`#${key}`] = key;
                expressionAttributeValues[`:${key}`] = value;
            }
        }

        if (updateExpressions.length === 0) return;

        await dynamodb.send(new UpdateCommand({
            TableName: DOWNLOAD_LOGS_TABLE,
            Key: { id: logId },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues
        }));
    } catch (error) {
        console.warn(`Failed to update download log ${logId}:`, error);
    }
}

/**
 * Sum storage usage for a user (Last 24h)
 */
export async function sumUserStorage(userId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const result = await dynamodb.send(new QueryCommand({
        TableName: DOWNLOAD_LOGS_TABLE,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :userId AND createdAt > :cutoff',
        ExpressionAttributeValues: {
            ':userId': userId,
            ':cutoff': cutoff
        }
    }));

    if (!result.Items) return 0;
    return result.Items.reduce((sum, item) => sum + (item.fileSize || 0), 0);
}

/**
 * Query jobs with old update times (for cleanup)
 */
export async function queryStuckJobs(cutoffTime: string): Promise<DownloadJob[]> {
    const statuses = ['pending', 'downloading', 'processing'];
    const allJobs: DownloadJob[] = [];

    for (const status of statuses) {
        const result = await dynamodb.send(new QueryCommand({
            TableName: JOBS_TABLE,
            IndexName: 'status-updatedAt-index',
            KeyConditionExpression: '#status = :status AND #updatedAt < :cutoff',
            ExpressionAttributeNames: {
                '#status': 'status',
                '#updatedAt': 'updatedAt'
            },
            ExpressionAttributeValues: {
                ':status': status,
                ':cutoff': cutoffTime
            }
        }));

        if (result.Items) {
            allJobs.push(...(result.Items as DownloadJob[]));
        }
    }

    return allJobs;
}

/**
 * Query completed jobs ready for deletion
 */
export async function queryCompletedJobsForDeletion(cutoffTime: string): Promise<DownloadJob[]> {
    const statuses = ['completed', 'failed', 'cancelled'];
    const allJobs: DownloadJob[] = [];

    for (const status of statuses) {
        const result = await dynamodb.send(new QueryCommand({
            TableName: JOBS_TABLE,
            IndexName: 'status-updatedAt-index',
            KeyConditionExpression: '#status = :status AND #updatedAt < :cutoff',
            ExpressionAttributeNames: {
                '#status': 'status',
                '#updatedAt': 'updatedAt'
            },
            ExpressionAttributeValues: {
                ':status': status,
                ':cutoff': cutoffTime
            }
        }));

        if (result.Items) {
            allJobs.push(...(result.Items as DownloadJob[]));
        }
    }

    return allJobs;
}

/**
 * Count total download logs
 */
export async function countTotalDownloads(): Promise<number> {
    // Note: This is expensive for large tables, consider using a counter table instead
    const result = await dynamodb.send(new ScanCommand({
        TableName: DOWNLOAD_LOGS_TABLE,
        Select: 'COUNT'
    }));
    return result.Count || 0;
}

/**
 * Query download history by User Email
 */
export async function queryHistoryByEmail(
    email: string,
    options?: {
        limit?: number;
        sortOrder?: 'asc' | 'desc';
    }
): Promise<DownloadJob[]> {
    const limit = options?.limit || 50;
    const sortOrder = options?.sortOrder || 'desc';

    const result = await dynamodb.send(new QueryCommand({
        TableName: DOWNLOAD_LOGS_TABLE,
        IndexName: 'userEmail-createdAt-index',
        KeyConditionExpression: 'userEmail = :email',
        ExpressionAttributeValues: { ':email': email },
        ScanIndexForward: sortOrder === 'asc',
        Limit: limit
    }));

    return (result.Items as DownloadJob[]) || [];
}

/**
 * Count downloads today
 */
export async function countDownloadsToday(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    // This requires a scan since we don't have a GSI for date ranges across all IPs
    // In production, consider adding a date-based partition key or using a counter
    const result = await dynamodb.send(new ScanCommand({
        TableName: DOWNLOAD_LOGS_TABLE,
        FilterExpression: '#createdAt >= :today',
        ExpressionAttributeNames: { '#createdAt': 'createdAt' },
        ExpressionAttributeValues: { ':today': todayISO },
        Select: 'COUNT'
    }));
    return result.Count || 0;
}
