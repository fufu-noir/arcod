import axios from 'axios';
import Image from 'next/image';
import React, { useEffect, useState, useCallback, memo } from 'react';
import ReleaseCard from './release-card';
import { Button } from './ui/button';
import { ArrowLeftIcon, Disc3Icon, DiscAlbumIcon, DownloadIcon, Loader2Icon, LucideIcon, RadioTowerIcon, SearchIcon, UsersIcon } from 'lucide-react';
import { downloadArtistDiscographyUnified } from '@/lib/unified-download-job';
import { useDownloadMode } from '@/lib/download-mode-provider';
import { motion, AnimatePresence } from 'motion/react';
import { parseArtistAlbumData, parseArtistData, QobuzArtist, QobuzArtistResults } from '@/lib/qobuz-dl';

import { useFFmpeg } from '@/lib/ffmpeg-provider';
import { useSettings } from '@/lib/settings-provider';
import { useStatusBar } from '@/lib/status-bar/context';
import { useTheme } from 'next-themes';
import { useToast } from '@/hooks/use-toast';
import { useCountry } from '@/lib/country-provider';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type CategoryType = {
    label: string;
    value: 'album' | 'epSingle' | 'live' | 'compilation';
    icon: LucideIcon;
};

export const artistReleaseCategories: CategoryType[] = [
    {
        label: 'Albums',
        value: 'album',
        icon: DiscAlbumIcon
    },
    {
        label: 'EPs & Singles',
        value: 'epSingle',
        icon: Disc3Icon
    },
    {
        label: 'Live Albums',
        value: 'live',
        icon: RadioTowerIcon
    },
    {
        label: 'Compilations',
        value: 'compilation',
        icon: DiscAlbumIcon
    }
];

const ArtistDialog = ({ open, setOpen, artist }: { open: boolean; setOpen: (open: boolean) => void; artist: QobuzArtist }) => {
    const [artistResults, setArtistResults] = useState<QobuzArtistResults | null>(null);
    const [activeCategory, setActiveCategory] = useState<CategoryType['value']>('album');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const { country } = useCountry();
    const { toast } = useToast();

    const { settings } = useSettings();

    const getArtistData = useCallback(async () => {
        if (artistResults) return;
        try {
            const response = await axios.get(`/api/get-artist`, { params: { artist_id: artist.id }, headers: { 'Token-Country': country } });
            setArtistResults(parseArtistData(response.data.data));
        } catch {
            toast({ title: 'Error', description: 'Could not fetch artist data, check your token' });
        }
    }, [artistResults, artist.id, country, toast]);

    const fetchMore = useCallback(async (searchField: 'album' | 'epSingle' | 'live' | 'compilation', artistResults: QobuzArtistResults) => {
        const currentItems = artistResults?.artist?.releases?.[searchField]?.items || [];
        const response = await axios.get(`/api/get-releases`, {
            params: {
                artist_id: artist.id,
                offset: currentItems.length,
                limit: 20,
                release_type: searchField
            },
            headers: { 'Token-Country': country }
        });
        const newReleases = [
            ...currentItems,
            ...(response.data.data?.items || []).map((release: any) => parseArtistAlbumData(release))
        ];
        setArtistResults({
            ...artistResults!,
            artist: {
                ...artistResults!.artist,
                releases: {
                    ...(artistResults?.artist?.releases || {}),
                    [searchField]: {
                        ...(artistResults?.artist?.releases?.[searchField] || {}),
                        items: newReleases,
                        has_more: response.data.data.has_more
                    }
                }
            }
        });
    }, [artist.id, country]);

    useEffect(() => {
        if (open) {
            getArtistData();
            // Calculate scrollbar width to prevent layout shift
            const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
            document.body.style.overflow = 'hidden';
            document.body.style.paddingRight = `${scrollbarWidth}px`;
            document.documentElement.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
            document.documentElement.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
            document.documentElement.style.overflow = '';
        };
    }, [open, getArtistData]);

    const { setStatusBar } = useStatusBar();
    const { ffmpegState } = useFFmpeg();
    const { mode } = useDownloadMode();

    const artistImage = artist.image?.large || artist.image?.small ||
        (artistResults?.artist.images.portrait ?
            'https://static.qobuz.com/images/artists/covers/medium/' + artistResults.artist.images.portrait.hash + '.' + artistResults.artist.images.portrait.format
            : null);

    if (!open) return null;

    return typeof document !== 'undefined' ? createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className='fixed inset-0 z-[15] bg-background'
                >
                    {/* Background blur image */}
                    {artistImage && (
                        <div
                            className='absolute inset-0 opacity-20 blur-3xl scale-110'
                            style={{
                                backgroundImage: `url(${artistImage})`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                            }}
                        />
                    )}

                    {/* Scrollable content */}
                    <div className='relative z-10 h-full overflow-y-auto'>
                        <div className='w-full mx-auto max-w-[1600px] px-4 md:px-6 pt-20 md:pt-24'>

                            {/* Header */}
                            <div className='py-4 flex items-center'>
                                <button
                                    onClick={() => setOpen(false)}
                                    className='flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl px-4 py-2 transition-colors'
                                >
                                    <ArrowLeftIcon className='w-4 h-4' />
                                    Back
                                </button>
                            </div>

                            {/* Artist Hero Section */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                                className='flex flex-col md:flex-row items-center md:items-end gap-6 md:gap-8 py-8 md:py-12'
                            >
                                {/* Artist Image */}
                                <div className='relative w-48 h-48 md:w-64 md:h-64 rounded-full overflow-hidden shadow-2xl border-4 border-primary/20 shrink-0'>
                                    {artistImage ? (
                                        <Image
                                            fill
                                            src={artistImage}
                                            alt={artist.name}
                                            className='object-cover'
                                        />
                                    ) : (
                                        <div className='w-full h-full bg-secondary flex items-center justify-center'>
                                            <UsersIcon className='w-1/2 h-1/2 opacity-20' />
                                        </div>
                                    )}
                                </div>

                                {/* Artist Info */}
                                <div className='flex-1 text-center md:text-left'>
                                    <p className='text-sm font-medium text-primary mb-2'>ARTIST</p>
                                    <h1 className='text-4xl md:text-6xl font-black mb-4 tracking-tight'>{artist.name}</h1>


                                    {/* Download All Button */}
                                    {artistResults && (
                                        <Button
                                            size='lg'
                                            className='gap-2 rounded-full px-8'
                                            onClick={() => {
                                                downloadArtistDiscographyUnified(
                                                    artistResults,
                                                    setArtistResults,
                                                    fetchMore,
                                                    'all',
                                                    setStatusBar,
                                                    settings,
                                                    toast,
                                                    ffmpegState,
                                                    mode,
                                                    country
                                                );
                                            }}
                                        >
                                            <DownloadIcon className='w-5 h-5' />
                                            Download Discography
                                        </Button>
                                    )}
                                </div>
                            </motion.div>

                            {/* Category Tabs + Search */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.2 }}
                                className='flex flex-col sm:flex-row gap-4 pb-4 mb-6 border-b border-border/50'
                            >
                                {/* Category buttons */}
                                <div className='flex gap-2 overflow-x-auto flex-1'>
                                    {artistReleaseCategories.map((category) => {
                                        const count = artistResults?.artist?.releases?.[category.value]?.items?.length || 0;
                                        const hasItems = count > 0 || !artistResults;

                                        if (!hasItems && artistResults) return null;

                                        return (
                                            <button
                                                key={category.value}
                                                onClick={() => setActiveCategory(category.value)}
                                                className={cn(
                                                    'flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap transition-all',
                                                    activeCategory === category.value
                                                        ? 'bg-primary text-primary-foreground'
                                                        : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                                )}
                                            >
                                                <category.icon className='w-4 h-4' />
                                                {category.label}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Search input */}
                                <div className='relative'>
                                    <SearchIcon className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
                                    <input
                                        type='text'
                                        placeholder='Search releases...'
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className='w-full sm:w-64 h-10 pl-10 pr-4 rounded-full bg-muted/50 border border-border/50 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all'
                                    />
                                </div>
                            </motion.div>

                            {/* Releases Grid */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className='pb-20'
                            >
                                {!artistResults ? (
                                    <div className='flex flex-col items-center justify-center py-20 gap-4'>
                                        <Loader2Icon className='w-8 h-8 animate-spin text-primary' />
                                        <p className='text-muted-foreground'>Loading artist data...</p>
                                    </div>
                                ) : (
                                    <ArtistReleaseGrid
                                        artistResults={artistResults}
                                        category={artistReleaseCategories.find(c => c.value === activeCategory)!}
                                        fetchMore={fetchMore}
                                        searchQuery={searchQuery}
                                    />
                                )}
                            </motion.div>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    ) : null;
};

const ArtistReleaseGrid = memo(({
    artistResults,
    category,
    fetchMore,
    searchQuery
}: {
    artistResults: QobuzArtistResults;
    category: CategoryType;
    fetchMore: (searchField: 'album' | 'epSingle' | 'live' | 'compilation', artistResults: QobuzArtistResults) => Promise<void>;
    searchQuery: string;
}) => {
    const { resolvedTheme } = useTheme();
    const [loading, setLoading] = useState(false);
    const { settings } = useSettings();
    const loadMoreRef = React.useRef<HTMLDivElement>(null);

    const allReleases = artistResults?.artist?.releases?.[category.value]?.items || [];
    const hasMore = artistResults?.artist?.releases?.[category.value]?.has_more || false;

    // Filter releases based on search query
    const filteredReleases = React.useMemo(() => {
        if (!searchQuery.trim()) return allReleases;
        const query = searchQuery.toLowerCase();
        return allReleases.filter(release => release.title?.toLowerCase().includes(query));
    }, [allReleases, searchQuery]);

    // Load more API data in background when searching
    useEffect(() => {
        if (searchQuery.trim() && hasMore && !loading) {
            setLoading(true);
            fetchMore(category.value, artistResults).finally(() => setLoading(false));
        }
    }, [searchQuery, hasMore, loading, fetchMore, category.value, artistResults]);

    // Intersection observer for loading more from API
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !searchQuery.trim() && hasMore && !loading) {
                    setLoading(true);
                    fetchMore(category.value, artistResults).finally(() => setLoading(false));
                }
            },
            { rootMargin: '400px' }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [hasMore, loading, searchQuery, fetchMore, category.value, artistResults]);

    const isSearching = searchQuery.trim() && hasMore;

    if (filteredReleases.length === 0 && !isSearching) {
        return (
            <div className={cn(
                'flex items-center justify-center py-20 text-lg font-medium',
                settings.background === 'futuristic' ? 'text-white/70' : 'text-muted-foreground'
            )}>
                {searchQuery.trim()
                    ? `No ${category.label.toLowerCase()} matching &quot;${searchQuery}&quot;`
                    : `No ${category.label.toLowerCase()} found for this artist.`}
            </div>
        );
    }

    return (
        <>
            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 md:gap-6'>
                {filteredReleases.map((release, index) => (
                    <ReleaseCard
                        key={`${release.id}-${index}`}
                        result={release}
                        resolvedTheme={String(resolvedTheme)}
                        showArtistDialog={false}
                    />
                ))}
            </div>

            {/* Load more trigger */}
            <div ref={loadMoreRef} className='h-8' />

            {/* Loading indicator */}
            {(hasMore || isSearching) && (
                <div className='flex justify-center items-center py-6'>
                    <div className='flex items-center gap-2 text-muted-foreground'>
                        <Loader2Icon className='w-5 h-5 animate-spin' />
                        <span>{isSearching ? `Searching... (${allReleases.length} loaded)` : 'Loading more...'}</span>
                    </div>
                </div>
            )}

            {/* End message */}
            {!hasMore && filteredReleases.length > 0 && (
                <div className={cn(
                    'flex items-center justify-center py-6 text-sm font-medium',
                    settings.background === 'futuristic' ? 'text-white/70' : 'text-muted-foreground'
                )}>
                    {searchQuery.trim() ? `${filteredReleases.length} results found` : `All ${category.label.toLowerCase()} loaded.`}
                </div>
            )}
        </>
    );
});

ArtistReleaseGrid.displayName = 'ArtistReleaseGrid';

export default ArtistDialog;
