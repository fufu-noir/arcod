/**
 * Get Storage Info - returns user's storage usage and limit
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserStorageUsed } from './dynamodb-v2.js';
import { authenticateRequest } from './cognito-auth.js';

// Library storage limit per user: 30 GB in bytes
const LIBRARY_SIZE_LIMIT = 30 * 1024 * 1024 * 1024; // 30 GB

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Get user from Authorization header
        const authHeader = event.headers.Authorization || event.headers.authorization;

        if (!authHeader) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Missing authorization header' })
            };
        }

        // Verify token and get user info
        const authUser = await authenticateRequest(authHeader);

        if (!authUser) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Invalid token' })
            };
        }

        const userEmail = authUser.email;

        if (!userEmail) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'User email not found in token' })
            };
        }

        // Get total storage used by this user
        const usedBytes = await getUserStorageUsed(userEmail);
        const limitBytes = LIBRARY_SIZE_LIMIT;
        const percentUsed = Math.min(100, Math.round((usedBytes / limitBytes) * 100));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                storage: {
                    usedBytes,
                    limitBytes,
                    usedFormatted: formatBytes(usedBytes),
                    limitFormatted: formatBytes(limitBytes),
                    percentUsed,
                    isOverLimit: usedBytes >= limitBytes
                }
            })
        };

    } catch (error: any) {
        console.error('Error getting storage info:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
}
