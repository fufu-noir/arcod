'use client';
import { FFmpegType } from './ffmpeg-functions';
import { FetchedQobuzAlbum, QobuzAlbum, QobuzArtistResults, QobuzTrack } from './qobuz-dl';
import { SettingsProps } from './settings-provider';
import { StatusBarProps } from '@/components/status-bar/status-bar';
import { createCloudDownloadJob, downloadArtistDiscographyCloud } from './cloud-download-job';
import { LibraryItem } from './library-provider';

export type DownloadMode = 'cloud';

/**
 * Downloads a file directly from an existing library item.
 * This is used when the user tries to download something already in their library.
 */
export const downloadFromLibrary = async (
    libraryItem: LibraryItem,
    toast: (toast: any) => void
) => {
    if (!libraryItem.url) {
        toast({
            title: 'File unavailable',
            description: 'This file is no longer available for download. It may have been deleted.',
            variant: 'destructive'
        });
        return;
    }

    // Create a download link and trigger it
    const link = document.createElement('a');
    link.href = libraryItem.url;
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

