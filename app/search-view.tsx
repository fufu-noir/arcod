'use client';

import axios from 'axios';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReleaseCard from '@/components/release-card';
import SearchBar from '@/components/search-bar/search-bar';
import { ArrowLeftIcon, ChevronRightIcon, Disc3Icon, DiscAlbumIcon, Loader2Icon, UsersIcon } from 'lucide-react';
import { FilterDataType, filterExplicit, QobuzAlbum, QobuzArtist, QobuzSearchFilters, QobuzSearchResults, QobuzTrack } from '@/lib/qobuz-dl';
import { cn } from '@/lib/utils';
import { motion, useAnimation } from 'motion/react';
import { useSettings } from '@/lib/settings-provider';
import { useTheme } from 'next-themes';
import CountryPicker from '@/components/country-picker';
import { useCountry } from '@/lib/country-provider';
import ArcodLogo from '@/components/arcod-logo';

import { Button } from '@/components/ui/button';
import { useInView } from 'react-intersection-observer';

export const filterData: FilterDataType = [
    {
        label: 'Albums',
        value: 'albums',
        icon: DiscAlbumIcon
    },
    {
        label: 'Tracks',
        value: 'tracks',
        icon: Disc3Icon
    },
    {
        label: 'Artists',
        value: 'artists',
        icon: UsersIcon
    }
];

// Number of items to show initially per category
const INITIAL_ITEMS_COUNT = 6;

const SearchView = () => {
    const { resolvedTheme } = useTheme();
    const [results, setResults] = useState<QobuzSearchResults | null>(null);
    const [expandedCategory, setExpandedCategory] = useState<QobuzSearchFilters | null>(null);
    const [query, setQuery] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    const [searching, setSearching] = useState<boolean>(false);
    const [searchError, setSearchError] = useState<string>('');
    const { settings } = useSettings();
    const { country } = useCountry();


    const getSearchEndpoint = useCallback(() => {
        return '/api/get-music';
    }, []);

    // Infinite scroll trigger
    const [scrollTriggerRef, isInView] = useInView({
        threshold: 0,
        rootMargin: '200px'
    });

    useEffect(() => {
        console.log(`%cARCOD`, 'font-size: 25px; font-weight: bold; color: #3b82f6;');
        if (process.env.NEXT_PUBLIC_DISCORD) {
            console.log(`Discord: ${process.env.NEXT_PUBLIC_DISCORD}`);
        }
        if (process.env.NEXT_PUBLIC_GITHUB) {
            console.log(`GitHub: ${process.env.NEXT_PUBLIC_GITHUB}`);
        }
    }, []);

    const cardRef = useRef<HTMLDivElement | null>(null);

    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const logoAnimationControls = useAnimation();
    useEffect(() => {
        if (mounted)
            setTimeout(
                () =>
                    logoAnimationControls.start({
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.5, type: 'spring' }
                    }),
                100
            );
    }, [logoAnimationControls, mounted]);

    const onSearch = useCallback(async (query: string) => {
        setQuery(query);
        setSearchError('');
        setExpandedCategory(null);
        try {
            const response = await axios.get(`${getSearchEndpoint()}?q=${query}&offset=0`, {
                headers: {
                    'Token-Country': country
                }
            });
            if (response.status === 200) {
                setLoading(false);

                let newResults = { ...response.data.data };
                filterData.map((filter) => {
                    if (!newResults[filter.value])
                        newResults = {
                            ...newResults,
                            [filter.value]: {
                                total: undefined,
                                offset: undefined,
                                limit: undefined,
                                items: []
                            }
                        };
                });
                setResults(newResults);
            }
        } catch (error: any) {
            setSearchError(error?.response.data?.error || error.message || 'An error occurred.');
        }
        setSearching(false);
    }, [country, getSearchEndpoint]);

    // Fetch more items for a specific category
    const fetchMoreForCategory = useCallback(async (category: QobuzSearchFilters) => {
        if (loading || !results) return;
        setLoading(true);

        const filter = filterData.find((fd) => fd.value === category);
        if (!filter) return;

        try {
            if (filter.searchRoute) {
                const response = await axios.get('/api/' + filter.searchRoute + `?q=${query}&offset=${results[category]?.items?.length || 0}`, {
                    headers: { 'Token-Country': country }
                });
                if (response.status === 200) {
                    const newResults = {
                        ...results,
                        [category]: {
                            ...results[category],
                            items: [...(results[category]?.items || []), ...(response.data.data?.[category]?.items || [])]
                        }
                    };
                    setResults(newResults);
                }
            } else {
                const response = await axios.get(`${getSearchEndpoint()}?q=${query}&offset=${results[category]?.items?.length || 0}`, {
                    headers: { 'Token-Country': country }
                });
                if (response.status === 200) {
                    const newResults = {
                        ...results,
                        [category]: {
                            ...results[category],
                            items: [...(results[category]?.items || []), ...(response.data.data?.[category]?.items || [])]
                        }
                    };
                    setResults(newResults);
                }
            }
        } catch (error) {
            console.error('Error fetching more items:', error);
        }
        setLoading(false);
    }, [loading, results, query, country, getSearchEndpoint]);

    useEffect(() => {
        if (isInView && expandedCategory && results && !loading) {
            const items = results[expandedCategory]?.items || [];
            const total = results[expandedCategory]?.total || 0;
            if (items.length < total) {
                fetchMoreForCategory(expandedCategory);
            }
        }
    }, [isInView, expandedCategory, results, loading, fetchMoreForCategory]);


    useEffect(() => {
        if (country && query) onSearch(query);
    }, [country]);

    const filteredResults = React.useMemo(() => {
        if (!results) return null;
        return filterExplicit(results, settings.explicitContent);
    }, [results, settings.explicitContent]);

    // Get category info helper
    const getCategoryInfo = (category: QobuzSearchFilters) => {
        const filter = filterData.find(f => f.value === category);
        return {
            icon: filter?.icon || DiscAlbumIcon,
            label: filter?.label || 'Items'
        };
    };



    // Render a category section (compact view)
    const renderCategorySection = (category: QobuzSearchFilters, Icon: React.ElementType, label: string) => {
        if (!filteredResults || !filteredResults[category] || !filteredResults[category]?.items?.length) {
            return null;
        }

        const items = filteredResults[category]?.items || [];
        const total = results![category]?.total || 0;
        const displayItems = items.slice(0, INITIAL_ITEMS_COUNT);
        const hasMore = total > INITIAL_ITEMS_COUNT;

        return (
            <div
                key={category}
                className='mb-10 animate-in fade-in slide-in-from-bottom-4 duration-300'
            >
                {/* Category Header */}
                <div className='flex items-center justify-between mb-4 px-4 md:px-6'>
                    <div className='flex items-center gap-3'>
                        <div className='p-2 rounded-lg bg-primary/10'>
                            <Icon className='w-5 h-5 text-primary' />
                        </div>
                        <h2 className='text-xl font-bold'>{label}</h2>
                    </div>
                    {hasMore && (
                        <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => {
                                setExpandedCategory(category);
                                // Fetch more if needed
                                if (items.length <= INITIAL_ITEMS_COUNT && items.length < total) {
                                    fetchMoreForCategory(category);
                                }
                            }}
                            className='flex items-center gap-1 text-primary hover:text-primary/80 hover:bg-primary/10'
                        >
                            See more
                            <ChevronRightIcon className='w-4 h-4' />
                        </Button>
                    )}
                </div>

                {/* Category Grid */}
                <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6 w-full px-4 md:px-6 overflow-visible'>
                    {displayItems.map((result: QobuzAlbum | QobuzTrack | QobuzArtist, index: number) => {
                        if (!result) return null;
                        return (
                            <div
                                key={`${result.id}-${category}`}
                                className='animate-in fade-in zoom-in-95 duration-200'
                                style={{ animationDelay: `${index * 30}ms` }}
                            >
                                <ReleaseCard
                                    result={result}
                                    resolvedTheme={String(resolvedTheme)}
                                    ref={index === 0 && category === 'albums' ? cardRef : null}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // Render expanded full-page view for a category
    const renderExpandedView = () => {
        if (!expandedCategory || !filteredResults) return null;

        const { icon: Icon, label } = getCategoryInfo(expandedCategory);
        const items = filteredResults[expandedCategory]?.items || [];
        const total = results![expandedCategory]?.total || 0;
        const hasMore = items.length < total;

        return (
            <div
                className='fixed inset-0 z-[5] animate-in fade-in duration-200 pointer-events-none'
                style={{ willChange: 'opacity' }}
            >
                <div
                    className='w-full h-full mx-auto max-w-[1600px] pt-24 md:pt-28 pb-20 pointer-events-auto overflow-y-auto'
                    style={{ WebkitOverflowScrolling: 'touch' }}
                >
                    {/* Header with back button - scrolls with content */}
                    <div className='flex items-center gap-4 mb-8 px-4 md:px-6 animate-in slide-in-from-left-4 duration-300'>
                        <button
                            type="button"
                            onClick={() => setExpandedCategory(null)}
                            className='flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl px-4 py-2 cursor-pointer'
                        >
                            <ArrowLeftIcon className='w-4 h-4' />
                            Back
                        </button>
                        <div className='flex items-center gap-3'>
                            <div className='p-2.5 rounded-lg bg-primary/10'>
                                <Icon className='w-6 h-6 text-primary' />
                            </div>
                            <h2 className='text-2xl font-bold'>{label}</h2>
                        </div>
                    </div>

                    {/* Full Grid */}
                    <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 md:gap-6 w-full px-4 md:px-6 overflow-visible'>
                        {items.map((result: QobuzAlbum | QobuzTrack | QobuzArtist, index: number) => {
                            if (!result) return null;
                            return (
                                <div
                                    key={`${result.id}-${expandedCategory}-expanded`}
                                    className='animate-in fade-in zoom-in-95 duration-200'
                                    style={{ animationDelay: `${Math.min(index * 20, 300)}ms` }}
                                >
                                    <ReleaseCard
                                        result={result}
                                        resolvedTheme={String(resolvedTheme)}
                                        ref={index === 0 ? cardRef : null}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* Infinite scroll trigger & loading indicator */}
                    {hasMore && (
                        <div
                            ref={scrollTriggerRef}
                            className='flex justify-center items-center py-8'
                        >
                            <div className='flex items-center gap-2 text-muted-foreground'>
                                <Loader2Icon className='w-5 h-5 animate-spin' />
                                <span>Loading more...</span>
                            </div>
                        </div>
                    )}

                    {/* End message */}
                    {!hasMore && items.length > 0 && (
                        <div
                            className={cn(
                                'w-full h-[60px] text-base flex items-center justify-center font-medium pt-8 transition-colors animate-in fade-in duration-300',
                                settings.background === 'futuristic' ? 'text-white/70' : 'text-muted-foreground'
                            )}
                        >
                            No more {expandedCategory} to show.
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            {/* Main content */}
            <div
                className={cn(
                    'space-y-6 w-full transition-all duration-200',
                    expandedCategory && 'opacity-0 scale-95 pointer-events-none'
                )}
            >
                <motion.div
                    className='flex flex-col select-none cursor-pointer w-fit mx-auto'
                    onClick={() => {
                        logoAnimationControls.start({
                            scale: [1, 1.05, 1],
                            transition: { duration: 0.3, ease: 'easeInOut' }
                        });
                        setQuery('');
                        setResults(null);
                        setExpandedCategory(null);
                    }}
                    initial={{ opacity: 0, y: -20 }}
                    animate={logoAnimationControls}
                    transition={{ duration: 0.5 }}
                >
                    <ArcodLogo size={140} />
                </motion.div>
                <div className='flex flex-col items-center justify-center w-full'>
                    <SearchBar onSearch={onSearch} searching={searching} setSearching={setSearching} query={query} />

                    {/* Country picker on mobile only */}
                    <div className='w-full max-w-[800px] flex justify-center mt-3 px-4 sm:px-0'>
                        <CountryPicker className='sm:hidden' />
                    </div>

                    {searchError && (
                        <motion.p
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className='text-destructive w-full text-center font-semibold mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20'
                        >
                            {typeof searchError === 'object' ? JSON.stringify(searchError) : searchError}
                        </motion.p>
                    )}
                </div>
            </div>

            {/* Results - compact view */}
            <div className='w-full'>
                {filteredResults && !expandedCategory && (
                    <div className='my-8 w-full mx-auto max-w-[1600px] pb-20'>
                        {/* Albums Section */}
                        {renderCategorySection('albums', DiscAlbumIcon, 'Albums')}

                        {/* Tracks Section */}
                        {renderCategorySection('tracks', Disc3Icon, 'Tracks')}

                        {/* Artists Section */}
                        {renderCategorySection('artists', UsersIcon, 'Artists')}

                        {/* No results message */}
                        {(filteredResults.albums?.items?.length || 0) === 0 &&
                            (filteredResults.tracks?.items?.length || 0) === 0 &&
                            (filteredResults.artists?.items?.length || 0) === 0 && (
                                <div
                                    className={cn(
                                        'w-full h-[200px] text-lg flex items-center justify-center font-medium transition-colors',
                                        settings.background === 'futuristic' ? 'text-white/70' : 'text-muted-foreground'
                                    )}
                                >
                                    No results found for &quot;{query}&quot;
                                </div>
                            )}
                    </div>
                )}
            </div>

            {/* Expanded Category View (overlay) - using portal to escape z-index issues */}
            {typeof document !== 'undefined' && expandedCategory && createPortal(
                renderExpandedView(),
                document.body
            )}
        </>
    );
};

export default SearchView;
