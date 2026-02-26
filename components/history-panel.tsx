"use client";
import React, { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Loader2, Download, Music, Disc, Trash2, X, ChevronRight, Calendar, Album } from 'lucide-react';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'motion/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import axios from 'axios';
import { getLibraryStorageInfo, type StorageInfo } from '@/lib/cloud-download-job';
import { Progress } from '@/components/ui/progress';
import { HardDrive, AlertTriangle } from 'lucide-react';
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
    const [expandedArtist, setExpandedArtist] = useState<string | null>(null);
    const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
    const [storageLoading, setStorageLoading] = useState(false);
    const [deletingAlbums, setDeletingAlbums] = useState<Set<string>>(new Set());
    const [confirmingDelete, setConfirmingDelete] = useState<{ key: string; items: LibraryItem[] } | null>(null);
    const [artistImages, setArtistImages] = useState<{ [artistId: string]: string | null }>({});
    const fetchingArtistImages = useRef<Set<string>>(new Set());
    const storageInfoFetched = useRef(false);
    const refreshLibraryRef = useRef(refreshLibrary);
    refreshLibraryRef.current = refreshLibrary;

    // Derive grouped history from shared library data (no extra API call!)
    const history = useMemo(() => groupItemsByArtistAlbum(libraryItems), [libraryItems]);

    // When the panel opens, trigger a background refresh if needed
    // Data shows immediately from cache, refresh happens silently
    useEffect(() => {
        if (isOpen && user) {
            refreshLibraryRef.current();

            // Fetch storage info once per session
            if (!storageInfoFetched.current) {
                storageInfoFetched.current = true;
                setStorageLoading(true);
                getLibraryStorageInfo()
                    .then(info => setStorageInfo(info))
                    .catch(err => console.error('Error fetching storage info:', err))
                    .finally(() => setStorageLoading(false));
            }
        }
    }, [isOpen, user]); // No refreshLibrary dep — use ref to avoid loops

    // Helper to fetch a single artist image
    const fetchSingleArtistImage = useCallback(async (artistId: string) => {
        if (fetchingArtistImages.current.has(artistId)) return;
        fetchingArtistImages.current.add(artistId);

        try {
            const response = await axios.get('/api/get-artist', {
                params: { artist_id: artistId }
            });

            if (response.data.success && response.data.data.artist) {
                const artistData = response.data.data.artist;
                let imageUrl: string | null = null;

                if (artistData.images?.portrait?.hash) {
                    const hash = artistData.images.portrait.hash;
                    const format = artistData.images.portrait.format || 'jpg';
                    imageUrl = `https://static.qobuz.com/images/artists/covers/medium/${hash}.${format}`;
                } else if (artistData.image) {
                    imageUrl = artistData.image.medium || artistData.image.large || artistData.image.small || null;
                }

                setArtistImages(prev => ({ ...prev, [artistId]: imageUrl }));
            } else {
                setArtistImages(prev => ({ ...prev, [artistId]: null }));
            }
        } catch (error) {
            console.error('Error fetching artist image:', error);
            setArtistImages(prev => ({ ...prev, [artistId]: null }));
        } finally {
            fetchingArtistImages.current.delete(artistId);
        }
    }, []);

    // Fetch artist image on expand (immediate, in case pre-fetch didn't cover it)
    useEffect(() => {
        if (!expandedArtist) return;
        const artist = history[expandedArtist];
        if (!artist?.artistId) return;
        // Use functional state check to avoid artistImages in deps
        setArtistImages(prev => {
            if (prev[artist.artistId!] !== undefined) return prev;
            fetchSingleArtistImage(artist.artistId!);
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
        const toFetch = allArtists.filter(a => a.artistId && !fetchingArtistImages.current.has(a.artistId));

        // Batch fetch: 3 concurrent requests at a time
        const batchFetch = async () => {
            for (let i = 0; i < toFetch.length; i += 3) {
                const batch = toFetch.slice(i, i + 3);
                await Promise.allSettled(
                    batch.map(artist => {
                        // Check current state via ref pattern
                        return new Promise<void>((resolve) => {
                            setArtistImages(prev => {
                                if (prev[artist.artistId!] !== undefined) {
                                    resolve();
                                    return prev;
                                }
                                fetchSingleArtistImage(artist.artistId!).then(resolve);
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
            // Refresh the shared library data
            await refreshLibrary();
            // Re-fetch storage info after deletion
            storageInfoFetched.current = false;
            getLibraryStorageInfo().then(info => setStorageInfo(info)).catch(() => { });
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

    // Show loading only on first-ever load (no cached data)
    const showLoading = isFreshLoad && libraryLoading;

    if (!user) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ x: '100%', opacity: 0.5 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: '100%', opacity: 0.5 }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background/95 backdrop-blur-xl border-l border-border/50 shadow-2xl z-[101] flex flex-col"
                    >
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
                            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors"><X className="h-5 w-5" /></Button>
                        </div>

                        {/* Storage Usage Bar */}
                        {storageInfo && (
                            <div className="px-6 py-4 border-b border-border/50">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <HardDrive className={`w-4 h-4 ${storageInfo.percentUsed >= 90 ? 'text-red-500' : storageInfo.percentUsed >= 75 ? 'text-orange-500' : 'text-primary'}`} />
                                        <span className="text-sm font-medium">Storage</span>
                                    </div>
                                    <span className={`text-sm font-semibold ${storageInfo.percentUsed >= 90 ? 'text-red-500' : storageInfo.percentUsed >= 75 ? 'text-orange-500' : 'text-foreground'}`}>
                                        {storageInfo.usedFormatted} / {storageInfo.limitFormatted}
                                    </span>
                                </div>
                                <Progress
                                    value={storageInfo.percentUsed}
                                    className={`h-2 ${storageInfo.percentUsed >= 90 ? '[&>div]:bg-red-500' : storageInfo.percentUsed >= 75 ? '[&>div]:bg-orange-500' : '[&>div]:bg-primary'}`}
                                />
                                {storageInfo.isOverLimit && (
                                    <div className="flex items-center gap-2 mt-2 text-red-500 bg-red-500/10 p-2 rounded-lg">
                                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                        <span className="text-xs font-medium">Library full! Delete some files to free up space.</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <ScrollArea className="flex-1">
                            {showLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-3"><Loader2 className="animate-spin h-8 w-8 text-primary" /><p className="text-sm text-muted-foreground">Loading your library...</p></div>
                            ) : Object.keys(history).length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4"><div className="p-4 rounded-full bg-muted/50"><Music className="w-12 h-12 text-muted-foreground/50" /></div><div className="text-center"><p className="text-lg font-medium">No downloads yet</p><p className="text-sm text-muted-foreground">Your downloaded music will appear here</p></div></div>
                            ) : (
                                <div className="p-4 space-y-2">
                                    {Object.values(history).map((artist, artistIndex) => (
                                        <motion.div key={artist.name} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: artistIndex * 0.05 }} className="rounded-xl overflow-hidden">
                                            <button onClick={() => setExpandedArtist(expandedArtist === artist.name ? null : artist.name)} className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 rounded-xl transition-colors group">
                                                <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors overflow-hidden">
                                                    {artist.artistId && artistImages[artist.artistId] ? (
                                                        <Image
                                                            src={artistImages[artist.artistId]!}
                                                            alt={artist.name}
                                                            fill
                                                            className="object-cover"
                                                            unoptimized
                                                        />
                                                    ) : (
                                                        <Music className="w-5 h-5 text-primary" />
                                                    )}
                                                </div>
                                                <div className="flex-1 text-left"><p className="font-semibold truncate">{artist.name}</p><p className="text-xs text-muted-foreground">{Object.keys(artist.albums).length} album{Object.keys(artist.albums).length !== 1 ? 's' : ''}</p></div>
                                                <ChevronRight className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${expandedArtist === artist.name ? 'rotate-90' : ''}`} />
                                            </button>
                                            <AnimatePresence>
                                                {expandedArtist === artist.name && (
                                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                                        <div className="pl-4 pr-2 py-2 space-y-2">
                                                            {Object.values(artist.albums).map((album, albumIndex) => {
                                                                const albumKey = `${artist.name}-${album.title}`;
                                                                const isDeleting = deletingAlbums.has(albumKey);
                                                                const isConfirming = confirmingDelete?.key === albumKey;
                                                                return (
                                                                    <motion.div key={album.title} initial={{ opacity: 0, x: -10 }} animate={{ opacity: isDeleting ? 0 : 1, x: 0, scale: isDeleting ? 0.8 : 1, filter: isDeleting ? 'blur(4px)' : 'blur(0px)' }} transition={{ delay: isDeleting ? 0 : albumIndex * 0.03, duration: isDeleting ? 0.6 : 0.2 }} className="rounded-lg hover:bg-muted/50 transition-all relative overflow-hidden" data-confirm-container>
                                                                        <div className="flex items-stretch">
                                                                            <motion.div className="group flex items-center gap-3 p-2 flex-1 min-w-0" animate={{ x: isConfirming ? -100 : 0, opacity: isConfirming ? 0.5 : 1 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
                                                                                <ParticleEffect isActive={isDeleting} imageUrl={album.image} />
                                                                                <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-muted/50 flex-shrink-0 shadow-sm">{album.image ? <Image src={album.image} alt={album.title} fill className="object-cover group-hover:scale-105 transition-transform duration-300" unoptimized /> : <div className="w-full h-full flex items-center justify-center"><Disc className="w-6 h-6 text-muted-foreground/30" /></div>}</div>
                                                                                <div className="flex-1 min-w-0"><p className="font-medium truncate text-sm">{album.title}</p><div className="flex items-center gap-2 text-xs text-muted-foreground"><Calendar className="w-3 h-3" /><span>{new Date(album.lastDownloaded).toLocaleDateString()}</span><span>•</span><span>{album.zipDownload ? 'Album' : `${album.tracks.length} tracks`}</span></div></div>
                                                                                <div className={`flex items-center gap-1 transition-opacity ${isConfirming ? 'opacity-0' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}>
                                                                                    {/* Download button: show for album ZIP or for first track with URL */}
                                                                                    {(album.zipDownload?.url || album.tracks.find(t => t.url)) && (
                                                                                        <Button asChild size="icon" variant="ghost" className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary">
                                                                                            <a href={album.zipDownload?.url || album.tracks.find(t => t.url)?.url || '#'} download title="Download">
                                                                                                <Download className="w-4 h-4" />
                                                                                            </a>
                                                                                        </Button>
                                                                                    )}
                                                                                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full hover:bg-destructive/10 hover:text-destructive" onClick={() => { const allItems = [...album.tracks, album.zipDownload].filter(Boolean) as LibraryItem[]; requestDelete(allItems, albumKey); }} title="Delete"><Trash2 className="w-4 h-4" /></Button>
                                                                                </div>
                                                                            </motion.div>
                                                                            <motion.div className="flex items-center bg-destructive text-destructive-foreground overflow-hidden" initial={{ width: 0 }} animate={{ width: isConfirming ? 'auto' : 0 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
                                                                                <button onClick={(e) => { e.stopPropagation(); confirmDelete(); }} className="h-full px-6 flex items-center justify-center font-medium text-sm whitespace-nowrap hover:bg-red-600 transition-colors">Delete</button>
                                                                            </motion.div>
                                                                        </div>
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
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
