'use client';
/**
 * Cloud download job handler (V2 API)
 */
import axios from 'axios';
import { supabase } from '@/lib/supabase-config';
import {
    createDownloadV2,
    getDownloadUrlV2,
    waitForDownloadV2,
    downloadFile,
    extractAlbumInfoForV2,
    extractTrackInfoForV2,
    type DownloadStatusV2,
    type DownloadRequestV2
} from './download-service-v2';
import { StatusBarProps } from '@/components/status-bar/status-bar';
import { SettingsProps } from './settings-provider';
import type { QobuzAlbum, QobuzArtistResults } from './qobuz-dl';

type ArtistReleaseType = 'album' | 'epSingle' | 'live' | 'compilation';

async function getAuthToken(): Promise<string | undefined> {
    try {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token || undefined;
    } catch {
        return undefined;
    }
}

async function loadArtistResultsState(
    setArtistResults: React.Dispatch<React.SetStateAction<QobuzArtistResults | null>>
): Promise<QobuzArtistResults | null> {
    return new Promise((resolve) => {
        setArtistResults((prev) => {
            resolve(prev);
            return prev;
        });
    });
}

function getArtistDisplayName(artistResults: QobuzArtistResults): string {
    const rawName = artistResults.artist?.name;
    if (typeof rawName === 'string') return rawName;
    return rawName?.display || 'Unknown Artist';
}

function dedupeAlbums(albums: QobuzAlbum[]): QobuzAlbum[] {
    const seen = new Set<string>();
    const unique: QobuzAlbum[] = [];

    for (const album of albums) {
        const id = String(album.id || album.qobuz_id || album.upc || `${album.artist?.name}-${album.title}`);
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(album);
    }

    return unique;
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
    const downloadBooklet = settings.downloadBooklet !== false;
    const attachCover = settings.attachCover !== false;

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
                downloadBooklet,
                attachCover,
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
                downloadBooklet,
                attachCover,
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
        const { id: jobId, accessToken } = await createDownloadV2(request, token);

        toast({
            title: 'Download started',
            description: `${request.artistName} - ${request.albumTitle}`
        });

        const finalStatus = await waitForDownloadV2(
            jobId,
            (status: DownloadStatusV2) => {
                setStatusBar(prev => ({
                    ...prev,
                    description: status.description,
                    progress: status.progress
                }));
            },
            undefined,
            {
                authToken: token,
                accessToken
            }
        );

        let resolvedDownloadUrl = finalStatus.downloadUrl;

        // Always fetch a fresh presigned URL from the server
        if (finalStatus.fileName) {
            try {
                const freshUrl = await getDownloadUrlV2(jobId, {
                    authToken: token,
                    accessToken
                });
                resolvedDownloadUrl = freshUrl.downloadUrl;
            } catch (err: any) {
                if (err?.response?.status === 410) {
                    throw new Error('File expired on storage. Please start the download again.');
                }
                console.warn('[Download] Failed to get presigned URL, using raw URL:', err);
            }
        }

        if (resolvedDownloadUrl && finalStatus.fileName) {
            downloadFile(resolvedDownloadUrl, finalStatus.fileName);
        }

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

        setTimeout(() => {
            setStatusBar(prev => ({ ...prev, open: false }));
        }, 3000);

    } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error';

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
            params: { artist_id: artistId },
            headers: country ? { 'Token-Country': country } : {}
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
                await createCloudDownloadJobV2(album, setStatusBar, settings, () => { }, undefined, undefined, country);
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

export async function downloadArtistDiscographyCloud(
    artistResults: QobuzArtistResults,
    setArtistResults: React.Dispatch<React.SetStateAction<QobuzArtistResults | null>>,
    fetchMore: (searchField: ArtistReleaseType, artistResults: QobuzArtistResults) => Promise<void>,
    type: ArtistReleaseType | 'all',
    setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>,
    settings: SettingsProps,
    toast: (toast: any) => void,
    country?: string
): Promise<void> {
    const artistName = getArtistDisplayName(artistResults);
    const categories: ArtistReleaseType[] = type === 'all'
        ? ['album', 'epSingle', 'live', 'compilation']
        : [type];

    setStatusBar(prev => ({
        ...prev,
        open: true,
        processing: true,
        title: `${artistName} discography`,
        description: 'Fetching releases...',
        progress: 0
    }));

    try {
        let latestResults = artistResults;
        const releases: QobuzAlbum[] = [];

        for (const category of categories) {
            while (latestResults.artist?.releases?.[category]?.has_more) {
                await fetchMore(category, latestResults);
                latestResults = (await loadArtistResultsState(setArtistResults)) || latestResults;
            }

            releases.push(...(latestResults.artist?.releases?.[category]?.items || []));
        }

        const albums = dedupeAlbums(releases);

        if (albums.length === 0) {
            toast({
                title: 'No releases found',
                description: `No downloadable releases found for ${artistName}`,
                variant: 'destructive'
            });
            setStatusBar(prev => ({ ...prev, open: false, processing: false }));
            return;
        }

        toast({
            title: 'Downloading discography',
            description: `${albums.length} releases found for ${artistName}`
        });

        for (let i = 0; i < albums.length; i++) {
            const album = albums[i];
            const albumTitle = typeof album.title === 'object' ? JSON.stringify(album.title) : album.title;

            setStatusBar(prev => ({
                ...prev,
                open: true,
                processing: true,
                title: `${artistName} discography`,
                description: `Release ${i + 1}/${albums.length}: ${albumTitle || 'Unknown'}`,
                progress: Math.round((i / albums.length) * 100)
            }));

            await createCloudDownloadJobV2(
                album,
                setStatusBar,
                settings,
                () => { },
                undefined,
                undefined,
                country
            );

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        setStatusBar(prev => ({
            ...prev,
            description: 'Discography complete!',
            progress: 100,
            processing: false
        }));

        toast({
            title: 'Discography complete!',
            description: `${albums.length} releases by ${artistName} downloaded`
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
