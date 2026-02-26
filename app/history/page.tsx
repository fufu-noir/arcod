"use client";
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Loader2, Download, Music, Disc, Trash2, AlertTriangle, HardDrive } from 'lucide-react';
import { StorageInfo, getLibraryStorageInfo } from '@/lib/cloud-download-job';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { useLibrary, type LibraryItem } from '@/lib/library-provider';
import axios from 'axios';

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
    albums: { [key: string]: AlbumGroup };
}

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

        if (!grouped[artistName]) {
            grouped[artistName] = { name: artistName, albums: {} };
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

export default function HistoryPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const { libraryItems, isLoading: libraryLoading, isFreshLoad, refreshLibrary } = useLibrary();
    const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);

    // Derive grouped history from shared library data
    const history = useMemo(() => groupItemsByArtistAlbum(libraryItems), [libraryItems]);

    useEffect(() => {
        if (user) {
            refreshLibrary();
            getLibraryStorageInfo().then(setStorageInfo).catch(() => { });
        }
    }, [user, refreshLibrary]);

    const handleDelete = async (items: LibraryItem[], type: 'album' | 'track') => {
        if (!user) return;
        if (!confirm(`Are you sure you want to delete ${type === 'album' ? 'this album' : 'this track'}?`)) return;

        try {
            const token = await user.getIdToken();
            const deletePromises = items.map(item =>
                axios.delete(`${process.env.NEXT_PUBLIC_AWS_API_URL}/v2/downloads/${item.id}`, {
                    headers: { Authorization: token }
                })
            );

            await Promise.all(deletePromises);

            toast({
                title: "Deleted",
                description: `${type === 'album' ? 'Album' : 'Track'} deleted successfully.`,
            });

            // Refresh shared library data
            await refreshLibrary();
            // Re-fetch storage info
            getLibraryStorageInfo().then(setStorageInfo).catch(() => { });
        } catch (error: any) {
            console.error("Error deleting item:", error);
            toast({
                title: "Error",
                description: error.response?.data?.error || "Failed to delete item.",
                variant: "destructive"
            });
        }
    };

    if (!user) return null;

    const loading = isFreshLoad && libraryLoading;

    return (
        <div className="container mx-auto max-w-7xl py-10 px-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-10">
                <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">Library & History</h1>

                {/* Storage Usage Bar */}
                {storageInfo && (
                    <div className="w-full md:w-96 p-5 rounded-2xl bg-card/80 backdrop-blur-xl border border-border/50 shadow-lg">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <HardDrive className={`w-5 h-5 ${storageInfo.percentUsed >= 90 ? 'text-red-500' : storageInfo.percentUsed >= 75 ? 'text-orange-500' : 'text-primary'}`} />
                                <span className="text-sm font-bold">Storage</span>
                            </div>
                            <span className={`text-sm font-bold ${storageInfo.percentUsed >= 90 ? 'text-red-500' : storageInfo.percentUsed >= 75 ? 'text-orange-500' : 'text-foreground'}`}>
                                {storageInfo.usedFormatted} / {storageInfo.limitFormatted}
                            </span>
                        </div>
                        <Progress
                            value={storageInfo.percentUsed}
                            className={`h-2.5 ${storageInfo.percentUsed >= 90 ? '[&>div]:bg-red-500' : storageInfo.percentUsed >= 75 ? '[&>div]:bg-orange-500' : '[&>div]:bg-primary'}`}
                        />
                        {storageInfo.isOverLimit && (
                            <div className="flex items-center gap-2 mt-3 text-red-500 bg-red-500/10 p-2 rounded-lg">
                                <AlertTriangle className="w-4 h-4" />
                                <span className="text-xs font-medium">Storage full! Delete files to free up space.</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin h-10 w-10 text-primary" />
                </div>
            ) : Object.keys(history).length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                    <Music className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="text-xl">Your download history is empty.</p>
                </div>
            ) : (
                <div className="space-y-20">
                    {Object.values(history).map((artist) => (
                        <div key={artist.name} className="space-y-8">
                            <h2 className="text-3xl font-bold border-b-2 border-primary/20 pb-3 flex items-center gap-3 text-foreground">
                                <Music className="w-7 h-7 text-primary" />
                                {artist.name}
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {Object.values(artist.albums).map((album) => (
                                    <div key={album.title} className="group flex flex-col bg-card/80 backdrop-blur-xl rounded-2xl overflow-hidden border border-border/50 shadow-lg hover:shadow-2xl transition-all duration-300 hover:scale-[1.02]">
                                        <div className="aspect-square relative overflow-hidden bg-secondary/30">
                                            {album.image ? (
                                                <Image
                                                    src={album.image}
                                                    alt={album.title}
                                                    fill
                                                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                                                    unoptimized
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <Disc className="w-16 h-16 opacity-10" />
                                                </div>
                                            )}

                                            {/* Overlay Actions */}
                                            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col items-center justify-center p-6 gap-4">

                                                {/* Delete Album Button (Top Right) */}
                                                <div className="absolute top-3 right-3 z-10">
                                                    <Button
                                                        variant="destructive"
                                                        size="icon"
                                                        className="h-9 w-9 rounded-full opacity-90 hover:opacity-100 shadow-lg hover:scale-110 transition-transform"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            const allItems = [...album.tracks, album.zipDownload].filter(Boolean) as LibraryItem[];
                                                            handleDelete(allItems, 'album');
                                                        }}
                                                        title="Delete Album"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>

                                                {album.zipDownload ? (
                                                    album.zipDownload.notSaved ? (
                                                        <div className="w-full flex flex-col items-center gap-2 p-4 rounded-xl bg-orange-500/20 backdrop-blur-sm text-orange-500 border border-orange-500/30">
                                                            <AlertTriangle className="w-8 h-8" />
                                                            <span className="text-sm font-bold text-center">Not saved</span>
                                                            <span className="text-xs text-center opacity-90">Storage full during download</span>
                                                        </div>
                                                    ) : (
                                                        <Button asChild className="w-full gap-2 shadow-lg hover:scale-110 transition-all duration-300 text-base font-semibold" variant="default">
                                                            <a href={album.zipDownload.url!} download>
                                                                <Download className="w-5 h-5" /> Download ZIP
                                                            </a>
                                                        </Button>
                                                    )
                                                ) : (
                                                    <div className="bg-background/95 backdrop-blur-xl text-foreground rounded-xl p-4 w-full max-h-[200px] overflow-y-auto text-xs shadow-2xl border border-border/50">
                                                        <p className="font-bold mb-3 border-b pb-2 text-sm">Included Tracks:</p>
                                                        <div className="space-y-1">
                                                            {album.tracks.map(track => (
                                                                <div key={track.id} className="flex justify-between items-center gap-2 p-1.5 hover:bg-secondary rounded transition-colors group/track">
                                                                    <span className={`truncate flex-1 font-medium ${track.notSaved ? 'text-orange-500' : ''}`}>{track.metadata.title}</span>
                                                                    <div className="flex items-center gap-1 opacity-0 group-hover/track:opacity-100 transition-opacity">
                                                                        {track.notSaved ? (
                                                                            <span className="text-orange-500 text-xs flex items-center gap-1 px-1">
                                                                                <AlertTriangle className="w-3 h-3" />
                                                                                Unavailable
                                                                            </span>
                                                                        ) : (
                                                                            <a href={track.url!} download title="Download Track" className="text-primary hover:text-primary/80 p-1">
                                                                                <Download className="w-3.5 h-3.5" />
                                                                            </a>
                                                                        )}
                                                                        <button
                                                                            onClick={() => handleDelete([track], 'track')}
                                                                            className="text-destructive hover:text-destructive/80 p-1"
                                                                            title="Delete Track"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
