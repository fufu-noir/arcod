/**
 * Guest Rate Limit - DynamoDB Operations
 * Tracks guest downloads per IP with hourly limit
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const GUEST_LIMITS_TABLE = process.env.GUEST_LIMITS_TABLE || 'qobuz-guest-downloads';
const GUEST_HOURLY_LIMIT = 50;
const ONE_HOUR_MS = 60 * 60 * 1000;

export interface GuestRateLimitInfo {
    ip: string;
    downloadsThisHour: number;
    limit: number;
    remaining: number;
    resetsAt: string;  // ISO timestamp
    isLimited: boolean;
}

export interface GuestDownloadRecord {
    ip: string;
    hourKey: string;  // e.g., "2026-02-03T17" (hourly bucket)
    count: number;
    ttl: number;      // Auto-expire after 2 hours
    createdAt: string;
    updatedAt: string;
}

/**
 * Get current hour key for bucketing downloads
 */
function getCurrentHourKey(): string {
    const now = new Date();
    return now.toISOString().slice(0, 13); // "2026-02-03T17"
}

/**
 * Calculate when the current hour resets
 */
function getHourResetTime(): Date {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return nextHour;
}

/**
 * Get guest rate limit status for an IP
 */
export async function getGuestRateLimitStatus(ip: string): Promise<GuestRateLimitInfo> {
    const hourKey = getCurrentHourKey();
    const compositeKey = `${ip}#${hourKey}`;

    try {
        const result = await docClient.send(new GetCommand({
            TableName: GUEST_LIMITS_TABLE,
            Key: { id: compositeKey }
        }));

        const record = result.Item as GuestDownloadRecord | undefined;
        const count = record?.count || 0;
        const remaining = Math.max(0, GUEST_HOURLY_LIMIT - count);
        const resetTime = getHourResetTime();

        return {
            ip,
            downloadsThisHour: count,
            limit: GUEST_HOURLY_LIMIT,
            remaining,
            resetsAt: resetTime.toISOString(),
            isLimited: count >= GUEST_HOURLY_LIMIT
        };
    } catch (error) {
        console.error('Error getting guest rate limit:', error);
        // Default to allowing (fail open)
        return {
            ip,
            downloadsThisHour: 0,
            limit: GUEST_HOURLY_LIMIT,
            remaining: GUEST_HOURLY_LIMIT,
            resetsAt: getHourResetTime().toISOString(),
            isLimited: false
        };
    }
}

/**
 * Increment guest download count for an IP
 * Returns the new count and whether the limit was exceeded
 */
export async function incrementGuestDownload(ip: string): Promise<{ count: number; isLimited: boolean }> {
    const hourKey = getCurrentHourKey();
    const compositeKey = `${ip}#${hourKey}`;
    const now = new Date();
    const ttl = Math.floor((now.getTime() + 2 * ONE_HOUR_MS) / 1000); // Expire after 2 hours

    try {
        const result = await docClient.send(new UpdateCommand({
            TableName: GUEST_LIMITS_TABLE,
            Key: { id: compositeKey },
            UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, #hourKey = :hourKey, #ip = :ip, #ttl = :ttl, #updatedAt = :now, #createdAt = if_not_exists(#createdAt, :now)',
            ExpressionAttributeNames: {
                '#count': 'count',
                '#hourKey': 'hourKey',
                '#ip': 'ip',
                '#ttl': 'ttl',
                '#updatedAt': 'updatedAt',
                '#createdAt': 'createdAt'
            },
            ExpressionAttributeValues: {
                ':zero': 0,
                ':one': 1,
                ':hourKey': hourKey,
                ':ip': ip,
                ':ttl': ttl,
                ':now': now.toISOString()
            },
            ReturnValues: 'ALL_NEW'
        }));

        const newCount = result.Attributes?.count || 1;
        return {
            count: newCount,
            isLimited: newCount > GUEST_HOURLY_LIMIT
        };
    } catch (error) {
        console.error('Error incrementing guest download:', error);
        // On error, allow the download (fail open)
        return { count: 0, isLimited: false };
    }
}

/**
 * Check if guest can download (without incrementing)
 */
export async function canGuestDownload(ip: string): Promise<boolean> {
    const status = await getGuestRateLimitStatus(ip);
    return !status.isLimited;
}
