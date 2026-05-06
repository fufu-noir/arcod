import Image from 'next/image';
import React, { useState, useRef, useCallback, memo } from 'react';
import { AlignJustifyIcon, DotIcon, DownloadIcon, X, Disc3, Headphones, UserIcon, ListMusicIcon, MusicIcon, CheckCircle2, FileArchiveIcon } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { createUnifiedDownloadJob, downloadFromLibrary } from '@/lib/unified-download-job';
import { useDownloadMode } from '@/lib/download-mode-provider';
import { formatDuration, formatTitle, QobuzAlbum, QobuzTrack } from '@/lib/qobuz-dl';
import { motion, AnimatePresence } from 'framer-motion';
import { Skeleton } from './ui/skeleton';
import { useFFmpeg } from '@/lib/ffmpeg-provider';
import { useSettings } from '@/lib/settings-provider';
import { useStatusBar } from '@/lib/status-bar/context';
import { useToast } from '@/hooks/use-toast';
import { useCountry } from '@/lib/country-provider';
import { createPortal } from 'react-dom';
import { useLibrary } from '@/lib/library-provider';
import { useAuth } from '@/components/auth-provider';

export type QobuzPlaylist = {
    id: number | string;
    name: string;
    description?: string;
    tracks_count: number;
    duration: number;
    owner?: { id: number; name: string };
    images?: string[];
    images150?: string[];
    images300?: string[];
    tracks?: { items: QobuzTrack[] };
};

const PlaylistCard = ({
    playlist,
    resolvedTheme,
    ref,
}: {
    playlist: QobuzPlaylist;
    resolvedTheme: string;
    ref?: React.Ref<HTMLDivElement>;
}) => {
    const { settings } = useSettings();
    const { country } = useCountry();
    const { setStatusBar } = useStatusBar();
    const { ffmpegState } = useFFmpeg();
    const { getLibraryItem } = useLibrary();
    const { mode } = useDownloadMode();
    const { user } = useAuth();
    const { toast } = useToast();

    const [isOpen, setIsOpen] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [focusCard, setFocusCard] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [showDownloadOptions, setShowDownloadOptions] = useState(false);
    const cardImageRef = useRef<HTMLDivElement>(null);

    const coverImage = playlist.images300?.[0] || playlist.images150?.[0] || playlist.images?.[0] || null;
    const tracks = playlist.tracks?.items || [];

    const openDetails = useCallback(() => setIsOpen(true), []);
    const closeDetails = useCallback(() => {
        setIsOpen(false);
        setShowDownloadOptions(false);
    }, []);

    // ZIP mode: group tracks by album → one ZIP job per album
    const downloadAsZip = useCallback(async () => {
        setIsDownloading(true);
        const albumsMap = new Map<string, QobuzAlbum>();
        for (const track of tracks) {
            const alb = track.album as QobuzAlbum | undefined;
            if (alb?.id && !albumsMap.has(String(alb.id))) albumsMap.set(String(alb.id), alb);
        }
        for (const album of albumsMap.values()) {
            await createUnifiedDownloadJob(album, setStatusBar, ffmpegState, settings, toast as any, mode, null, undefined, country);
            await new Promise((r) => setTimeout(r, 100));
        }
        toast({ title: `Added '${playlist.name}'`, description: `${albumsMap.size} album ZIP(s) queued` });
        setIsDownloading(false);
        closeDetails();
    }, [tracks, setStatusBar, ffmpegState, settings, toast, mode, country, playlist.name, closeDetails]);

    // No ZIP: one job per track
    const downloadAllTracks = useCallback(async () => {
        setIsDownloading(true);
        for (const track of tracks) {
            if (track.streamable) {
                await createUnifiedDownloadJob(
                    track, setStatusBar, ffmpegState, settings, toast as any, mode, null, undefined, country
                );
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        toast({ title: `Added '${playlist.name}'`, description: 'All playlist tracks added to queue' });
        setIsDownloading(false);
        closeDetails();
    }, [tracks, setStatusBar, ffmpegState, settings, toast, mode, country, playlist.name, closeDetails]);

    return (
        <>
            <div
                className='space-y-3'
                title={playlist.name}
                ref={ref || undefined}
                style={{
                    transform: 'translate3d(0,0,0)',
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                }}
            >
                <div
                    ref={cardImageRef}
                    className='relative w-full aspect-square group select-none rounded-[8px] overflow-hidden card-optimized'
                >
                    {isOpen && <div className='absolute inset-0 bg-secondary/50' />}

                    <div className='absolute inset-0 z-[4] pointer-events-none rounded-[8px] opacity-0 group-hover:opacity-100 transition-opacity duration-200' style={{ background: 'radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.15) 0%, transparent 60%)' }} />

                    {/* Playlist badge */}
                    <div className='absolute top-2 left-2 z-[6] flex items-center gap-1.5 rounded-[4px] border border-primary/35 bg-black/65 px-2.5 py-1 shadow-lg backdrop-blur-md pointer-events-none'>
                        <ListMusicIcon className='h-3.5 w-3.5 text-primary' />
                        <span className='text-[10px] font-bold uppercase tracking-[0.14em] text-primary'>Playlist</span>
                    </div>

                    <div
                        className={cn(
                            `w-full z-[3] top-0 left-0 absolute transition-opacity duration-200 aspect-square opacity-0 group-hover:opacity-100 ${focusCard && 'opacity-100'}`,
                            resolvedTheme != 'light'
                                ? `group-hover:bg-black/60 ${focusCard && 'bg-black/60'}`
                                : `group-hover:bg-white/40 ${focusCard && 'bg-white/40'}`
                        )}
                    >
                        <div className='flex flex-col h-full justify-between p-1'>
                            <div className='space-y-1 p-3 flex justify-between relative overflow-x-hidden bg-black/70 rounded-[4px] m-2'>
                                <div className='w-full'>
                                    <p className='text-sm truncate capitalize font-bold text-white drop-shadow-lg'>
                                        {playlist.owner?.name || 'Playlist'}
                                    </p>
                                    <div className='flex text-[10px] truncate font-bold items-center justify-start text-white/80'>
                                        <p>{playlist.tracks_count} {playlist.tracks_count > 1 ? 'tracks' : 'track'}</p>
                                        <DotIcon size={14} />
                                        <p>{formatDuration(playlist.duration)}</p>
                                    </div>
                                </div>
                            </div>
                            <div className='flex items-center justify-between gap-3 p-2 m-2'>
                                <Button
                                    size='icon'
                                    variant='ghost'
                                    disabled={isDownloading}
                                    className='bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white border border-white/20 shadow-lg hover:scale-110 active:scale-95 transition-all'
                                    onClick={openDetails}
                                >
                                    <DownloadIcon className='w-5 h-5' />
                                </Button>
                                <Button
                                    size='icon'
                                    variant='ghost'
                                    className='bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white border border-white/20 shadow-lg hover:scale-110 active:scale-95 transition-all'
                                    onClick={openDetails}
                                >
                                    <AlignJustifyIcon className='w-5 h-5' />
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Cover */}
                    <div className={cn('absolute left-0 top-0 z-[2] w-full aspect-square')}>
                        {coverImage ? (
                            <Image
                                fill
                                src={coverImage}
                                alt={playlist.name}
                                className={cn(
                                    'object-cover group-hover:scale-110 transition-all duration-500 w-full h-full text-[0px]',
                                    focusCard && 'scale-110',
                                    imageLoaded && 'opacity-100'
                                )}
                                sizes='(min-width: 1536px) calc((100vw - 128px) / 7), (min-width: 1280px) calc((100vw - 96px) / 6), (min-width: 1024px) calc((100vw - 80px) / 5), (min-width: 768px) calc((100vw - 64px) / 4), (min-width: 640px) calc((100vw - 48px) / 3), calc((100vw - 32px) / 2)'
                                onLoad={() => setImageLoaded(true)}
                            />
                        ) : (
                            <div className='flex items-center justify-center bg-secondary w-full h-full'>
                                <ListMusicIcon className='w-1/2 h-1/2 opacity-20' />
                            </div>
                        )}
                    </div>
                    <Skeleton className='absolute left-0 top-0 z-[1] w-full aspect-square flex items-center justify-center' />
                </div>

                {/* Title */}
                <div className='space-y-1.5'>
                    <div className='flex gap-2 items-center'>
                        <h1 className='text-sm truncate font-bold group-hover:text-primary transition-colors'>{playlist.name}</h1>
                    </div>
                    {playlist.owner?.name && (
                        <div
                            className={cn(
                                'text-xs truncate flex gap-x-1 items-center transition-colors',
                                settings.background === 'futuristic'
                                    ? 'text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
                                    : resolvedTheme === 'light'
                                        ? 'text-black/70'
                                        : 'text-white/70'
                            )}
                        >
                            <UserIcon className='size-3.5 shrink-0' />
                            <span className='truncate font-medium'>{playlist.owner.name}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Popup */}
            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {isOpen && (
                        <>
                            <motion.div
                                key='backdrop'
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className='fixed inset-0 bg-black/80 backdrop-blur-xl z-[200]'
                                onClick={closeDetails}
                            >
                                {coverImage && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 1.1 }}
                                        animate={{ opacity: 0.4, scale: 1 }}
                                        exit={{ opacity: 0 }}
                                        className='absolute inset-0 grayscale-[0.5] contrast-[1.1] scale-110 pointer-events-none'
                                        style={{
                                            backgroundImage: `url(${coverImage})`,
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center',
                                            filter: 'blur(80px)',
                                        }}
                                    />
                                )}
                            </motion.div>

                            <motion.div
                                initial={{ y: '100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '100%' }}
                                transition={{ type: 'spring', damping: 30, stiffness: 350, mass: 0.8 }}
                                className='fixed inset-0 z-[201] flex items-end md:items-center justify-center p-0 md:p-4 pointer-events-none'
                            >
                                <div
                                    className='relative w-full max-w-[850px] h-[92vh] md:h-auto md:max-h-[85vh] bg-background/60 backdrop-blur-3xl md:rounded-[2.5rem] rounded-t-[2.5rem] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.5)] border border-white/10 overflow-hidden pointer-events-auto flex flex-col'
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <motion.button
                                        whileHover={{ scale: 1.1, rotate: 90 }}
                                        whileTap={{ scale: 0.9 }}
                                        className='absolute top-4 right-4 z-[210] bg-white/10 hover:bg-white/20 backdrop-blur-xl rounded-full h-10 w-10 flex items-center justify-center border border-white/20 text-white shadow-xl transition-colors'
                                        onClick={closeDetails}
                                    >
                                        <X className='w-5 h-5' />
                                    </motion.button>

                                    <div className='flex-1 overflow-y-auto md:overflow-hidden'>
                                        <div className='flex flex-col md:flex-row h-full'>
                                            {/* LEFT: Hero */}
                                            <div className='w-full md:w-[360px] p-8 pb-4 md:pb-8 flex flex-col items-center md:items-start shrink-0'>
                                                <div className='relative mb-8 pt-4 md:pt-0'>
                                                    <div className='absolute inset-0 blur-3xl bg-primary/30 rounded-full opacity-60 scale-125' />
                                                    <div className='relative z-10 w-[240px] h-[240px] md:w-[280px] md:h-[280px] rounded-[0.5rem] overflow-hidden shadow-2xl border-2 border-white/20'>
                                                        {coverImage ? (
                                                            <img
                                                                src={coverImage}
                                                                alt={playlist.name}
                                                                className='w-full h-full object-cover'
                                                            />
                                                        ) : (
                                                            <div className='w-full h-full flex items-center justify-center bg-secondary'>
                                                                <ListMusicIcon className='w-1/2 h-1/2 opacity-30' />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className='w-full text-center md:text-left'>
                                                    <div className='mb-2'>
                                                        <div className='flex items-center justify-center md:justify-start gap-3 mb-1'>
                                                            <span className='px-1.5 py-0.5 bg-primary rounded-md text-[10px] font-black text-primary-foreground shadow-lg'>PLAYLIST</span>
                                                            <h2 className='text-3xl font-black tracking-tighter leading-none drop-shadow-md text-white'>
                                                                {playlist.name}
                                                            </h2>
                                                        </div>
                                                        {playlist.owner?.name && (
                                                            <p className='text-xl font-bold text-muted-foreground/80 truncate'>by {playlist.owner.name}</p>
                                                        )}
                                                    </div>

                                                    <div className='flex flex-wrap gap-2 justify-center md:justify-start mt-6 mb-4'>
                                                        {[
                                                            { icon: Disc3, text: `${playlist.tracks_count} Tracks` },
                                                            { icon: Headphones, text: formatDuration(playlist.duration) },
                                                        ].map((item, i) => (
                                                            <div
                                                                key={i}
                                                                className='flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-[10px] md:text-xs font-bold text-white/70 shadow-lg'
                                                            >
                                                                <item.icon className='w-3.5 h-3.5 text-primary' />
                                                                {item.text}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* RIGHT: Tracklist */}
                                            <div className='flex-1 p-4 md:p-8 md:pl-0 flex flex-col min-w-0 md:h-[85vh]'>
                                                <div className='bg-black/20 backdrop-blur-xl border border-white/5 rounded-[0.5rem] p-4 md:p-6 flex flex-col h-full overflow-hidden shadow-2xl relative'>
                                                    <div className='flex items-center justify-between mb-4 px-2'>
                                                        <h3 className='text-xs font-black text-white/50 uppercase tracking-widest'>Tracklist</h3>
                                                        <span className='text-[10px] font-bold text-primary bg-primary/20 px-3 py-1 rounded-full'>
                                                            {formatDuration(playlist.duration)} TOTAL
                                                        </span>
                                                    </div>

                                                    <div className='flex-1 overflow-y-visible md:overflow-y-auto pr-0 md:pr-2 custom-scrollbar'>
                                                        <div className='space-y-1'>
                                                            {tracks.map((track: QobuzTrack, idx: number) => {
                                                                const libraryItem = getLibraryItem(track.id, {
                                                                    title: track.title,
                                                                    artistName: track.performer?.name,
                                                                    type: 'track',
                                                                });
                                                                const trackInLibrary = !!libraryItem;

                                                                return (
                                                                    <div
                                                                        key={`${track.id}-${idx}`}
                                                                        onClick={async () => {
                                                                            if (!track.streamable) return;
                                                                            if (trackInLibrary && libraryItem) {
                                                                                const authToken = user && !user.isGuest ? await user.getIdToken() : undefined;
                                                                                await downloadFromLibrary(libraryItem, toast as any, authToken);
                                                                                return;
                                                                            }
                                                                            await createUnifiedDownloadJob(
                                                                                track, setStatusBar, ffmpegState,
                                                                                settings, toast as any, mode,
                                                                                null, undefined, country
                                                                            );
                                                                            toast({ title: 'Added to queue', description: formatTitle(track) });
                                                                        }}
                                                                        className={cn(
                                                                            'group/track relative flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition-all active:scale-[0.98]',
                                                                            trackInLibrary ? 'bg-green-500/10 border border-green-500/20' : 'hover:bg-white/5 border border-transparent'
                                                                        )}
                                                                    >
                                                                        <div className='relative w-6 h-6 flex items-center justify-center shrink-0'>
                                                                            <span className='text-xs text-white/30 font-black text-center group-hover/track:opacity-0 transition-opacity'>
                                                                                {idx + 1}
                                                                            </span>
                                                                            <div className='absolute inset-0 flex items-center justify-center opacity-0 group-hover/track:opacity-100 transition-opacity'>
                                                                                <div className='w-6 h-6 flex items-center justify-center rounded-full bg-primary/20 text-primary'>
                                                                                    <DownloadIcon className='w-3 h-3' />
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        <div className='flex-1 min-w-0'>
                                                                            <div className='flex items-center gap-2'>
                                                                                <p className='text-sm font-bold text-white truncate group-hover/track:text-primary transition-colors'>
                                                                                    {formatTitle(track)}
                                                                                </p>
                                                                                {track.parental_warning && <span className='text-[8px] opacity-60'>E</span>}
                                                                                {trackInLibrary && <CheckCircle2 className='w-3 h-3 text-green-500' />}
                                                                            </div>
                                                                            {track.performer?.name && (
                                                                                <p className='text-[10px] text-white/40 truncate mt-0.5'>{track.performer.name}</p>
                                                                            )}
                                                                        </div>
                                                                        <div className='flex items-center'>
                                                                            <span className='text-[10px] font-black text-white/40 tabular-nums'>
                                                                                {formatDuration(track.duration)}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    <div className='mt-4 pt-4 border-t border-white/10'>
                                                        <div className='flex flex-col gap-2'>
                                                            <div className='flex overflow-hidden h-14'>
                                                                <motion.div
                                                                    className='overflow-hidden h-full shrink-0'
                                                                    animate={{ width: showDownloadOptions ? '50%' : '100%' }}
                                                                    transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                                                                >
                                                                    {!showDownloadOptions ? (
                                                                        <button
                                                                            onClick={() => setShowDownloadOptions(true)}
                                                                            className='w-full h-full rounded-none bg-primary text-primary-foreground font-black text-base hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3'
                                                                        >
                                                                            <DownloadIcon className='w-5 h-5' />
                                                                            DOWNLOAD ALL TRACKS
                                                                        </button>
                                                                    ) : (
                                                                        <Button
                                                                            disabled={isDownloading}
                                                                            onClick={downloadAsZip}
                                                                            className='w-full h-full rounded-none bg-white/10 hover:bg-white/20 border-r border-white/10 text-white font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all group disabled:opacity-50'
                                                                        >
                                                                            <FileArchiveIcon className='w-5 h-5 text-primary group-hover:scale-110 transition-transform' />
                                                                            ZIP ARCHIVE
                                                                        </Button>
                                                                    )}
                                                                </motion.div>
                                                                <motion.div
                                                                    className='overflow-hidden h-full shrink-0'
                                                                    animate={{ width: showDownloadOptions ? '50%' : '0%' }}
                                                                    transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                                                                >
                                                                    <Button
                                                                        disabled={isDownloading}
                                                                        onClick={downloadAllTracks}
                                                                        className='w-full h-full rounded-none bg-white/10 hover:bg-white/20 border-l border-white/10 text-white font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all group disabled:opacity-50'
                                                                    >
                                                                        <MusicIcon className='w-5 h-5 text-primary group-hover:scale-110 transition-transform' />
                                                                        ALL TRACKS
                                                                    </Button>
                                                                </motion.div>
                                                            </div>
                                                            <AnimatePresence>
                                                                {showDownloadOptions && (
                                                                    <motion.button
                                                                        initial={{ opacity: 0, height: 0 }}
                                                                        animate={{ opacity: 1, height: 32 }}
                                                                        exit={{ opacity: 0, height: 0 }}
                                                                        transition={{ duration: 0.2 }}
                                                                        disabled={isDownloading}
                                                                        onClick={() => setShowDownloadOptions(false)}
                                                                        className='text-[10px] font-black text-white/30 hover:text-white/60 transition-colors uppercase tracking-widest overflow-hidden'
                                                                    >
                                                                        Cancel
                                                                    </motion.button>
                                                                )}
                                                            </AnimatePresence>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </>
    );
};

export default memo(PlaylistCard);
