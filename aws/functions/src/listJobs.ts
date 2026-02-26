/**
 * List Jobs Lambda Function
 * Returns the most recent jobs from DynamoDB
 */
import type { APIGatewayEvent, APIGatewayResponse } from './types.js';
import { CORS_HEADERS } from './types.js';
import { queryJobsByStatus, queryJobsByUser, queryHistoryByEmail } from './dynamodb.js';
import { authenticateRequest as authenticateCognito } from './cognito-auth.js';

export async function handler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, error: 'Method not allowed' })
        };
    }

    try {
        // Check for Auth Token
        const authHeader = event.headers['Authorization'] || event.headers['authorization'];
        let userId: string | null = null;
        let userEmail: string | null = null;

        if (authHeader) {
            // Cognito Authentication
            const cognitoUser = await authenticateCognito(authHeader);
            if (cognitoUser) {
                userId = cognitoUser.uid;
                userEmail = cognitoUser.email;
            }
        }

        let jobs;

        // If User Authenticated -> Return History
        if (userEmail) {
            // Priority: Query by Email from Download Logs (Permanent History)
            jobs = await queryHistoryByEmail(userEmail, { limit: 50 });
        } else if (userId) {
            // Fallback: Query by ID from Jobs (Ephemeral/Active)
            jobs = await queryJobsByUser(userId, { limit: 50 });
        } else {
            // No Token -> Recent Public Jobs
            const allStatuses = ['pending', 'downloading', 'processing', 'completed', 'failed', 'cancelled'];
            jobs = await queryJobsByStatus(allStatuses, { limit: 50 });
        }

        // Strip large fields and parse albumInfo if it's a string
        const cleanJobs = jobs.map(job => {
            let albumInfo = job.albumInfo;
            if (typeof albumInfo === 'string' && albumInfo.startsWith('{')) {
                try {
                    albumInfo = JSON.parse(albumInfo);
                } catch (e) {
                    console.error('Failed to parse albumInfo JSON for job', job.id, e);
                }
            }
            return { ...job, albumInfo };
        });

        // Force redeploy v5
        console.log('ListJobs called - v5 deploy');

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: true, jobs: cleanJobs })
        };

    } catch (error) {
        console.error('List jobs error:', error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ error: 'Internal error' })
        };
    }
}
