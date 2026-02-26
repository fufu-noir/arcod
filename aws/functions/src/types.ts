/**
 * Shared types for AWS Lambda functions
 */

export interface DownloadSettings {
    quality: number;
    format: string;
    embedLyrics?: boolean;
    lyricsMode?: 'embedded' | 'sidecar';
    bitrate?: number;
}

export interface DownloadJob {
    id: string;
    type: 'album' | 'track';
    status: 'pending' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    description: string;
    createdAt: string;
    updatedAt: string;
    settings: DownloadSettings;
    albumId: string;
    albumTitle?: string;
    artistName?: string;
    trackCount?: number;
    trackId?: string | number | null;
    downloadUrl?: string;
    fileName?: string;
    fileSize?: number;
    error?: string;
    userId?: string | null;
    userEmail?: string | null;
    region?: string;
    regionName?: string;
    albumInfo?: string;
    country?: string;
    logId?: string; // ID of the entry in DownloadLogsTable
    jobId?: string; // Reference to Job ID (for logs)
    ttl?: number; // DynamoDB TTL
}

export interface TrackInfo {
    id: number;
    title: string;
    version?: string | null;
    track_number: number;
    media_number: number;
    duration: number;
    performer?: { name: string };
    streamable?: boolean;
}

export interface AlbumInfo {
    id: string;
    title: string;
    artist?: { name: string };
    tracks: { items: TrackInfo[] };
    image?: { large?: string; small?: string };
    genre?: { name: string };
    label?: { name: string };
    release_date_original?: string;
    tracks_count?: number;
    media_count?: number;
    upc?: string;
    copyright?: string;
}

export interface APIGatewayEvent {
    httpMethod: string;
    path: string;
    pathParameters?: Record<string, string>;
    queryStringParameters?: Record<string, string>;
    headers: Record<string, string | undefined>;
    body?: string;
    requestContext?: {
        identity?: {
            sourceIp?: string;
        };
    };
}

export interface APIGatewayResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
}

export interface DynamoDBStreamEvent {
    Records: Array<{
        eventID: string;
        eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
        dynamodb: {
            Keys: Record<string, any>;
            NewImage?: Record<string, any>;
            OldImage?: Record<string, any>;
        };
    }>;
}

// CORS headers for API Gateway responses
export const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Forwarded-For,token-country'
};
