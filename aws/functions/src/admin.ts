/**
 * Admin API Lambda Functions
 * Manage blocked IPs and rate limits
 */
import type { APIGatewayEvent, APIGatewayResponse } from './types.js';
import { CORS_HEADERS } from './types.js';
import { dynamodb, BLOCKED_IPS_TABLE, RATE_LIMITED_IPS_TABLE } from './dynamodb.js';
import { ScanCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { authenticateRequest } from './cognito-auth.js';

// TODO: In production, verify that the authenticated user is actually an admin
// For now, we'll just check for a valid token

async function verifyAdmin(event: APIGatewayEvent): Promise<boolean> {
    const auth = await authenticateRequest(event.headers['authorization'] || event.headers['Authorization'] || '');
    return !!auth;
}

/**
 * Handle Blocked IPs operations
 */
export async function blockedIPsHandler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
    // CORS
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

    // Auth check
    if (!(await verifyAdmin(event))) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    try {
        if (event.httpMethod === 'GET') {
            const result = await dynamodb.send(new ScanCommand({ TableName: BLOCKED_IPS_TABLE }));
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: true, blockedIPs: result.Items || [] })
            };
        }

        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            if (!body.ip) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing IP' }) };

            const normalizedIP = body.ip.replace(/\./g, '_');
            const item = {
                ip: normalizedIP,
                originalIp: body.ip,
                reason: body.reason || 'Manually blocked',
                blockedAt: new Date().toISOString(),
                blockedBy: 'admin' // TODO: Get from token
            };

            await dynamodb.send(new PutCommand({
                TableName: BLOCKED_IPS_TABLE,
                Item: item
            }));

            return {
                statusCode: 201,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: true, item })
            };
        }

        if (event.httpMethod === 'DELETE') {
            const ip = event.pathParameters?.ip;
            if (!ip) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing IP' }) };

            const normalizedIP = ip.replace(/\./g, '_');
            await dynamodb.send(new DeleteCommand({
                TableName: BLOCKED_IPS_TABLE,
                Key: { ip: normalizedIP }
            }));

            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: true })
            };
        }

        return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

    } catch (error) {
        console.error('Admin Blocked IPs error:', error);
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal error' }) };
    }
}

/**
 * Handle Rate Limits operations
 */
export async function rateLimitsHandler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
    // CORS
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

    // Auth check
    if (!(await verifyAdmin(event))) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    try {
        if (event.httpMethod === 'GET') {
            const result = await dynamodb.send(new ScanCommand({ TableName: RATE_LIMITED_IPS_TABLE }));
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: true, rateLimitedIPs: result.Items || [] })
            };
        }

        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            if (!body.ip) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing IP' }) };

            const normalizedIP = body.ip.replace(/\./g, '_');
            const item = {
                ip: normalizedIP,
                originalIp: body.ip,
                maxDownloadsPerHour: body.maxDownloadsPerHour || 10,
                reason: body.reason || 'Rate limit applied',
                createdAt: new Date().toISOString(),
                createdBy: 'admin'
            };

            await dynamodb.send(new PutCommand({
                TableName: RATE_LIMITED_IPS_TABLE,
                Item: item
            }));

            return {
                statusCode: 201,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: true, item })
            };
        }

        if (event.httpMethod === 'DELETE') {
            const ip = event.pathParameters?.ip;
            if (!ip) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing IP' }) };

            const normalizedIP = ip.replace(/\./g, '_');
            await dynamodb.send(new DeleteCommand({
                TableName: RATE_LIMITED_IPS_TABLE,
                Key: { ip: normalizedIP }
            }));

            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: true })
            };
        }

        return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

    } catch (error) {
        console.error('Admin Rate Limits error:', error);
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal error' }) };
    }
}
