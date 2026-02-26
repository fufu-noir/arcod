/**
 * List Downloads V2 - returns user's download history
 * Merges results from both V2 and legacy tables
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserDownloadsByEmail } from './dynamodb-v2.js';
import { authenticateRequest } from './cognito-auth.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const OLD_TABLE = 'qobuz-download-logs';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

// Get downloads from old table by email
async function getOldDownloadsByEmail(userEmail: string, limit: number = 100): Promise<any[]> {
    try {
        const result = await docClient.send(new QueryCommand({
            TableName: OLD_TABLE,
            IndexName: 'userEmail-createdAt-index',
            KeyConditionExpression: 'userEmail = :userEmail',
            ExpressionAttributeValues: {
                ':userEmail': userEmail
            },
            ScanIndexForward: false,
            Limit: limit
        }));
        return result.Items || [];
    } catch (error) {
        console.error('Error fetching old downloads:', error);
        return [];
    }
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

        // Use email to query
        const userEmail = authUser.email;

        if (!userEmail) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'User email not found in token' })
            };
        }

        // Get downloads from V2 table by email
        const downloadsV2 = await getUserDownloadsByEmail(userEmail, 100);

        // Get downloads from OLD table by email
        const downloadsOld = await getOldDownloadsByEmail(userEmail, 100);

        // Map V2 downloads to library format
        const itemsV2 = downloadsV2
            .filter(d => d.status === 'completed' && d.downloadUrl)
            .map(job => ({
                id: job.id,
                fileName: job.fileName || 'download',
                url: job.downloadUrl || null,
                metadata: {
                    id: job.albumId,
                    title: job.albumTitle,
                    artistName: job.artistName,
                    artistId: job.artistId,
                    image: job.coverUrl
                },
                type: job.trackId ? 'track' : 'album',
                source: 'qobuz',
                fileSize: job.fileSize,
                createdAt: job.createdAt
            }));

        // Map OLD downloads to library format
        const itemsOld = downloadsOld
            .filter(d => d.status === 'completed' && d.downloadUrl)
            .map(job => ({
                id: job.id,
                fileName: job.fileName || 'download',
                url: job.downloadUrl || null,
                metadata: {
                    id: job.albumId || job.releaseId,
                    title: job.albumTitle || job.title,
                    artistName: job.artistName || job.artist,
                    image: job.coverUrl || job.cover
                },
                type: job.trackId ? 'track' : 'album',
                source: 'qobuz',
                fileSize: job.fileSize,
                createdAt: job.createdAt
            }));

        // Merge and dedupe by id
        const allItems = [...itemsV2, ...itemsOld];
        const uniqueItems = allItems.filter((item, index, self) =>
            index === self.findIndex(t => t.id === item.id)
        );

        // Sort by createdAt descending
        uniqueItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                items: uniqueItems
            })
        };

    } catch (error: any) {
        console.error('Error listing downloads:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
}
