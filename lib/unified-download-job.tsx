'use client';
import { FFmpegType } from './ffmpeg-functions';
import { FetchedQobuzAlbum, QobuzAlbum, QobuzArtistResults, QobuzTrack } from './qobuz-dl';
import { SettingsProps } from './settings-provider';
import { StatusBarProps } from '@/components/status-bar/status-bar';
import { createCloudDownloadJob, downloadArtistDiscographyCloud } from './cloud-download-job';
import { LibraryItem } from './library-provider';
import { getDownloadUrlV2, createDownloadV2 } from './download-service-v2';

export type DownloadMode = 'cloud';

/**
 * Downloads a file directly from an existing library item.
 * If the file has expired (410), automatically re-queues the job.
 */
export const downloadFromLibrary = async (
    libraryItem: LibraryItem,
    toast: (toast: any) => void,
    authToken?: string
) => {
    let downloadUrl = libraryItem.url;

    if (!downloadUrl && authToken) {
        try {
            const freshUrl = await getDownloadUrlV2(libraryItem.id, { authToken });
            downloadUrl = freshUrl.downloadUrl;
        } catch (error: any) {
            const status = error?.response?.status;
            const data = error?.response?.data;

            // File expired — re-queue automatically using info from the 410 response
            if (status === 410 && data?.albumId) {
                try {
                    await createDownloadV2({
                        albumId: data.albumId,
                        trackId: data.trackId || undefined,
                        albumTitle: data.albumTitle || libraryItem.metadata.albumTitle || libraryItem.metadata.title,
                        artistName: data.artistName || libraryItem.metadata.artistName,
                        artistId: String(libraryItem.metadata.artistId || ''),
                        coverUrl: data.coverUrl || libraryItem.metadata.image || '',
                        tracksCount: 0,
                        quality: data.quality ?? 27,
                        format: data.format ?? 'FLAC',
                        embedLyrics: true,
                        lyricsMode: 'embed',
                    }, authToken);
                    toast({
                        title: 'Re-queued',
                        description: 'File had expired — re-downloading now. Check your downloads.',
                    });
                } catch (requeue: any) {
                    console.warn('[Library] Re-queue failed:', requeue);
                    toast({
                        title: 'File unavailable',
                        description: 'This file has expired. Please download it again from search.',
                        variant: 'destructive'
                    });
                }
                return;
            }
            console.warn('[Library] Failed to resolve signed URL:', error);
        }
    }

    if (!downloadUrl) {
        toast({
            title: 'File unavailable',
            description: 'This file is no longer available for download. It may have been deleted.',
            variant: 'destructive'
        });
        return;
    }

    // Create a download link and trigger it
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = libraryItem.fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        document.body.removeChild(link);
    }, 100);

    toast({
        title: 'Downloaded from Library',
        description: `${libraryItem.metadata.title} was already in your library and has been downloaded.`
    });
};

export const createUnifiedDownloadJob = async (
    result: QobuzAlbum | QobuzTrack,
    setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>,
    ffmpegState: FFmpegType,
    settings: SettingsProps,
    toast: (toast: any) => void,
    mode: DownloadMode,
    fetchedAlbumData?: FetchedQobuzAlbum | null,
    setFetchedAlbumData?: React.Dispatch<React.SetStateAction<FetchedQobuzAlbum | null>>,
    country?: string
) => {
    // Cloud only - no local fallback
    return createCloudDownloadJob(
        result,
        setStatusBar,
        settings,
        toast,
        fetchedAlbumData,
        setFetchedAlbumData,
        country
    );
};

export async function downloadArtistDiscographyUnified(
    artistResults: QobuzArtistResults,
    setArtistResults: React.Dispatch<React.SetStateAction<QobuzArtistResults | null>>,
    fetchMore: (searchField: any, artistResults: QobuzArtistResults) => Promise<void>,
    type: 'album' | 'epSingle' | 'live' | 'compilation' | 'all',
    setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>,
    settings: SettingsProps,
    toast: (toast: any) => void,
    ffmpegState: FFmpegType,
    mode: DownloadMode,
    country?: string
) {
    // Cloud only - no local fallback
    return downloadArtistDiscographyCloud(
        artistResults,
        setArtistResults,
        fetchMore,
        type,
        setStatusBar,
        settings,
        toast,
        country
    );
}
