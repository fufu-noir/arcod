/**
 * Get Job Lambda Function
 * Retrieves a job by ID from DynamoDB
 */
import type { APIGatewayEvent, APIGatewayResponse } from './types.js';
import { CORS_HEADERS } from './types.js';
import { getJobById } from './dynamodb.js';

export async function handler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: ''
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, error: 'Method not allowed' })
        };
    }

    try {
        const jobId = event.pathParameters?.jobId;

        if (!jobId) {
            return {
                statusCode: 400,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, error: 'Missing job ID' })
            };
        }

        const job = await getJobById(jobId);

        if (!job) {
            return {
                statusCode: 404,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, error: 'Job not found' })
            };
        }

        // Strip large fields or parse albumInfo for history
        let albumInfo = job.albumInfo;
        if (typeof albumInfo === 'string' && albumInfo.startsWith('{')) {
            try {
                albumInfo = JSON.parse(albumInfo);
            } catch (e) {
                console.warn('Failed to parse albumInfo', e);
            }
        }

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: true, job: { ...job, albumInfo } })
        };

        // Force redeploy v4

    } catch (error) {
        console.error('Get job error:', error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Internal error'
            })
        };
    }
}
