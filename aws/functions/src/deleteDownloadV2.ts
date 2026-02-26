/**
 * Delete Download V2 - removes a download from DynamoDB + S3
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { authenticateRequest } from './cognito-auth.js';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const DOWNLOADS_TABLE = process.env.DOWNLOADS_TABLE_V2 || 'qobuz-downloads-v2';
const OLD_DOWNLOADS_TABLE = 'qobuz-download-logs';
const S3_BUCKET = process.env.S3_BUCKET || '';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    const downloadId = event.pathParameters?.jobId;
    if (!downloadId) {
        return {
            statusCode: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Download ID is required' })
        };
    }

    try {
        // Verify auth token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        const userInfo = await authenticateRequest(authHeader || '');

        if (!userInfo) {
            return {
                statusCode: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: false, error: 'Unauthorized' })
            };
        }

        // Try to get the download from V2 table first, then old table
        let download: any = null;
        let foundInTable: string = '';

        const getResultV2 = await docClient.send(new GetCommand({
            TableName: DOWNLOADS_TABLE,
            Key: { id: downloadId }
        }));

        if (getResultV2.Item) {
            download = getResultV2.Item;
            foundInTable = DOWNLOADS_TABLE;
        } else {
            // Try old table
            try {
                const getResultOld = await docClient.send(new GetCommand({
                    TableName: OLD_DOWNLOADS_TABLE,
                    Key: { id: downloadId }
                }));
                if (getResultOld.Item) {
                    download = getResultOld.Item;
                    foundInTable = OLD_DOWNLOADS_TABLE;
                }
            } catch (oldTableErr) {
                console.warn(`[${downloadId}] Could not check old table:`, oldTableErr);
            }
        }

        if (!download) {
            return {
                statusCode: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: false, error: 'Download not found' })
            };
        }

        // Verify ownership - user must own the download
        if (download.userId !== userInfo.uid && download.userEmail !== userInfo.email) {
            return {
                statusCode: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: false, error: 'Access denied' })
            };
        }

        // Delete files from S3 if bucket is configured
        if (S3_BUCKET) {
            try {
                const s3Prefix = `downloads/${downloadId}/`;

                // List all objects with this prefix
                const listResult = await s3Client.send(new ListObjectsV2Command({
                    Bucket: S3_BUCKET,
                    Prefix: s3Prefix
                }));

                if (listResult.Contents && listResult.Contents.length > 0) {
                    const objectsToDelete = listResult.Contents.map(obj => ({ Key: obj.Key! }));

                    await s3Client.send(new DeleteObjectsCommand({
                        Bucket: S3_BUCKET,
                        Delete: { Objects: objectsToDelete }
                    }));

                    console.log(`[${downloadId}] Deleted ${objectsToDelete.length} S3 objects`);
                }
            } catch (s3Error) {
                console.error(`[${downloadId}] S3 deletion error (non-fatal):`, s3Error);
                // Continue with DynamoDB deletion even if S3 fails
            }
        }

        // Delete from the table where we found the record
        await docClient.send(new DeleteCommand({
            TableName: foundInTable,
            Key: { id: downloadId }
        }));

        console.log(`[${downloadId}] Download deleted from ${foundInTable} by ${userInfo.email}`);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'Download deleted successfully'
            })
        };

    } catch (error: any) {
        console.error('Delete download error:', error);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: error.message || 'Internal server error'
            })
        };
    }
}
