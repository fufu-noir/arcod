'use client';
/**
 * Cloud download job handler (V2 API)
 */
import axios from 'axios';
import { fetchAuthSession } from 'aws-amplify/auth';
import {
    createDownloadV2,
    waitForDownloadV2,
    downloadFile,
    extractAlbumInfoForV2,
    extractTrackInfoForV2,
    type DownloadStatusV2,
    type DownloadRequestV2
} from './download-service-v2';
import { StatusBarProps } from '@/components/status-bar/status-bar';
import { SettingsProps } from './settings-provider';

async function getAuthToken(): Promise<string | undefined> {
    try {
        const session = await fetchAuthSession();
        return session.tokens?.idToken?.toString();
    } catch {
        return undefined;
    }
}

/**
 * Start a cloud download using the V2 API
 */
export async function createCloudDownloadJobV2(
    item: any,
    setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>,
    settings: SettingsProps,
    toast: (toast: any) => void,
    _fetchedAlbumData?: any,
    _setFetchedAlbumData?: any,
    country?: string
): Promise<void> {
    const isTrack = !!item.duration && !item.tracks_count;

    const quality = parseInt(settings.outputQuality || '27', 10);
    const format = settings.outputCodec || 'FLAC';
    const bitrate = settings.bitrate;
    const embedLyrics = settings.embedLyrics !== false;
    const lyricsMode = settings.lyricsMode === 'sidecar' ? 'sidecar' : 'embed';

    try {
        let request: DownloadRequestV2;

        if (isTrack) {
            const trackInfo = extractTrackInfoForV2(item, item.album);
            request = {
                albumId: trackInfo.albumId || '',
                trackId: trackInfo.trackId,
                albumTitle: trackInfo.albumTitle || 'Unknown Album',
                artistName: trackInfo.artistName || 'Unknown Artist',
                artistId: trackInfo.artistId || '',
                coverUrl: trackInfo.coverUrl || '',
                releaseDate: trackInfo.releaseDate,
                tracksCount: 1,
                quality,
                format,
                bitrate,
                embedLyrics,
                lyricsMode,
                zipName: settings.zipName,
                trackName: settings.trackName,
                country
            };
        } else {
            const albumInfo = extractAlbumInfoForV2(item);
            request = {
                albumId: albumInfo.albumId || '',
                albumTitle: albumInfo.albumTitle || 'Unknown Album',
                artistName: albumInfo.artistName || 'Unknown Artist',
                artistId: albumInfo.artistId || '',
                coverUrl: albumInfo.coverUrl || '',
                releaseDate: albumInfo.releaseDate,
                tracksCount: albumInfo.tracksCount || 0,
                quality,
                format,
                bitrate,
                embedLyrics,
                lyricsMode,
                zipName: settings.zipName,
                trackName: settings.trackName,
                country
            };
        }

        setStatusBar(prev => ({
            ...prev,
            open: true,
            processing: true,
            title: `${request.artistName} - ${request.albumTitle}`,
            description: 'Creating job...',
            progress: 0
        }));

        const token = await getAuthToken();
        const { id: jobId } = await createDownloadV2(request, token);

        toast({
            title: 'Download started',
            description: `${request.artistName} - ${request.albumTitle}`
        });

        const finalStatus = await waitForDownloadV2(jobId, (status: DownloadStatusV2) => {
            setStatusBar(prev => ({
                ...prev,
                description: status.description,
                progress: status.progress
            }));
        });

        const isStorageLimitExceeded = finalStatus.error && !finalStatus.downloadUrl && finalStatus.status === 'completed';

        if (finalStatus.downloadUrl && finalStatus.fileName) {
            downloadFile(finalStatus.downloadUrl, finalStatus.fileName);

            setStatusBar(prev => ({
                ...prev,
                description: 'Done!',
                progress: 100,
                processing: false
            }));

            toast({
                title: 'Download complete!',
                description: `${finalStatus.artistName} - ${finalStatus.albumTitle}`
            });
        } else if (isStorageLimitExceeded) {
            setStatusBar(prev => ({
                ...prev,
                description: finalStatus.description || 'Library full',
                progress: 100,
                processing: false
            }));

            toast({
                title: 'Library full',
                description: `Your library has reached the 30 GB limit. The file was not stored. Delete some downloads to free up space.`,
                variant: 'destructive'
            });
        } else {
            setStatusBar(prev => ({
                ...prev,
                description: 'Done!',
                progress: 100,
                processing: false
            }));

            toast({
                title: 'Download complete!',
                description: `${finalStatus.artistName} - ${finalStatus.albumTitle}`
            });
        }

        setTimeout(() => {
            setStatusBar(prev => ({ ...prev, open: false }));
        }, isStorageLimitExceeded ? 5000 : 3000);

    } catch (error: any) {
        const errorMessage = error.message || 'Unknown error';

        setStatusBar(prev => ({
            ...prev,
            description: `Error: ${errorMessage}`,
            progress: 0,
            processing: false
        }));

        toast({
            title: 'Download error',
            description: errorMessage,
            variant: 'destructive'
        });

        setTimeout(() => {
            setStatusBar(prev => ({ ...prev, open: false }));
        }, 5000);
    }
}

/**
 * Download an entire artist discography
 */
export async function downloadArtistDiscographyV2(
    artistId: string,
    artistName: string,
    setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>,
    settings: SettingsProps,
    toast: (toast: any) => void,
    country?: string,
    authToken?: string
): Promise<void> {
    setStatusBar(prev => ({
        ...prev,
        open: true,
        processing: true,
        title: `${artistName} discography`,
        description: 'Fetching albums...',
        progress: 0
    }));

    try {
        const response = await axios.get(`/api/get-artist`, {
            params: { id: artistId },
            headers: country ? { 'token-country': country } : {}
        });

        const artistData = response.data?.data;
        const releases = artistData?.artist?.releases;

        const allAlbums: any[] = [];

        if (releases && typeof releases === 'object') {
            for (const category of ['album', 'epSingle', 'live', 'compilation']) {
                const categoryData = releases[category];
                if (categoryData && Array.isArray(categoryData.items)) {
                    allAlbums.push(...categoryData.items);
                }
            }
        } else if (Array.isArray(releases)) {
            for (const release of releases) {
                if (release && Array.isArray(release.items)) {
                    allAlbums.push(...release.items);
                }
            }
        }

        if (allAlbums.length === 0) {
            toast({
                title: 'No albums found',
                description: `No albums available for ${artistName}`,
                variant: 'destructive'
            });
            setStatusBar(prev => ({ ...prev, open: false, processing: false }));
            return;
        }

        toast({
            title: 'Downloading discography',
            description: `${allAlbums.length} albums found for ${artistName}`
        });

        for (let i = 0; i < allAlbums.length; i++) {
            const album = allAlbums[i];

            setStatusBar(prev => ({
                ...prev,
                title: `${artistName} discography`,
                description: `Album ${i + 1}/${allAlbums.length}: ${album.title || 'Unknown'}`,
                progress: Math.round((i / allAlbums.length) * 100)
            }));

            try {
                await createCloudDownloadJobV2(album, setStatusBar, settings, () => { }, country, authToken);
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (err) {
                console.error(`Failed to download album ${album.id}:`, err);
            }
        }

        setStatusBar(prev => ({
            ...prev,
            description: 'Full discography downloaded!',
            progress: 100,
            processing: false
        }));

        toast({
            title: 'Discography complete!',
            description: `${allAlbums.length} albums by ${artistName} downloaded`
        });

        setTimeout(() => {
            setStatusBar(prev => ({ ...prev, open: false }));
        }, 5000);

    } catch (error: any) {
        console.error('Discography download error:', error);

        toast({
            title: 'Error',
            description: error.message || 'Error downloading discography',
            variant: 'destructive'
        });

        setStatusBar(prev => ({ ...prev, open: false, processing: false }));
    }
}

// Compat aliases
export const createCloudDownloadJob = createCloudDownloadJobV2;
export const downloadArtistDiscographyCloud = downloadArtistDiscographyV2;

export interface StorageInfo {
    usedBytes: number;
    limitBytes: number;
    usedFormatted: string;
    limitFormatted: string;
    percentUsed: number;
    isOverLimit: boolean;
}

/**
 * Fetch library storage info from the backend
 */
export async function getLibraryStorageInfo(): Promise<StorageInfo | null> {
    try {
        const token = await getAuthToken();
        if (!token) return null;

        const response = await axios.get(`${process.env.NEXT_PUBLIC_AWS_API_URL}/v2/storage`, {
            headers: { Authorization: token }
        });

        if (response.data?.success && response.data?.storage) {
            return response.data.storage;
        }
        return null;
    } catch (error) {
        console.error('Error fetching storage info:', error);
        return null;
    }
}
