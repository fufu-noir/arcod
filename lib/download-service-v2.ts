/**
 * Download Service V2 - client-side helpers
 */
import axios from 'axios';

export interface DownloadRequestV2 {
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
    status: 'pending' | 'processing' | 'downloading' | 'completed' | 'failed' | 'cancelled';
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

const activeDownloads = new Set<string>();

/**
 * Create a new download job
 */
export async function createDownloadV2(request: DownloadRequestV2, authToken?: string): Promise<{ id: string }> {
    const key = `${request.albumId}-${request.trackId || 'full'}`;

    if (activeDownloads.has(key)) {
        throw new Error('Download already in progress');
    }

    activeDownloads.add(key);

    try {
        const response = await axios.post('/api/v2/downloads', request, {
            headers: authToken ? { 'Authorization': authToken } : {}
        });
        return { id: response.data.id };
    } finally {
        activeDownloads.delete(key);
    }
}

/**
 * Get current status of a download job
 */
export async function getDownloadStatusV2(jobId: string): Promise<DownloadStatusV2> {
    const response = await axios.get(`/api/v2/downloads/${jobId}`);
    return response.data;
}

/**
 * Poll until download finishes or fails. Times out after ~10 min.
 */
export async function waitForDownloadV2(
    jobId: string,
    onProgress?: (status: DownloadStatusV2) => void,
    signal?: AbortSignal
): Promise<DownloadStatusV2> {
    const pollInterval = 2000;
    const maxAttempts = 300;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (signal?.aborted) {
            throw new Error('Cancelled');
        }

        try {
            const status = await getDownloadStatusV2(jobId);

            if (onProgress) {
                onProgress(status);
            }

            if (status.status === 'completed') {
                return status;
            }

            if (status.status === 'failed' || status.status === 'cancelled') {
                throw new Error(status.error || `Download ${status.status}`);
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));

        } catch (err: any) {
            if (err.message === 'Cancelled') throw err;
            console.error('Poll error:', err);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
    }

    throw new Error('Download timed out');
}

/**
 * Trigger a file download in the browser
 */
export function downloadFile(url: string, fileName: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => document.body.removeChild(link), 100);
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Extract album info from a Qobuz album object
 */
export function extractAlbumInfoForV2(album: any): Partial<DownloadRequestV2> {
    return {
        albumId: String(album?.id || ''),
        albumTitle: album?.title || 'Unknown Album',
        artistName: album?.artist?.name || album?.performer?.name || 'Unknown Artist',
        artistId: String(album?.artist?.id || album?.performer?.id || ''),
        coverUrl: album?.image?.large || album?.image?.small || album?.image?.thumbnail || '',
        releaseDate: album?.release_date_original || album?.released_at,
        tracksCount: album?.tracks_count || 0
    };
}

/**
 * Extract track info from a Qobuz track object
 */
export function extractTrackInfoForV2(track: any, album: any): Partial<DownloadRequestV2> {
    return {
        albumId: String(album?.id || track?.album?.id || ''),
        trackId: String(track?.id || ''),
        albumTitle: album?.title || track?.album?.title || 'Unknown Album',
        artistName: track?.performer?.name || album?.artist?.name || 'Unknown Artist',
        artistId: String(track?.performer?.id || album?.artist?.id || ''),
        coverUrl: album?.image?.large || album?.image?.small || track?.album?.image?.large || '',
        releaseDate: album?.release_date_original,
        tracksCount: 1
    };
}
