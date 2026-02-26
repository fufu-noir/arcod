/**
 * V2 Download System types
 */

export interface DownloadJobV2 {
    id: string;
    status: 'pending' | 'processing' | 'downloading' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    description: string;

    // Album/Track info
    albumId: string;
    trackId?: string;

    // Pre-computed metadata
    metadata: {
        title: string;
        artist: string;
        coverUrl: string;
        quality: string;
        trackCount: number;
    };

    // User info
    userId?: string;
    userEmail?: string;
    country?: string;

    // Settings
    settings: {
        quality: number;
        format: string;
        embedLyrics: boolean;
        lyricsMode: string;
    };

    // Results
    downloadUrl?: string;
    fileName?: string;
    fileSize?: number;
    error?: string;

    // Timestamps
    createdAt: string;
    updatedAt: string;
    ttl?: number;
}

export interface CreateJobRequestV2 {
    albumId: string;
    trackId?: string;
    metadata: {
        title: string;
        artist: string;
        coverUrl: string;
        quality: string;
        trackCount: number;
    };
    settings: {
        quality: number;
        format: string;
        embedLyrics: boolean;
        lyricsMode: string;
    };
    country?: string;
}

export interface JobStatusResponseV2 {
    id: string;
    status: string;
    progress: number;
    description: string;
    metadata: {
        title: string;
        artist: string;
        coverUrl: string;
        quality: string;
    };
    downloadUrl?: string;
    fileName?: string;
    fileSize?: number;
    error?: string;
}
