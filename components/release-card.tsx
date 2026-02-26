import ArtistDialog from './artist-dialog';
import DownloadAlbumButton from './download-album-button';
import Image from 'next/image';
import React, { useState, useRef, useCallback, memo } from 'react';
import { AlignJustifyIcon, DotIcon, DownloadIcon, UsersIcon, DiscAlbumIcon, X, Disc3, CalendarDays, Headphones, Tag, CheckCircle2, FileArchiveIcon, MusicIcon } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { createUnifiedDownloadJob, downloadFromLibrary } from '@/lib/unified-download-job';
import { useDownloadMode } from '@/lib/download-mode-provider';
import {
    FetchedQobuzAlbum,
    formatArtists,
    formatDuration,
    formatTitle,
    getAlbum,
    getFullAlbumInfo,
    getType,
    QobuzAlbum,
    QobuzArtist,
    QobuzTrack
} from '@/lib/qobuz-dl';
import { filterData } from '@/app/search-view';
import { motion, AnimatePresence } from 'motion/react';
import { Skeleton } from './ui/skeleton';
import { useFFmpeg } from '@/lib/ffmpeg-provider';
import { useSettings } from '@/lib/settings-provider';
import { useStatusBar } from '@/lib/status-bar/context';
import { useToast } from '@/hooks/use-toast';
import { useCountry } from '@/lib/country-provider';
import { createPortal } from 'react-dom';
import { useLibrary } from '@/lib/library-provider';



const ReleaseCard = ({
    result,
    resolvedTheme,
    ref,
    showArtistDialog
}: {
    result: QobuzAlbum | QobuzTrack | QobuzArtist;
    resolvedTheme: string;
    ref?: React.Ref<HTMLDivElement>;
    showArtistDialog?: boolean;
}) => {
    if (typeof showArtistDialog === 'undefined') showArtistDialog = true;

    // ONLY essential hooks for initial render - others loaded on demand
    const { settings } = useSettings();
    const { country } = useCountry();

    // Minimal state for card display
    const [isOpen, setIsOpen] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [openArtistDialog, setOpenArtistDialog] = useState(false);

    // These are only needed when popup is open - defer initialization
    const [fetchedAlbumData, setFetchedAlbumData] = useState<FetchedQobuzAlbum | null>(null);
    const [showDownloadOptions, setShowDownloadOptions] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [focusCard, setFocusCard] = useState(false);
    const cardImageRef = useRef<HTMLDivElement>(null);

    const { setStatusBar } = useStatusBar();
    const { ffmpegState } = useFFmpeg();
    const { getLibraryItem } = useLibrary();
    const { mode } = useDownloadMode();

    const libraryItem = getLibraryItem(result.id);
    const inLibrary = !!libraryItem;

    const openDetails = useCallback(async () => {
        setIsOpen(true);
        await getFullAlbumInfo(fetchedAlbumData, setFetchedAlbumData, result as QobuzAlbum, country);
    }, [fetchedAlbumData, result, country]);

    // Simple close details
    const closeDetails = useCallback(() => {
        setIsOpen(false);
        setShowDownloadOptions(false);
        setIsDownloading(false);
    }, []);

    const { toast } = useToast();

    const album = getAlbum(result) || null;
    const artist = (result as QobuzAlbum).artist ?? (result as QobuzTrack).performer ?? (result as QobuzTrack).composer;

    return (
        <>
            <div
                className='space-y-3'
                title={formatTitle(result)}
                ref={ref || undefined}
                style={{
                    transform: 'translate3d(0,0,0)',
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden'
                }}
            >
                <div
                    ref={cardImageRef}
                    className='relative w-full aspect-square group select-none rounded-[8px] overflow-hidden card-optimized'
                >
                    {/* Background layer when popup is open */}
                    {isOpen && <div className="absolute inset-0 bg-secondary/50" />}

                    {/* Hover overlay - pure CSS, no JS state */}
                    <div className='absolute inset-0 z-[4] pointer-events-none rounded-[8px] opacity-0 group-hover:opacity-100 transition-opacity duration-200' style={{ background: 'radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.15) 0%, transparent 60%)' }} />

                    {/* "In Library" badge indicator */}
                    {inLibrary && (
                        <div className='absolute top-2 right-2 z-[6] flex items-center gap-1 px-2 py-1 bg-green-600 rounded-[4px] shadow-lg pointer-events-none'>
                            <CheckCircle2 className='w-3 h-3 text-white' />
                            <span className='text-[10px] font-bold text-white uppercase tracking-wide'>In Library</span>
                        </div>
                    )}
                    <div
                        className={cn(
                            `w-full z-[3] top-0 left-0 absolute transition-opacity duration-200 aspect-square opacity-0 group-hover:opacity-100 ${focusCard && 'opacity-100'}`,
                            resolvedTheme != 'light'
                                ? `group-hover:bg-black/60 ${focusCard && 'bg-black/60'}`
                                : `group-hover:bg-white/40 ${focusCard && 'bg-white/40'}`
                        )}
                        onClick={() => {
                            if (getType(result) === 'artists') setOpenArtistDialog(true);
                        }}
                    >
                        <div className='flex flex-col h-full justify-between p-1'>
                            {/* Info box - border-radius = cover radius (8px) - parent padding (4px) = 4px */}
                            <div className='space-y-1 p-3 flex justify-between relative overflow-x-hidden bg-black/70 rounded-[4px] m-2'>
                                <div className='w-full pr-9'>
                                    <p className='text-sm truncate capitalize font-bold text-white drop-shadow-lg'>
                                        {!(getType(result) === 'artists') ? album.genre.name : (result as QobuzArtist).albums_count + ' Releases'}
                                    </p>
                                    {!(getType(result) === 'artists') && (
                                        <p className='text-xs truncate capitalize font-semibold text-white/90'>{new Date(album.released_at * 1000).getFullYear()}</p>
                                    )}
                                    {!(getType(result) === 'artists') && (
                                        <div className='flex text-[10px] truncate font-bold items-center justify-start text-white/80'>
                                            <p>{(result as QobuzAlbum | QobuzTrack).maximum_bit_depth}-bit</p>
                                            <DotIcon size={14} />
                                            <p>{(result as QobuzAlbum | QobuzTrack).maximum_sampling_rate} kHz</p>
                                        </div>
                                    )}
                                    <div className='flex text-[10px] truncate font-bold items-center justify-start text-white/80'>
                                        {(result as QobuzAlbum).tracks_count ? (
                                            <>
                                                <p>
                                                    {(result as QobuzAlbum).tracks_count} {(result as QobuzAlbum).tracks_count > 1 ? 'tracks' : 'track'}
                                                </p>
                                                <DotIcon size={14} />
                                            </>
                                        ) : null}
                                        {!(getType(result) === 'artists') && <p>{formatDuration((result as QobuzAlbum | QobuzTrack).duration)}</p>}
                                    </div>
                                </div>
                                {getType(result) !== 'artists' && showArtistDialog && (
                                    <div className='absolute top-0 right-0 p-3'>
                                        <Button
                                            size='icon'
                                            variant='ghost'
                                            className='aspect-square bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white border border-white/20'
                                            onClick={async () => {
                                                setOpenArtistDialog(true);
                                            }}
                                        >
                                            <UsersIcon className='w-4 h-4' />
                                        </Button>
                                    </div>
                                )}
                            </div>
                            {!(getType(result) === 'artists') && (
                                <div className='flex items-center justify-between gap-3 p-2 m-2'>
                                    {(result as QobuzTrack).album ? (
                                        <>
                                            <Button
                                                size='icon'
                                                variant='ghost'
                                                disabled={isDownloading}
                                                className={cn(
                                                    'backdrop-blur-sm text-white border shadow-lg hover:scale-110 active:scale-95 transition-all',
                                                    inLibrary ? 'bg-green-500/20 border-green-500/50' : 'bg-white/10 hover:bg-white/20 border-white/20',
                                                    isDownloading && 'opacity-50 cursor-wait'
                                                )}
                                                onClick={async () => {
                                                    setIsDownloading(true);
                                                    if (inLibrary && libraryItem) {
                                                        downloadFromLibrary(libraryItem, toast);
                                                        setIsDownloading(false);
                                                    } else {
                                                        await createUnifiedDownloadJob(
                                                            result as QobuzTrack,
                                                            setStatusBar,
                                                            ffmpegState,
                                                            settings,
                                                            toast,
                                                            mode,
                                                            fetchedAlbumData,
                                                            setFetchedAlbumData,
                                                            country
                                                        );
                                                        setIsDownloading(false);
                                                    }
                                                }}
                                            >
                                                {inLibrary ? <CheckCircle2 className='w-5 h-5' /> : <DownloadIcon className='w-5 h-5' />}
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <DownloadAlbumButton
                                                variant='ghost'
                                                size='icon'
                                                className='bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white border border-white/20 shadow-lg hover:scale-110 transition-transform'
                                                result={result as QobuzAlbum}
                                                toast={toast}
                                                setStatusBar={setStatusBar}
                                                ffmpegState={ffmpegState}
                                                settings={settings}
                                                fetchedAlbumData={fetchedAlbumData}
                                                setFetchedAlbumData={setFetchedAlbumData}
                                                onOpen={() => setFocusCard(true)}
                                                onClose={() => setFocusCard(false)}
                                            />
                                        </>
                                    )}
                                    {(result as QobuzTrack).album ? null : (
                                        <Button
                                            size='icon'
                                            variant='ghost'
                                            className='bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white border border-white/20 shadow-lg hover:scale-110 active:scale-95 transition-all active:-rotate-3'
                                            onClick={openDetails}
                                        >
                                            <AlignJustifyIcon className='w-5 h-5' />
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Card cover */}
                    <div className={cn('absolute left-0 top-0 z-[2] w-full aspect-square')}>
                        {(() => {
                            // For artists, use the highest quality image available (mega > extralarge > large > medium > small)
                            const isArtist = getType(result) === 'artists';
                            const artistImage = isArtist ? (result as QobuzArtist).image : null;
                            const imageSrc = isArtist
                                ? (artistImage?.mega || artistImage?.extralarge || artistImage?.large || artistImage?.medium || artistImage?.small)
                                : (album || result).image?.small;
                            return imageSrc;
                        })() ? (
                            <Image
                                fill
                                src={(() => {
                                    // For artists, use the highest quality image available
                                    const isArtist = getType(result) === 'artists';
                                    const artistImage = isArtist ? (result as QobuzArtist).image : null;
                                    return isArtist
                                        ? (artistImage?.mega || artistImage?.extralarge || artistImage?.large || artistImage?.medium || artistImage?.small)!
                                        : (album || result).image?.small;
                                })()}
                                alt={formatTitle(result)}
                                className={cn(
                                    'object-cover group-hover:scale-110 transition-all duration-500 w-full h-full text-[0px]',
                                    focusCard && 'scale-110',
                                    imageLoaded && 'opacity-100'
                                )}
                                sizes='(min-width: 1536px) calc((100vw - 128px) / 7), (min-width: 1280px) calc((100vw - 96px) / 6), (min-width: 1024px) calc((100vw - 80px) / 5), (min-width: 768px) calc((100vw - 64px) / 4), (min-width: 640px) calc((100vw - 48px) / 3), calc((100vw - 32px) / 2)'
                                onLoad={() => {
                                    setImageLoaded(true);
                                }}
                            />
                        ) : (
                            <div className='flex items-center justify-center bg-secondary w-full h-full'>
                                {filterData.map((filter, index) => {
                                    if (filter.value === getType(result)) {
                                        return <filter.icon key={index} className='w-1/2 h-1/2 opacity-20' />;
                                    }
                                })}
                            </div>
                        )}
                    </div>
                    <Skeleton className='absolute left-0 top-0 z-[1] w-full aspect-square flex items-center justify-center' />
                </div>

                {/* Title and Artist info */}
                <div className='space-y-1.5'>
                    <div className='flex gap-2 items-center'>
                        {(result as QobuzAlbum | QobuzTrack).parental_warning && (
                            <span
                                className='text-[9px] bg-gradient-to-b from-primary to-primary/80 text-primary-foreground px-1.5 py-0.5 rounded-[4px] min-w-[18px] h-[16px] text-center justify-center items-center shrink-0 flex font-extrabold uppercase tracking-wide shadow-sm border border-primary-foreground/10'
                                title='Explicit'
                            >
                                E
                            </span>
                        )}
                        <h1 className='text-sm truncate font-bold group-hover:text-primary transition-colors'>{formatTitle(result)}</h1>
                    </div>
                    {!(getType(result) === 'artists') && (
                        <div
                            className={cn(
                                'text-xs truncate flex gap-x-1 items-center transition-colors',
                                settings.background === 'futuristic'
                                    ? 'text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
                                    : resolvedTheme === 'light'
                                        ? 'text-black/70'
                                        : 'text-white/70'
                            )}
                            title={formatArtists(result as QobuzAlbum | QobuzTrack)}
                        >
                            <UsersIcon className='size-3.5 shrink-0' />
                            <span className='truncate font-medium'>{formatArtists(result as QobuzAlbum | QobuzTrack)}</span>
                        </div>
                    )}
                    {(result as QobuzTrack).album?.title ? (
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
                            <DiscAlbumIcon className='size-3.5 shrink-0' />
                            <span className='truncate font-medium'>{(result as QobuzTrack).album.title}</span>
                        </div>
                    ) : null}
                </div>
            </div >

            {/* ===== REDESIGNED PREMIUM POPUP with exit animation ===== */}
            {
                typeof document !== 'undefined' && createPortal(
                    <AnimatePresence>
                        {isOpen && (
                            <>
                                {/* Immersive Backdrop */}
                                <motion.div
                                    key="backdrop"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className='fixed inset-0 bg-black/80 backdrop-blur-xl z-[200]'
                                    onClick={closeDetails}
                                >
                                    {/* Background Image for immersive feel */}
                                    {(album || result).image?.small && (
                                        <motion.div
                                            initial={{ opacity: 0, scale: 1.1 }}
                                            animate={{ opacity: 0.4, scale: 1 }}
                                            exit={{ opacity: 0 }}
                                            className='absolute inset-0 grayscale-[0.5] contrast-[1.1] scale-110 pointer-events-none'
                                            style={{
                                                backgroundImage: `url(${(album || result).image?.large || (album || result).image?.small})`,
                                                backgroundSize: 'cover',
                                                backgroundPosition: 'center',
                                                filter: 'blur(80px)',
                                            }}
                                        />
                                    )}
                                </motion.div>

                                {/* Modal Container */}
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
                                        {/* Close Button - Fixed to modal top */}
                                        <motion.button
                                            whileHover={{ scale: 1.1, rotate: 90 }}
                                            whileTap={{ scale: 0.9 }}
                                            className='absolute top-4 right-4 z-[210] bg-white/10 hover:bg-white/20 backdrop-blur-xl rounded-full h-10 w-10 flex items-center justify-center border border-white/20 text-white shadow-xl transition-colors'
                                            onClick={closeDetails}
                                        >
                                            <X className='w-5 h-5' />
                                        </motion.button>

                                        {/* Main Content Area - Scrollable on mobile, flex on desktop */}
                                        <div className='flex-1 overflow-y-auto md:overflow-hidden'>
                                            <div className='flex flex-col md:flex-row h-full'>
                                                {/* LEFT SIDE: Hero Section */}
                                                <div className='w-full md:w-[360px] p-8 pb-4 md:pb-8 flex flex-col items-center md:items-start shrink-0'>
                                                    {/* Cover Area */}
                                                    <div className="relative mb-8 pt-4 md:pt-0">
                                                        {/* Glow Background */}
                                                        <div className="absolute inset-0 blur-3xl bg-primary/30 rounded-full opacity-60 scale-125" />

                                                        {/* Cover image - border-radius = popup radius (2.5rem) - padding (2rem) = 0.5rem */}
                                                        <div className='relative z-10 w-[240px] h-[240px] md:w-[280px] md:h-[280px] rounded-[0.5rem] overflow-hidden shadow-2xl border-2 border-white/20'>
                                                            <img
                                                                src={(album || result).image?.large || (album || result).image?.small}
                                                                alt={formatTitle(result)}
                                                                className='w-full h-full object-cover'
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Release Info */}
                                                    <div className='w-full text-center md:text-left'>
                                                        <div className='mb-2'>
                                                            <div className='flex items-center justify-center md:justify-start gap-3 mb-1'>
                                                                {(result as QobuzAlbum | QobuzTrack).parental_warning && (
                                                                    <span className='px-1.5 py-0.5 bg-primary rounded-md text-[10px] font-black text-white shadow-lg'>EXPLICIT</span>
                                                                )}
                                                                <h2 className='text-3xl font-black tracking-tighter leading-none drop-shadow-md text-white'>
                                                                    {formatTitle(result)}
                                                                </h2>
                                                            </div>
                                                            <p className='text-xl font-bold text-muted-foreground/80 truncate'>{formatArtists(result as QobuzAlbum | QobuzTrack)}</p>
                                                        </div>

                                                        {/* Tags Bar */}
                                                        <div className='flex flex-wrap gap-2 justify-center md:justify-start mt-6 mb-4'>
                                                            {[
                                                                { icon: CalendarDays, text: new Date(album?.released_at * 1000).getFullYear() },
                                                                { icon: Disc3, text: `${(result as QobuzAlbum).tracks_count || 1} Tracks` },
                                                                { icon: Headphones, text: `${(result as QobuzAlbum | QobuzTrack).maximum_bit_depth}-bit Hi-Res` },
                                                                { icon: Tag, text: album?.genre?.name || 'Music' }
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

                                                {/* RIGHT SIDE: Tracklist Section */}
                                                <div className='flex-1 p-4 md:p-8 md:pl-0 flex flex-col min-w-0 md:h-[85vh]'>
                                                    {/* Tracklist container - border-radius = popup radius (2.5rem) - padding (2rem) = 0.5rem */}
                                                    <div className='bg-black/20 backdrop-blur-xl border border-white/5 rounded-[0.5rem] p-4 md:p-6 flex flex-col h-full overflow-hidden shadow-2xl relative'>
                                                        {/* Tracklist Header */}
                                                        <div className='flex items-center justify-between mb-4 px-2'>
                                                            <h3 className='text-xs font-black text-white/50 uppercase tracking-widest'>Tracklist</h3>
                                                            <span className='text-[10px] font-bold text-primary bg-primary/20 px-3 py-1 rounded-full'>
                                                                {formatDuration((result as QobuzAlbum | QobuzTrack).duration)} TOTAL
                                                            </span>
                                                        </div>

                                                        {/* Tracklist ScrollArea - Only scrollable on desktop, on mobile it follows parent scroll */}
                                                        <div className='flex-1 overflow-y-visible md:overflow-y-auto pr-0 md:pr-2 custom-scrollbar'>
                                                            <div className='space-y-1'>
                                                                {fetchedAlbumData && fetchedAlbumData.tracks?.items ? (
                                                                    (fetchedAlbumData?.tracks?.items || []).map((track: QobuzTrack, idx: number) => {
                                                                        track.album = album;
                                                                        const libraryItem = getLibraryItem(track.id);
                                                                        const trackInLibrary = !!libraryItem;

                                                                        return (
                                                                            <div
                                                                                key={track.id}
                                                                                onClick={async () => {
                                                                                    if (!track.streamable) return;
                                                                                    if (trackInLibrary && libraryItem) {
                                                                                        await downloadFromLibrary(libraryItem, toast as any);
                                                                                        return;
                                                                                    }
                                                                                    await createUnifiedDownloadJob(
                                                                                        track, setStatusBar, ffmpegState,
                                                                                        settings, toast as any, mode,
                                                                                        fetchedAlbumData, setFetchedAlbumData, country
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
                                                                                        {track.parental_warning && <span className='text-[8px] opacity-60'>🅴</span>}
                                                                                        {trackInLibrary && <CheckCircle2 className='w-3 h-3 text-green-500' />}
                                                                                    </div>
                                                                                </div>
                                                                                <div className='flex items-center gap-4'>
                                                                                    <span className='text-[10px] font-black text-white/40 tabular-nums'>
                                                                                        {formatDuration(track.duration)}
                                                                                    </span>
                                                                                    <div className='p-2 bg-primary/20 rounded-full opacity-0 group-hover/track:opacity-100 transition-all text-primary hover:scale-110'>
                                                                                        <DownloadIcon className='w-3.5 h-3.5' />
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })
                                                                ) : (
                                                                    <div className='flex flex-col items-center justify-center py-20 gap-4'>
                                                                        <div className='relative'>
                                                                            <div className='w-12 h-12 rounded-full border-t-2 border-primary animate-spin' />
                                                                            <Disc3 className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-primary/50' />
                                                                        </div>
                                                                        <p className='text-xs font-black text-white/30 uppercase tracking-widest'>Loading Tracks</p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Main Download Button - Sticky in column */}
                                                        <div className='mt-4 pt-4 border-t border-white/10'>
                                                            <AnimatePresence mode='wait'>
                                                                {!showDownloadOptions ? (
                                                                    <motion.div
                                                                        key="main-dl-btn"
                                                                        initial={{ opacity: 0, scale: 0.95 }}
                                                                        animate={{ opacity: 1, scale: 1 }}
                                                                        exit={{ opacity: 0, scale: 1.05 }}
                                                                    >
                                                                        <Button
                                                                            onClick={() => setShowDownloadOptions(true)}
                                                                            className='w-full h-14 rounded-[1.25rem] bg-primary text-white font-black text-base shadow-[0_16px_32px_-8px_rgba(0,0,0,0.4)] hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all gap-3'
                                                                        >
                                                                            <DownloadIcon className='w-5 h-5' />
                                                                            DOWNLOAD ALL TRACKS
                                                                        </Button>
                                                                    </motion.div>
                                                                ) : (
                                                                    <motion.div
                                                                        key="dl-options-menu"
                                                                        initial={{ opacity: 0, y: 10 }}
                                                                        animate={{ opacity: 1, y: 0 }}
                                                                        exit={{ opacity: 0, y: -10 }}
                                                                        className="flex flex-col gap-2"
                                                                    >
                                                                        <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] text-center mb-1">Select Format</p>
                                                                        <div className="grid grid-cols-2 gap-3">
                                                                            <Button
                                                                                disabled={isDownloading}
                                                                                onClick={async () => {
                                                                                    setIsDownloading(true);
                                                                                    createUnifiedDownloadJob(result as QobuzAlbum, setStatusBar, ffmpegState, settings, toast as any, mode, fetchedAlbumData, setFetchedAlbumData, country);
                                                                                    toast({ title: `Added '${formatTitle(result)}'`, description: 'The album has been added to the queue' });
                                                                                    closeDetails();
                                                                                }}
                                                                                className='h-16 rounded-[1.25rem] bg-white/10 hover:bg-white/20 border border-white/10 text-white font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all group disabled:opacity-50'
                                                                            >
                                                                                <FileArchiveIcon className='w-5 h-5 text-primary group-hover:scale-110 transition-transform' />
                                                                                ZIP ARCHIVE
                                                                            </Button>
                                                                            <Button
                                                                                disabled={isDownloading}
                                                                                onClick={async () => {
                                                                                    setIsDownloading(true);
                                                                                    const albumData = await getFullAlbumInfo(fetchedAlbumData, setFetchedAlbumData, result as QobuzAlbum, country);
                                                                                    if (!albumData?.tracks?.items) {
                                                                                        toast({ title: 'Error', description: 'Could not load album tracks. Please try again.', variant: 'destructive' });
                                                                                        setIsDownloading(false);
                                                                                        return;
                                                                                    }
                                                                                    for (const track of (albumData?.tracks?.items || [])) {
                                                                                        if (track.streamable) {
                                                                                            await createUnifiedDownloadJob({ ...track, album: albumData }, setStatusBar, ffmpegState, settings, toast as any, mode, albumData, setFetchedAlbumData, country);
                                                                                            await new Promise((resolve) => setTimeout(resolve, 100));
                                                                                        }
                                                                                    }
                                                                                    toast({ title: `Added '${formatTitle(result)}'`, description: 'The album has been added to the queue' });
                                                                                    closeDetails();
                                                                                }}
                                                                                className='h-16 rounded-[1.25rem] bg-white/10 hover:bg-white/20 border border-white/10 text-white font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all group disabled:opacity-50'
                                                                            >
                                                                                <MusicIcon className='w-5 h-5 text-primary group-hover:scale-110 transition-transform' />
                                                                                ALL TRACKS
                                                                            </Button>
                                                                        </div>
                                                                        <button
                                                                            disabled={isDownloading}
                                                                            onClick={() => setShowDownloadOptions(false)}
                                                                            className="text-[10px] font-black text-white/30 hover:text-white/60 transition-colors mt-2 uppercase tracking-widest h-8"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence >,
                    document.body
                )
            }

            {getType(result) === 'artists' && <ArtistDialog open={openArtistDialog} setOpen={setOpenArtistDialog} artist={result as QobuzArtist} />}
            {getType(result) !== 'artists' && showArtistDialog && <ArtistDialog open={openArtistDialog} setOpen={setOpenArtistDialog} artist={artist} />}
        </>
    );
};

export default memo(ReleaseCard);
