"use client";
import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Loader2, Download, Music, Disc, Trash2, Loader } from 'lucide-react';
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

    const history = useMemo(() => groupItemsByArtistAlbum(libraryItems), [libraryItems]);

    useEffect(() => {
        if (user) {
            refreshLibrary();
        }
    }, [user, refreshLibrary]);

    const [deletingArtist, setDeletingArtist] = useState<string | null>(null);
    const [deletingAll, setDeletingAll] = useState(false);

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

            await refreshLibrary();
        } catch (error: any) {
            console.error("Error deleting item:", error);
            toast({
                title: "Error",
                description: error.response?.data?.error || "Failed to delete item.",
                variant: "destructive"
            });
        }
    };

    const handleDeleteArtist = async (artist: ArtistGroup) => {
        if (!user) return;
        if (!confirm(`Delete all downloads for "${artist.name}"?`)) return;
        setDeletingArtist(artist.name);
        try {
            const token = await user.getIdToken();
            const items = Object.values(artist.albums).flatMap(album =>
                [...album.tracks, album.zipDownload].filter(Boolean) as LibraryItem[]
            );
            await Promise.all(items.map(item =>
                axios.delete(`${process.env.NEXT_PUBLIC_AWS_API_URL}/v2/downloads/${item.id}`, {
                    headers: { Authorization: token }
                })
            ));
            toast({ title: "Deleted", description: `All downloads for "${artist.name}" deleted.` });
            await refreshLibrary();
        } catch (error: any) {
            toast({ title: "Error", description: error.response?.data?.error || "Failed to delete.", variant: "destructive" });
        } finally {
            setDeletingArtist(null);
        }
    };

    const handleDeleteAll = async () => {
        if (!user) return;
        if (!confirm(`Delete your entire library? This cannot be undone.`)) return;
        setDeletingAll(true);
        try {
            const token = await user.getIdToken();
            await Promise.all(libraryItems.map(item =>
                axios.delete(`${process.env.NEXT_PUBLIC_AWS_API_URL}/v2/downloads/${item.id}`, {
                    headers: { Authorization: token }
                })
            ));
            toast({ title: "Library cleared", description: "All downloads have been deleted." });
            await refreshLibrary();
        } catch (error: any) {
            toast({ title: "Error", description: error.response?.data?.error || "Failed to delete.", variant: "destructive" });
        } finally {
            setDeletingAll(false);
        }
    };

    if (!user) return null;

    const loading = isFreshLoad && libraryLoading;

    return (
        <div className="container mx-auto max-w-7xl py-10 px-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-10">
                <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">Library & History</h1>
                {Object.keys(history).length > 0 && (
                    <Button
                        variant="destructive"
                        onClick={handleDeleteAll}
                        disabled={deletingAll}
                        className="flex items-center gap-2 shrink-0"
                    >
                        {deletingAll ? <Loader className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        Clear entire library
                    </Button>
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
                            <div className="flex items-center justify-between border-b-2 border-primary/20 pb-3">
                                <h2 className="text-3xl font-bold flex items-center gap-3 text-foreground">
                                    <Music className="w-7 h-7 text-primary" />
                                    {artist.name}
                                </h2>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteArtist(artist)}
                                    disabled={deletingArtist === artist.name}
                                    className="flex items-center gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                    {deletingArtist === artist.name
                                        ? <Loader className="w-4 h-4 animate-spin" />
                                        : <Trash2 className="w-4 h-4" />
                                    }
                                    Delete artist
                                </Button>
                            </div>

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

                                            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col items-center justify-center p-6 gap-4">
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

                                                <p className="text-white text-sm font-medium text-center">{album.title}</p>
                                                <p className="text-white/70 text-xs text-center">{album.artist}</p>
                                            </div>
                                        </div>

                                        <div className="p-4">
                                            <p className="font-semibold truncate text-sm">{album.title}</p>
                                            <p className="text-xs text-muted-foreground truncate">{album.artist}</p>
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
