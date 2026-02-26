/**
 * V2 download job types
 */

export interface DownloadJobV2 {
    // Primary Key
    id: string;

    // User Info
    userId: string;
    userEmail: string;

    // Status
    status: 'pending' | 'processing' | 'downloading' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    description: string;
    error?: string;

    // Album/Track info
    albumId: string;
    trackId?: string;
    albumTitle: string;
    artistName: string;
    artistId: string;
    coverUrl: string;
    releaseDate?: string;
    tracksCount: number;

    // Download settings
    quality: number;
    format: string;
    bitrate?: number;
    embedLyrics: boolean;
    lyricsMode: string;
    zipName?: string;
    trackName?: string;
    source?: 'qobuz' | 'tidal';

    // Output
    fileName?: string;
    fileSize?: number;
    downloadUrl?: string;

    // Metadata
    country?: string;
    createdAt: string;
    updatedAt: string;
    ttl?: number;
}

export interface CreateDownloadRequestV2 {
    albumId: string;
    trackId?: string;
    albumTitle: string;
    artistName: string;
    artistId: string;
    coverUrl: string;
    releaseDate?: string;
    tracksCount: number;
    quality: number;
    format: string;
    bitrate?: number;
    embedLyrics: boolean;
    lyricsMode: string;
    zipName?: string;
    trackName?: string;
    country?: string;
    source?: 'qobuz' | 'tidal';
}

export interface DownloadStatusV2 {
    id: string;
    status: string;
    progress: number;
    description: string;
    error?: string;
    downloadUrl?: string;
    fileName?: string;
    fileSize?: number;
    albumTitle: string;
    artistName: string;
    coverUrl: string;
}
