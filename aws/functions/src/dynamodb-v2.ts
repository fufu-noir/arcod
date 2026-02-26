/**
 * DynamoDB helpers for V2 download jobs
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DownloadJobV2 } from './types-v2.js';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const DOWNLOADS_TABLE = process.env.DOWNLOADS_TABLE_V2 || 'qobuz-downloads-v2';

export async function createDownloadJob(job: DownloadJobV2): Promise<void> {
    await docClient.send(new PutCommand({
        TableName: DOWNLOADS_TABLE,
        Item: job
    }));
}

export async function getDownloadJob(id: string): Promise<DownloadJobV2 | null> {
    const result = await docClient.send(new GetCommand({
        TableName: DOWNLOADS_TABLE,
        Key: { id }
    }));
    return (result.Item as DownloadJobV2) || null;
}

export async function updateDownloadJob(id: string, updates: Partial<DownloadJobV2>): Promise<void> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // Always update updatedAt
    updates.updatedAt = new Date().toISOString();

    Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined) {
            updateExpressions.push(`#${key} = :${key}`);
            expressionAttributeNames[`#${key}`] = key;
            expressionAttributeValues[`:${key}`] = value;
        }
    });

    if (updateExpressions.length === 0) return;

    await docClient.send(new UpdateCommand({
        TableName: DOWNLOADS_TABLE,
        Key: { id },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues
    }));
}

export async function getUserDownloads(userId: string, limit: number = 50): Promise<DownloadJobV2[]> {
    const result = await docClient.send(new QueryCommand({
        TableName: DOWNLOADS_TABLE,
        IndexName: 'userId-createdAt-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
            ':userId': userId
        },
        ScanIndexForward: false,
        Limit: limit
    }));
    return (result.Items as DownloadJobV2[]) || [];
}

export async function getUserDownloadsByEmail(userEmail: string, limit: number = 50): Promise<DownloadJobV2[]> {
    const result = await docClient.send(new QueryCommand({
        TableName: DOWNLOADS_TABLE,
        IndexName: 'userEmail-createdAt-index',
        KeyConditionExpression: 'userEmail = :userEmail',
        ExpressionAttributeValues: {
            ':userEmail': userEmail
        },
        ScanIndexForward: false,
        Limit: limit
    }));
    return (result.Items as DownloadJobV2[]) || [];
}

/**
 * Sum up total storage used by a user across both tables.
 * Only counts downloads that actually have a file stored in S3.
 */
export async function getUserStorageUsed(userEmail: string): Promise<number> {
    let totalSize = 0;

    // V2 table - only count entries with an actual file in S3
    let lastEvaluatedKeyV2: Record<string, any> | undefined;
    do {
        const result = await docClient.send(new QueryCommand({
            TableName: DOWNLOADS_TABLE,
            IndexName: 'userEmail-createdAt-index',
            KeyConditionExpression: 'userEmail = :userEmail',
            FilterExpression: '#status = :completed AND attribute_exists(downloadUrl)',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':userEmail': userEmail,
                ':completed': 'completed'
            },
            ProjectionExpression: 'fileSize, downloadUrl',
            ExclusiveStartKey: lastEvaluatedKeyV2
        }));

        if (result.Items) {
            for (const item of result.Items) {
                // skip entries without a real download url
                if (item.fileSize && typeof item.fileSize === 'number' && item.downloadUrl) {
                    totalSize += item.fileSize;
                }
            }
        }

        lastEvaluatedKeyV2 = result.LastEvaluatedKey;
    } while (lastEvaluatedKeyV2);

    // Also check the old table
    const OLD_TABLE = 'qobuz-download-logs';
    let lastEvaluatedKeyOld: Record<string, any> | undefined;
    try {
        do {
            const result = await docClient.send(new QueryCommand({
                TableName: OLD_TABLE,
                IndexName: 'userEmail-createdAt-index',
                KeyConditionExpression: 'userEmail = :userEmail',
                FilterExpression: '#status = :completed AND attribute_exists(downloadUrl)',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':userEmail': userEmail,
                    ':completed': 'completed'
                },
                ProjectionExpression: 'fileSize, downloadUrl',
                ExclusiveStartKey: lastEvaluatedKeyOld
            }));

            if (result.Items) {
                for (const item of result.Items) {
                    // skip if no real url
                    if (item.fileSize && typeof item.fileSize === 'number' && item.downloadUrl) {
                        totalSize += item.fileSize;
                    }
                }
            }

            lastEvaluatedKeyOld = result.LastEvaluatedKey;
        } while (lastEvaluatedKeyOld);
    } catch (err) {
        // Old table might not exist or index might be different - continue with V2 only
        console.warn('Could not query old download logs table:', err);
    }

    return totalSize;
}

