/**
 * Guest rate limit API
 * GET: Returns current guest rate limit status for an IP
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getGuestRateLimitStatus } from './guest-rate-limit.js';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Forwarded-For'
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Get client IP from headers (forwarded by API Gateway)
        const ip = event.headers['X-Forwarded-For']?.split(',')[0]?.trim()
            || event.requestContext.identity?.sourceIp
            || 'unknown';

        console.log(`[Guest Rate Limit] Checking status for IP: ${ip}`);

        const status = await getGuestRateLimitStatus(ip);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(status)
        };

    } catch (error: any) {
        console.error('Error checking guest rate limit:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
}
