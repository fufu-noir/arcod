"use client";
import React, { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Loader2, Download, Music, Disc, Trash2, X, ChevronRight, Calendar, Album, Loader } from 'lucide-react';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import axios from 'axios';
import { useStatusBar } from '@/lib/status-bar/context';
import { useSettings } from '@/lib/settings-provider';
import { useCountry } from '@/lib/country-provider';
import { createDownloadV2, waitForDownloadV2, getDownloadUrlV2, downloadFile, type DownloadStatusV2 } from '@/lib/download-service-v2';
import { supabase } from '@/lib/supabase-config';
import { useLibrary, type LibraryItem } from '@/lib/library-provider';

interface AlbumGroup {
    title: string;
    artist: string;
    image?: string;
    zipDownload?: LibraryItem;
    tracks: LibraryItem[];
    lastDownloaded: Date;
    hasNotSavedItems?: boolean;
}

interface ArtistGroup {
    name: string;
    artistId?: string;
    image?: string;
    albums: { [key: string]: AlbumGroup };
}

interface HistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

function normalizeArtistLookupKey(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getArtistLookupKey(artist: Pick<ArtistGroup, 'artistId' | 'name'>): string {
    if (artist.artistId) {
        return `id:${artist.artistId}`;
    }

    const normalizedName = normalizeArtistLookupKey(artist.name);
    if (!normalizedName || normalizedName === 'unknown artist') {
        return '';
    }

    return `name:${normalizedName}`;
}

/**
 * Groups flat library items into Artist -> Album hierarchy
 * Memoized to avoid re-computation on every render
 */
function groupItemsByArtistAlbum(items: LibraryItem[]): { [key: string]: ArtistGroup } {
    const grouped: { [key: string]: ArtistGroup } = {};

    items.forEach(item => {
        const rawArtistName = item.metadata.artistName;
        const artistName: string = typeof rawArtistName === 'object' && rawArtistName !== null && 'display' in (rawArtistName as any)
            ? (rawArtistName as any).display
            : (typeof rawArtistName === 'string' ? rawArtistName : 'Unknown Artist');
        const albumTitle = item.metadata.albumTitle || item.metadata.title || 'Unknown Album';

        let coverImage: string | undefined;
        if (item.metadata.image) {
            if (typeof item.metadata.image === 'string') {
                coverImage = item.metadata.image;
            } else {
                const imgObj = item.metadata.image as any;
                coverImage = imgObj.medium || imgObj.small;
            }
        }

        const artistId = item.metadata.artistId || '';

        if (!grouped[artistName]) {
            grouped[artistName] = { name: artistName, artistId, albums: {} };
        } else if (artistId && !grouped[artistName].artistId) {
            grouped[artistName].artistId = artistId;
        }

        if (!grouped[artistName].albums[albumTitle]) {
            grouped[artistName].albums[albumTitle] = {
                title: albumTitle,
                artist: artistName,
                image: coverImage,
                zipDownload: undefined,
                tracks: [],
                lastDownloaded: new Date(item.createdAt),
                hasNotSavedItems: false
            };
        }

        if (item.type === 'album') {
            grouped[artistName].albums[albumTitle].zipDownload = item;
        } else {
            grouped[artistName].albums[albumTitle].tracks.push(item);
        }
    });

    return grouped;
}

export function HistoryPanel({ isOpen, onClose }: HistoryPanelProps) {
    const { user } = useAuth();
    const { toast } = useToast();
    const { libraryItems, isLoading: libraryLoading, isFreshLoad, refreshLibrary } = useLibrary();
    const { setStatusBar } = useStatusBar();
    const { settings } = useSettings();
    const { country } = useCountry();
    const [expandedArtist, setExpandedArtist] = useState<string | null>(null);
    const [expandedAlbum, setExpandedAlbum] = useState<string | null>(null);
    const [deletingTracks, setDeletingTracks] = useState<Set<string>>(new Set());
    const [deletingAlbums, setDeletingAlbums] = useState<Set<string>>(new Set());
    const [confirmingDelete, setConfirmingDelete] = useState<{ key: string; items: LibraryItem[] } | null>(null);
    const [deletingArtist, setDeletingArtist] = useState<string | null>(null);
    const [deletingAll, setDeletingAll] = useState(false);
    const [artistImages, setArtistImages] = useState<{ [artistId: string]: string | null }>({});
    const fetchingArtistImages = useRef<Set<string>>(new Set());
    const refreshLibraryRef = useRef(refreshLibrary);
    refreshLibraryRef.current = refreshLibrary;

    // Derive grouped history from shared library data (no extra API call!)
    const history = useMemo(() => groupItemsByArtistAlbum(libraryItems), [libraryItems]);

    // When the panel opens, trigger a background refresh if needed
    // Data shows immediately from cache, refresh happens silently
    useEffect(() => {
        if (isOpen && user) {
            refreshLibraryRef.current();
        }
    }, [isOpen, user]);

    // Helper to fetch a single artist image from Spotify (cached server-side)
    const fetchSingleArtistImage = useCallback(async (artist: Pick<ArtistGroup, 'artistId' | 'name'>) => {
        const lookupKey = getArtistLookupKey(artist);
        if (!lookupKey || fetchingArtistImages.current.has(lookupKey)) return;
        fetchingArtistImages.current.add(lookupKey);

        try {
            const response = await axios.get(`${process.env.NEXT_PUBLIC_AWS_API_URL}/artist-image`, {
                params: { name: artist.name }
            });
            setArtistImages(prev => ({ ...prev, [lookupKey]: response.data?.imageUrl || null }));
        } catch (error) {
            console.error('Error fetching artist image:', error);
            setArtistImages(prev => ({ ...prev, [lookupKey]: null }));
        } finally {
            fetchingArtistImages.current.delete(lookupKey);
        }
    }, []);

    // Fetch artist image on expand (immediate, in case pre-fetch didn't cover it)
    useEffect(() => {
        if (!expandedArtist) return;
        const artist = history[expandedArtist];
        const artistLookupKey = artist ? getArtistLookupKey(artist) : '';
        if (!artist || !artistLookupKey) return;
        // Use functional state check to avoid artistImages in deps
        setArtistImages(prev => {
            if (prev[artistLookupKey] !== undefined) return prev;
            fetchSingleArtistImage(artist);
            return prev;
        });
    }, [expandedArtist, history, fetchSingleArtistImage]);

    // Pre-fetch ALL artist images when the panel is open and library data is available
    // Uses a ref to track which batch we've already initiated to run only once per data load
    const prefetchedForData = useRef<number>(0);
    useEffect(() => {
        if (!isOpen || libraryItems.length === 0) return;
        // Only run once per unique data set (avoid re-running on every render)
        if (prefetchedForData.current === libraryItems.length) return;
        prefetchedForData.current = libraryItems.length;

        const allArtists = Object.values(history);
        // Fetch all artist images that we don't already have, with concurrency limit
        const toFetch = allArtists.filter((artist) => {
            const artistLookupKey = getArtistLookupKey(artist);
            return artistLookupKey && !fetchingArtistImages.current.has(artistLookupKey);
        });

        // Batch fetch: 3 concurrent requests at a time
        const batchFetch = async () => {
            for (let i = 0; i < toFetch.length; i += 3) {
                const batch = toFetch.slice(i, i + 3);
                await Promise.allSettled(
                    batch.map(artist => {
                        const artistLookupKey = getArtistLookupKey(artist);
                        // Check current state via ref pattern
                        return new Promise<void>((resolve) => {
                            setArtistImages(prev => {
                                if (!artistLookupKey || prev[artistLookupKey] !== undefined) {
                                    resolve();
                                    return prev;
                                }
                                fetchSingleArtistImage(artist).then(resolve);
                                return prev;
                            });
                        });
                    })
                );
            }
        };

        batchFetch();
    }, [isOpen, libraryItems.length, history, fetchSingleArtistImage]);

    const requestDelete = (items: LibraryItem[], albumKey: string) => {
        setConfirmingDelete({ key: albumKey, items });
    };

    useEffect(() => {
        if (!confirmingDelete) return;
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-confirm-container]')) {
                setConfirmingDelete(null);
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [confirmingDelete]);

    const confirmDelete = async () => {
        if (!user || !confirmingDelete) return;

        const { key, items } = confirmingDelete;
        setConfirmingDelete(null);

        try {
            setDeletingAlbums(prev => new Set(prev).add(key));
            const token = await user.getIdToken();

            await Promise.all(items.map(item => {
                const endpoint = `${process.env.NEXT_PUBLIC_AWS_API_URL}/v2/downloads/${item.id}`;
                return axios.delete(endpoint, {
                    headers: { Authorization: token }
                });
            }));

            toast({ title: "Deleted", description: "Album removed from history" });
            await refreshLibrary();
        } catch (error) {
            console.error('Delete failed:', error);
            toast({
                title: "Error",
                description: "Failed to delete album. Please try again.",
                variant: 'destructive'
            });
        } finally {
            setDeletingAlbums(prev => {
                const newSet = new Set(prev);
                newSet.delete(key);
                return newSet;
            });
        }
    };

    const handleDeleteTrack = async (item: LibraryItem) => {
        if (!user) return;
        setDeletingTracks(prev => new Set(prev).add(item.id));
        try {
            const token = await user.getIdToken();
            await axios.delete(`${process.env.NEXT_PUBLIC_AWS_API_URL}/v2/downloads/${item.id}`, { headers: { Authorization: token } });
            toast({ title: "Deleted", description: "Track removed from library" });
            await refreshLibrary();
        } catch {
            toast({ title: "Error", description: "Failed to delete track.", variant: "destructive" });
        } finally {
            setDeletingTracks(prev => { const next = new Set(prev); next.delete(item.id); return next; });
        }
    };

    const handleDeleteArtist = async (artist: ArtistGroup) => {
        if (!user) return;
        setDeletingArtist(artist.name);
        try {
            const token = await user.getIdToken();
            const items = Object.values(artist.albums).flatMap(album =>
                [...album.tracks, album.zipDownload].filter(Boolean) as LibraryItem[]
            );
            await Promise.all(items.map(item =>
                axios.delete(`${process.env.NEXT_PUBLIC_AWS_API_URL}/v2/downloads/${item.id}`, { headers: { Authorization: token } })
            ));
            toast({ title: "Deleted", description: `All downloads for "${artist.name}" deleted.` });
            await refreshLibrary();
        } catch {
            toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
        } finally {
            setDeletingArtist(null);
        }
    };

    const handleDeleteAll = async () => {
        if (!user) return;
        setDeletingAll(true);
        try {
            const token = await user.getIdToken();
            await Promise.all(libraryItems.map(item =>
                axios.delete(`${process.env.NEXT_PUBLIC_AWS_API_URL}/v2/downloads/${item.id}`, { headers: { Authorization: token } })
            ));
            toast({ title: "Library cleared", description: "All downloads have been deleted." });
            await refreshLibrary();
        } catch {
            toast({ title: "Error", description: "Failed to clear library.", variant: "destructive" });
        } finally {
            setDeletingAll(false);
        }
    };

    // Download handler: fetch signed URL on-demand, then trigger browser download
    const [downloadingItems, setDownloadingItems] = useState<Set<string>>(new Set());
    
    const handleDownload = useCallback(async (item: LibraryItem) => {
        if (!user || downloadingItems.has(item.id)) return;

        try {
            setDownloadingItems(prev => new Set(prev).add(item.id));
            const token = await user.getIdToken();

            // Try to get the file if it's still on R2
            try {
                const response = await axios.post(
                    `/api/v2/downloads/${item.id}/url`,
                    {},
                    { headers: { Authorization: token } }
                );
                const { downloadUrl, fileName } = response.data;
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = fileName || item.fileName || 'download';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                return;
            } catch (urlError: any) {
                if (urlError.response?.status !== 410) throw urlError;
            }

            // File expired — re-download from Qobuz
            onClose();

            const isTrack = item.type === 'track';
            const artistName = typeof item.metadata.artistName === 'object'
                ? (item.metadata.artistName as any).display || 'Unknown Artist'
                : item.metadata.artistName || 'Unknown Artist';
            const albumTitle = item.metadata.albumTitle || item.metadata.title || 'Unknown Album';
            const coverUrl = typeof item.metadata.image === 'string'
                ? item.metadata.image
                : (item.metadata.image as any)?.large || (item.metadata.image as any)?.medium || '';

            const quality = parseInt(settings.outputQuality || '27', 10);
            const format = settings.outputCodec || 'FLAC';

            const request = {
                albumId: String(item.metadata.albumId || (isTrack ? '' : item.metadata.id) || ''),
                trackId: isTrack ? String(item.metadata.id) : undefined,
                albumTitle,
                artistName,
                artistId: String(item.metadata.artistId || ''),
                coverUrl,
                tracksCount: isTrack ? 1 : 0,
                quality,
                format,
                bitrate: settings.bitrate,
                embedLyrics: settings.embedLyrics !== false,
                lyricsMode: settings.lyricsMode === 'sidecar' ? 'sidecar' : 'embed',
                country,
            };

            setStatusBar(prev => ({
                ...prev,
                open: true,
                processing: true,
                title: `${artistName} - ${albumTitle}`,
                description: 'Re-downloading...',
                progress: 0,
            }));

            toast({ title: 'Re-downloading', description: `${artistName} - ${albumTitle}` });

            const { data: session } = await supabase.auth.getSession();
            const authToken = session.session?.access_token;
            const { id: jobId, accessToken } = await createDownloadV2(request as any, authToken);

            const finalStatus = await waitForDownloadV2(
                jobId,
                (status: DownloadStatusV2) => {
                    setStatusBar(prev => ({ ...prev, description: status.description, progress: status.progress }));
                },
                undefined,
                { authToken, accessToken }
            );

            if (finalStatus.fileName) {
                try {
                    const freshUrl = await getDownloadUrlV2(jobId, { authToken, accessToken });
                    downloadFile(freshUrl.downloadUrl, finalStatus.fileName);
                } catch { /* fall through */ }
            }

            setStatusBar(prev => ({ ...prev, description: 'Done!', progress: 100, processing: false }));
            toast({ title: 'Download complete!', description: `${artistName} - ${albumTitle}` });
            setTimeout(() => setStatusBar(prev => ({ ...prev, open: false })), 3000);
            refreshLibrary();
        } catch (error: any) {
            if (error.response?.status === 429) {
                toast({ title: "Rate limit reached", description: "Too many downloads. Try again later.", variant: 'destructive' });
            } else {
                toast({ title: "Download failed", description: error.response?.data?.error || "Failed to download", variant: 'destructive' });
            }
        } finally {
            setDownloadingItems(prev => {
                const newSet = new Set(prev);
                newSet.delete(item.id);
                return newSet;
            });
        }
    }, [user, downloadingItems, toast, onClose, setStatusBar, settings, country, refreshLibrary]);

    // Memoized extract colors function
    const extractColors = useCallback((imageUrl: string): Promise<string[]> => {
        return new Promise((resolve) => {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316']);
                    return;
                }
                canvas.width = 50;
                canvas.height = 50;
                ctx.drawImage(img, 0, 0, 50, 50);
                const imageData = ctx.getImageData(0, 0, 50, 50).data;

                const colors: { [key: string]: number } = {};
                for (let i = 0; i < imageData.length; i += 16) {
                    const r = imageData[i];
                    const g = imageData[i + 1];
                    const b = imageData[i + 2];
                    if ((r + g + b) < 60 || (r + g + b) > 700) continue;
                    const color = `rgb(${Math.round(r / 32) * 32}, ${Math.round(g / 32) * 32}, ${Math.round(b / 32) * 32})`;
                    colors[color] = (colors[color] || 0) + 1;
                }

                const sorted = Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 6).map(c => c[0]);
                resolve(sorted.length > 0 ? sorted : ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316']);
            };
            img.onerror = () => {
                resolve(['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316']);
            };
            img.src = imageUrl;
        });
    }, []);

    const ParticleEffect = memo(({ isActive, imageUrl }: { isActive: boolean; imageUrl?: string }) => {
        const [colors, setColors] = useState<string[]>(['#6366f1', '#8b5cf6', '#ec4899']);
        const particles = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: Math.random() * 8 + 3,
            delay: Math.random() * 0.4,
            duration: 0.6 + Math.random() * 0.4,
            colorIndex: Math.floor(Math.random() * 6),
            velocityX: (Math.random() - 0.5) * 60,
            velocityY: -40 - Math.random() * 50,
        })), []);

        useEffect(() => {
            if (isActive && imageUrl) {
                extractColors(imageUrl).then(setColors);
            }
        }, [isActive, imageUrl]);

        if (!isActive) return null;

        return (
            <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
                {particles.map((particle) => (
                    <motion.div
                        key={particle.id}
                        className="absolute rounded-full"
                        style={{
                            left: `${particle.x}%`,
                            top: `${particle.y}%`,
                            width: particle.size,
                            height: particle.size,
                            backgroundColor: colors[particle.colorIndex % colors.length],
                            boxShadow: `0 0 ${particle.size}px ${colors[particle.colorIndex % colors.length]}`,
                        }}
                        initial={{ opacity: 1, scale: 1, y: 0, x: 0 }}
                        animate={{
                            opacity: 0,
                            scale: 0.3,
                            y: particle.velocityY,
                            x: particle.velocityX,
                        }}
                        transition={{
                            duration: particle.duration,
                            delay: particle.delay,
                            ease: "easeOut",
                        }}
                    />
                ))}
            </div>
        );
    });

    ParticleEffect.displayName = 'ParticleEffect';

    const totalAlbums = Object.values(history).reduce((acc, artist) => acc + Object.keys(artist.albums).length, 0);
    const overlayVariants = {
        initial: { opacity: 0, backdropFilter: 'blur(0px)' },
        open: {
            opacity: 1,
            backdropFilter: 'blur(12px)',
            transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const }
        },
        closed: {
            opacity: 0,
            backdropFilter: 'blur(0px)',
            transition: { duration: 0.24, ease: [0.4, 0, 1, 1] as const }
        }
    };
    const drawerVariants = {
        initial: { x: 88, opacity: 0, scale: 0.965, rotateY: -7, filter: 'blur(14px)' },
        open: {
            x: 0,
            opacity: 1,
            scale: 1,
            rotateY: 0,
            filter: 'blur(0px)',
            transition: { duration: 0.42, ease: [0.16, 1, 0.3, 1] as const }
        },
        closed: {
            x: 64,
            opacity: 0,
            scale: 0.978,
            rotateY: -5,
            filter: 'blur(10px)',
            transition: { duration: 0.28, ease: [0.4, 0, 1, 1] as const }
        }
    };

    // Show loading only on first-ever load (no cached data)
    const showLoading = isFreshLoad && libraryLoading;

    if (!user) return null;

    return (
        <AnimatePresence mode="wait">
            {isOpen && (
                <>
                    <motion.div
                        initial="initial"
                        animate="open"
                        exit="closed"
                        variants={overlayVariants}
                        className="fixed inset-0 bg-black/45 backdrop-blur-md z-[100]"
                        onClick={onClose}
                    />
                    <motion.div
                        initial="initial"
                        animate="open"
                        exit="closed"
                        variants={drawerVariants}
                        style={{ transformPerspective: 1800, willChange: 'transform, opacity, filter' }}
                        className="fixed right-0 top-0 h-full w-full max-w-2xl origin-right overflow-hidden bg-background/95 backdrop-blur-xl border-l border-border/50 shadow-[0_28px_120px_-28px_rgba(0,0,0,0.75)] z-[101] flex flex-col"
                    >
                        <div className="pointer-events-none absolute inset-0 z-0" style={{ background: 'radial-gradient(circle at top left, hsl(var(--primary) / 0.14), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.045), transparent 22%)' }} />

                        <div className="relative z-10 flex h-full flex-col">
                            {/* HEADER */}
                            <div className="flex items-center justify-between p-6 border-b border-border/50">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-primary/10">
                                        <Album className="h-6 w-6 text-primary" />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold tracking-tight">Library</h2>
                                        <p className="text-sm text-muted-foreground">{totalAlbums} album{totalAlbums !== 1 ? 's' : ''} • {Object.keys(history).length} artist{Object.keys(history).length !== 1 ? 's' : ''}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {libraryItems.length > 0 && (
                                        <Button variant="ghost" size="sm" onClick={handleDeleteAll} disabled={deletingAll} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors gap-1.5 text-xs">
                                            {deletingAll ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                            Clear all
                                        </Button>
                                    )}
                                    <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors"><X className="h-5 w-5" /></Button>
                                </div>
                            </div>

                            <ScrollArea className="flex-1">
                                {showLoading ? (
                                    <div className="flex flex-col items-center justify-center py-20 gap-3"><Loader2 className="animate-spin h-8 w-8 text-primary" /><p className="text-sm text-muted-foreground">Loading your library...</p></div>
                                ) : Object.keys(history).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 gap-4"><div className="p-4 rounded-full bg-muted/50"><Music className="w-12 h-12 text-muted-foreground/50" /></div><div className="text-center"><p className="text-lg font-medium">No downloads yet</p><p className="text-sm text-muted-foreground">Your downloaded music will appear here</p></div></div>
                                ) : (
                                    <div className="p-4 space-y-2">
                                        {Object.values(history).map((artist, artistIndex) => (
                                            <motion.div key={artist.name} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: artistIndex * 0.05 }} className="rounded-xl overflow-hidden">
                                                <div className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 rounded-xl transition-colors group">
                                                    <button onClick={() => setExpandedArtist(expandedArtist === artist.name ? null : artist.name)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                                                        {(() => {
                                                            const artistLookupKey = getArtistLookupKey(artist);
                                                            const artistImage = artistLookupKey ? artistImages[artistLookupKey] : null;
                                                            return (
                                                                <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors overflow-hidden shrink-0">
                                                                    {artistImage ? (
                                                                        <Image src={artistImage} alt={artist.name} fill className="object-cover" unoptimized />
                                                                    ) : (
                                                                        <Music className="w-5 h-5 text-primary" />
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                        <div className="flex-1 min-w-0"><p className="font-semibold truncate">{artist.name}</p><p className="text-xs text-muted-foreground">{Object.keys(artist.albums).length} album{Object.keys(artist.albums).length !== 1 ? 's' : ''}</p></div>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteArtist(artist)}
                                                        disabled={deletingArtist === artist.name}
                                                        className="p-1.5 rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all shrink-0"
                                                        title="Delete artist"
                                                    >
                                                        {deletingArtist === artist.name ? <Loader className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                                    </button>
                                                    <ChevronRight onClick={() => setExpandedArtist(expandedArtist === artist.name ? null : artist.name)} className={`w-5 h-5 text-muted-foreground transition-transform duration-200 cursor-pointer shrink-0 ${expandedArtist === artist.name ? 'rotate-90' : ''}`} />
                                                </div>
                                                <AnimatePresence>
                                                    {expandedArtist === artist.name && (
                                                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                                            <div className="pl-4 pr-2 py-2 space-y-2">
                                                                {Object.values(artist.albums).map((album, albumIndex) => {
                                                                    const albumKey = `${artist.name}-${album.title}`;
                                                                    const isDeleting = deletingAlbums.has(albumKey);
                                                                    const isConfirming = confirmingDelete?.key === albumKey;
                                                                    const canExpand = album.tracks.length > 0;
                                                                    const isAlbumExpanded = expandedAlbum === albumKey;
                                                                    return (
                                                                        <motion.div key={album.title} initial={{ opacity: 0, x: -10 }} animate={{ opacity: isDeleting ? 0 : 1, x: 0, scale: isDeleting ? 0.8 : 1, filter: isDeleting ? 'blur(4px)' : 'blur(0px)' }} transition={{ delay: isDeleting ? 0 : albumIndex * 0.03, duration: isDeleting ? 0.6 : 0.2 }} className="rounded-lg hover:bg-muted/50 transition-all relative overflow-hidden" data-confirm-container>
                                                                            <div className="flex items-stretch">
                                                                                <motion.div className="group flex items-center gap-3 p-2 flex-1 min-w-0" animate={{ x: isConfirming ? -100 : 0, opacity: isConfirming ? 0.5 : 1 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
                                                                                    <ParticleEffect isActive={isDeleting} imageUrl={album.image} />
                                                                                    <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-muted/50 flex-shrink-0 shadow-sm">{album.image ? <Image src={album.image} alt={album.title} fill className="object-cover group-hover:scale-105 transition-transform duration-300" unoptimized /> : <div className="w-full h-full flex items-center justify-center"><Disc className="w-6 h-6 text-muted-foreground/30" /></div>}</div>
                                                                                    <div
                                                                                        className={`flex-1 min-w-0 ${canExpand ? 'cursor-pointer' : ''}`}
                                                                                        onClick={() => canExpand && setExpandedAlbum(isAlbumExpanded ? null : albumKey)}
                                                                                    >
                                                                                        <p className="font-medium truncate text-sm">{album.title}</p>
                                                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Calendar className="w-3 h-3" /><span>{new Date(album.lastDownloaded).toLocaleDateString()}</span><span>•</span><span>{album.zipDownload ? 'Album' : `${album.tracks.length} tracks`}</span></div>
                                                                                    </div>
                                                                                    <div className={`flex items-center gap-1 transition-opacity ${isConfirming ? 'opacity-0' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}>
                                                                                        {(() => {
                                                                                            const downloadItem = album.zipDownload || album.tracks[0];
                                                                                            if (!downloadItem) return null;
                                                                                            const isDownloading = downloadingItems.has(downloadItem.id);
                                                                                            return (
                                                                                                <Button
                                                                                                    size="icon"
                                                                                                    variant="ghost"
                                                                                                    className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                                                                                                    onClick={(e) => { e.stopPropagation(); handleDownload(downloadItem); }}
                                                                                                    disabled={isDownloading}
                                                                                                    title="Download"
                                                                                                >
                                                                                                    {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                                                                                </Button>
                                                                                            );
                                                                                        })()}
                                                                                        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full hover:bg-destructive/10 hover:text-destructive" onClick={() => { const allItems = [...album.tracks, album.zipDownload].filter(Boolean) as LibraryItem[]; requestDelete(allItems, albumKey); }} title="Delete"><Trash2 className="w-4 h-4" /></Button>
                                                                                    </div>
                                                                                    {canExpand && (
                                                                                        <ChevronRight onClick={() => setExpandedAlbum(isAlbumExpanded ? null : albumKey)} className={`w-4 h-4 text-muted-foreground/60 transition-transform duration-200 cursor-pointer shrink-0 ${isAlbumExpanded ? 'rotate-90' : ''}`} />
                                                                                    )}
                                                                                </motion.div>
                                                                                <motion.div className="flex items-center bg-destructive text-destructive-foreground overflow-hidden" initial={{ width: 0 }} animate={{ width: isConfirming ? 'auto' : 0 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
                                                                                    <button onClick={(e) => { e.stopPropagation(); confirmDelete(); }} className="h-full px-6 flex items-center justify-center font-medium text-sm whitespace-nowrap hover:bg-red-600 transition-colors">Delete</button>
                                                                                </motion.div>
                                                                            </div>
                                                                            <AnimatePresence>
                                                                                {isAlbumExpanded && canExpand && (
                                                                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                                                                        <div className="pl-[72px] pr-2 pb-2 space-y-1">
                                                                                            {album.tracks.map((track) => {
                                                                                                const isTrackDeleting = deletingTracks.has(track.id);
                                                                                                const isTrackDownloading = downloadingItems.has(track.id);
                                                                                                const trackTitle = track.metadata.title || 'Unknown Track';
                                                                                                return (
                                                                                                    <motion.div
                                                                                                        key={track.id}
                                                                                                        initial={{ opacity: 1 }}
                                                                                                        animate={{ opacity: isTrackDeleting ? 0 : 1, scale: isTrackDeleting ? 0.9 : 1 }}
                                                                                                        className="group/track flex items-center gap-2 p-2 rounded-md hover:bg-muted/40 transition-colors"
                                                                                                    >
                                                                                                        <Music className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                                                                                                        <p className="flex-1 text-xs truncate">{trackTitle}</p>
                                                                                                        <div className="flex items-center gap-1 opacity-0 group-hover/track:opacity-100 transition-opacity">
                                                                                                            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full hover:bg-primary/10 hover:text-primary" onClick={() => handleDownload(track)} disabled={isTrackDownloading} title="Download track">
                                                                                                                {isTrackDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                                                                                            </Button>
                                                                                                            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDeleteTrack(track)} disabled={isTrackDeleting} title="Delete track">
                                                                                                                {isTrackDeleting ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                                                                            </Button>
                                                                                                        </div>
                                                                                                    </motion.div>
                                                                                                );
                                                                                            })}
                                                                                        </div>
                                                                                    </motion.div>
                                                                                )}
                                                                            </AnimatePresence>
                                                                        </motion.div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </motion.div>
                                        ))}
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
