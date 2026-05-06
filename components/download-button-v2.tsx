'use client';
/**
 * Download button using V2 API
 */
import React, { useState } from 'react';
import { Button } from './ui/button';
import { DownloadIcon, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { useSettings } from '@/lib/settings-provider';
import { useCountry } from '@/lib/country-provider';
import { useAuth } from '@/components/auth-provider';

import {
    createDownloadV2,
    getDownloadUrlV2,
    waitForDownloadV2,
    downloadFile,
    extractAlbumInfoForV2,
    extractTrackInfoForV2,
    type DownloadStatusV2
} from '@/lib/download-service-v2';

interface DownloadButtonV2Props {
    // Either pass album data or explicit fields
    album?: any;
    track?: any;
    // Or explicit fields
    albumId?: string;
    trackId?: string;
    albumTitle?: string;
    artistName?: string;
    artistId?: string;
    coverUrl?: string;
    tracksCount?: number;
    releaseDate?: string;
    // UI
    className?: string;
    variant?: 'ghost' | 'default' | 'outline';
    size?: 'icon' | 'sm' | 'default';
    showText?: boolean;
    // Callbacks
    onSuccess?: (downloadUrl: string, fileName: string) => void;
    onError?: (error: string) => void;
    toast: (toast: any) => void;
}

export function DownloadButtonV2({
    album,
    track,
    albumId,
    trackId,
    albumTitle,
    artistName,
    artistId,
    coverUrl,
    tracksCount,
    releaseDate,
    className,
    variant = 'ghost',
    size = 'icon',
    showText = false,
    onSuccess,
    onError,
    toast
}: DownloadButtonV2Props) {
    const [status, setStatus] = useState<'idle' | 'pending' | 'downloading' | 'completed' | 'error'>('idle');
    const [progress, setProgress] = useState(0);
    const { settings } = useSettings();
    const { country } = useCountry();
    const { user, isGuest, refreshGuestRateLimit } = useAuth();


    const handleDownload = async () => {
        if (status !== 'idle') return;

        setStatus('pending');
        setProgress(0);

        try {
            // Guest users are locked to MP3 320kbps
            const effectiveFormat = isGuest ? 'MP3' : (settings.outputCodec || 'FLAC');
            const effectiveQuality = isGuest ? 5 : (parseInt(settings.outputQuality) || 27);

            // Extract info from album/track objects or use explicit props
            let downloadRequest;

            if (track) {
                downloadRequest = {
                    ...extractTrackInfoForV2(track, album || track.album),
                    quality: effectiveQuality,
                    format: effectiveFormat,
                    embedLyrics: settings.embedLyrics !== false,
                    lyricsMode: settings.lyricsMode === 'sidecar' ? 'sidecar' : 'embed',
                    downloadBooklet: settings.downloadBooklet !== false,
                    attachCover: settings.attachCover !== false,
                    country,

                };
            } else if (album) {
                downloadRequest = {
                    ...extractAlbumInfoForV2(album),
                    quality: effectiveQuality,
                    format: effectiveFormat,
                    embedLyrics: settings.embedLyrics !== false,
                    lyricsMode: settings.lyricsMode === 'sidecar' ? 'sidecar' : 'embed',
                    downloadBooklet: settings.downloadBooklet !== false,
                    attachCover: settings.attachCover !== false,
                    country,

                };
            } else {
                // Use explicit props
                downloadRequest = {
                    albumId: albumId || '',
                    trackId,
                    albumTitle: albumTitle || 'Unknown Album',
                    artistName: artistName || 'Unknown Artist',
                    artistId: artistId || '',
                    coverUrl: coverUrl || '',
                    tracksCount: tracksCount || 0,
                    releaseDate,
                    quality: effectiveQuality,
                    format: effectiveFormat,
                    embedLyrics: settings.embedLyrics !== false,
                    lyricsMode: settings.lyricsMode === 'sidecar' ? 'sidecar' : 'embed',
                    downloadBooklet: settings.downloadBooklet !== false,
                    attachCover: settings.attachCover !== false,
                    country,

                };
            }

            // Create download job with auth token (empty for guest mode)
            const authToken = user && !isGuest ? await user.getIdToken() : undefined;

            // Create download job
            const { id: jobId, accessToken } = await createDownloadV2(downloadRequest, authToken);

            // Refresh guest rate limit immediately after download is initiated
            if (isGuest) {
                refreshGuestRateLimit();
            }

            toast({
                title: 'Download started',
                description: `${downloadRequest.artistName} - ${downloadRequest.albumTitle}`
            });

            setStatus('downloading');

            // Poll for completion
            const finalStatus = await waitForDownloadV2(
                jobId,
                (statusUpdate: DownloadStatusV2) => {
                    setProgress(statusUpdate.progress);
                    setDescription(statusUpdate.description);
                },
                undefined,
                {
                    authToken,
                    accessToken
                }
            );

            setStatus('completed');

            let resolvedDownloadUrl = finalStatus.downloadUrl;

            // Always fetch a fresh presigned URL from the server
            if (finalStatus.fileName) {
                try {
                    const freshUrl = await getDownloadUrlV2(jobId, {
                        authToken,
                        accessToken
                    });
                    resolvedDownloadUrl = freshUrl.downloadUrl;
                } catch (err) {
                    console.warn('[Download] Failed to get presigned URL, using raw URL:', err);
                }
            }

            // Auto-download the file
            if (resolvedDownloadUrl && finalStatus.fileName) {
                downloadFile(resolvedDownloadUrl, finalStatus.fileName);
            }

            toast({
                title: 'Download complete!',
                description: `${finalStatus.artistName} - ${finalStatus.albumTitle}`
            });

            onSuccess?.(resolvedDownloadUrl || '', finalStatus.fileName || '');

            // Reset after 3 seconds
            setTimeout(() => {
                setStatus('idle');
                setProgress(0);
                setDescription('');
            }, 3000);

        } catch (error: any) {
            console.error('Download error:', error);
            setStatus('error');
            setDescription('Error');

            // Handle rate limit error specially for guests
            const isRateLimited = error.response?.status === 429;
            let errorMessage: string;

            if (isRateLimited) {
                errorMessage = error.response?.data?.message || 'Download limit reached. Create a free account to continue!';
                // Refresh guest rate limit to show updated counter
                if (isGuest) {
                    refreshGuestRateLimit();
                }
            } else {
                errorMessage = error.response?.data?.error || error.message || 'Unknown error';
            }

            toast({
                title: isRateLimited ? 'Limit reached' : 'Download error',
                description: errorMessage,
                variant: 'destructive'
            });

            onError?.(errorMessage);

            // Reset after 3 seconds
            setTimeout(() => {
                setStatus('idle');
                setProgress(0);
                setDescription('');
            }, 3000);
        }
    };

    const getIcon = () => {
        switch (status) {
            case 'pending':
            case 'downloading':
                return <Loader2 className="w-4 h-4 animate-spin" />;
            case 'completed':
                return <CheckCircle2 className="w-4 h-4 text-green-500" />;
            case 'error':
                return <AlertCircle className="w-4 h-4 text-red-500" />;
            default:
                return <DownloadIcon className="w-4 h-4" />;
        }
    };

    const getText = () => {
        switch (status) {
            case 'pending':
                return 'Initializing...';
            case 'downloading':
                return `${progress}%`;
            case 'completed':
                return 'Done!';
            case 'error':
                return 'Error';
            default:
                return 'Download';
        }
    };

    return (
        <Button
            className={className}
            onClick={handleDownload}
            disabled={status !== 'idle'}
            variant={variant}
            size={size}
        >
            {getIcon()}
            {showText && <span className="ml-2">{getText()}</span>}
            {status === 'downloading' && progress > 0 && (
                <span className="absolute bottom-0 left-0 right-0 h-1 bg-primary/30 rounded-full overflow-hidden">
                    <span
                        className="h-full bg-primary transition-all duration-300 block"
                        style={{ width: `${progress}%` }}
                    />
                </span>
            )}
        </Button>
    );
}

export default DownloadButtonV2;
