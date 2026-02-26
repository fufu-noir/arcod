import React, { useEffect, useState, useMemo } from 'react';
import { Button, ButtonProps } from './ui/button';
import { DownloadIcon, FileArchiveIcon, MusicIcon, CheckCircle2 } from 'lucide-react';
import { StatusBarProps } from './status-bar/status-bar';
import { FFmpegType } from '@/lib/ffmpeg-functions';
import { SettingsProps } from '@/lib/settings-provider';
import { FetchedQobuzAlbum, formatTitle, getFullAlbumInfo, QobuzAlbum } from '@/lib/qobuz-dl';
import { createUnifiedDownloadJob, downloadFromLibrary } from '@/lib/unified-download-job';
import { useDownloadMode } from '@/lib/download-mode-provider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useCountry } from '@/lib/country-provider';
import { useLibrary } from '@/lib/library-provider';
import { cn } from '@/lib/utils';

export interface DownloadAlbumButtonProps extends ButtonProps {
    result: QobuzAlbum;
    setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>;
    ffmpegState: FFmpegType;
    settings: SettingsProps;
    fetchedAlbumData: FetchedQobuzAlbum | null;
    setFetchedAlbumData: React.Dispatch<React.SetStateAction<FetchedQobuzAlbum | null>>;
    onOpen?: () => void;
    onClose?: () => void;
    toast: (toast: any) => void;
}

const DownloadButton = React.forwardRef<HTMLButtonElement, DownloadAlbumButtonProps>(
    (
        {
            className,
            variant,
            size,
            asChild = false,
            onOpen,
            onClose,
            result,
            setStatusBar,
            ffmpegState,
            settings,
            toast,
            fetchedAlbumData,
            setFetchedAlbumData,
            ...props
        },
        ref
    ) => {
        const { country } = useCountry();
        const { mode } = useDownloadMode();
        const { isInLibrary, getLibraryItem } = useLibrary();
        const [open, setOpen] = useState(false);

        // Check if album is in library
        const inLibrary = useMemo(() => isInLibrary(result.id), [result.id, isInLibrary]);

        useEffect(() => {
            if (open) onOpen?.();
            else onClose?.();
        }, [open]);

        // If in library, show a different button that downloads directly
        if (inLibrary) {
            return (
                <Button
                    className={cn(
                        className,
                        'bg-green-500/30 hover:bg-green-500/50 border-green-400/40'
                    )}
                    ref={ref}
                    variant={variant}
                    size={size}
                    asChild={asChild}
                    onClick={async () => {
                        const libraryItem = getLibraryItem(result.id);
                        if (libraryItem) {
                            await downloadFromLibrary(libraryItem, toast);
                        }
                    }}
                    {...props}
                >
                    <CheckCircle2 className='!size-4' />
                </Button>
            );
        }

        return (
            <>
                <DropdownMenu open={open} onOpenChange={setOpen}>
                    <DropdownMenuTrigger asChild>
                        <Button className={className} ref={ref} variant={variant} size={size} asChild={asChild} {...props}>
                            <DownloadIcon className='!size-4' />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem
                            onClick={() => {
                                createUnifiedDownloadJob(result, setStatusBar, ffmpegState, settings, toast, mode, fetchedAlbumData, setFetchedAlbumData, country);
                                toast({
                                    title: `Added '${formatTitle(result)}'`,
                                    description: 'The album has been added to the queue'
                                });
                            }}
                            className='flex items-center gap-2'
                        >
                            <FileArchiveIcon className='!size-4' />
                            <p>ZIP Archive</p>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={async () => {
                                const albumData = await getFullAlbumInfo(fetchedAlbumData, setFetchedAlbumData, result, country);
                                if (!albumData?.tracks?.items) {
                                    toast({ title: 'Error', description: 'Could not load album tracks. Please try again.', variant: 'destructive' });
                                    return;
                                }
                                for (const track of (albumData?.tracks?.items || [])) {
                                    if (track.streamable) {
                                        await createUnifiedDownloadJob(
                                            { ...track, album: albumData },
                                            setStatusBar,
                                            ffmpegState,
                                            settings,
                                            toast,
                                            mode,
                                            albumData,
                                            setFetchedAlbumData,
                                            country
                                        );
                                        await new Promise((resolve) => setTimeout(resolve, 100));
                                    }
                                }
                                toast({
                                    title: `Added '${formatTitle(result)}'`,
                                    description: 'The album has been added to the queue'
                                });
                            }}
                            className='flex items-center gap-2'
                        >
                            <MusicIcon className='!size-4' />
                            <p>No ZIP Archive</p>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </>
        );
    }
);
DownloadButton.displayName = 'DownloadAlbumButton';

export default DownloadButton;

