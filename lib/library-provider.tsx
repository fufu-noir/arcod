'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { useAuth } from '@/components/auth-provider';
import axios from 'axios';

export interface LibraryItem {
    id: string;
    fileName: string;
    url: string | null;
    hasFile?: boolean; // File exists on S3, but URL must be requested on-demand
    metadata: {
        id: string | number; // Qobuz ID (trackId for tracks, albumId for albums)
        albumId?: string | number;
        title: string;
        albumTitle?: string;
        artistName: string;
        artistId?: string;
        image?: string;
    };
    type: 'track' | 'album';
    source: string;
    fileSize?: number;
    notSaved?: boolean;
    createdAt: any;
}

export interface LibraryLookupHints {
    title?: string;
    artistName?: string;
    type?: 'track' | 'album';
}

interface LibraryContextType {
    libraryItems: LibraryItem[];
    isLoading: boolean;
    isFreshLoad: boolean;
    isInLibrary: (qobuzId: string | number, hints?: LibraryLookupHints) => boolean;
    getLibraryItem: (qobuzId: string | number, hints?: LibraryLookupHints) => LibraryItem | undefined;
    refreshLibrary: () => Promise<void>;
}

const LibraryContext = createContext<LibraryContextType | null>(null);

export const useLibrary = () => {
    const context = useContext(LibraryContext);
    if (!context) {
        throw new Error('useLibrary must be used within a LibraryProvider');
    }
    return context;
};

// Cache duration: 2 minutes
const CACHE_DURATION_MS = 2 * 60 * 1000;

function hasLibraryFile(item: LibraryItem): boolean {
    return true;
}

function normalizeLibraryText(value: string | undefined): string {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\b(feat|featuring|ft|with|and|x)\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function findLibraryItem(
    libraryItems: LibraryItem[],
    qobuzId: string | number,
    hints?: LibraryLookupHints
): LibraryItem | undefined {
    const idStr = String(qobuzId);

    const exactMatch = libraryItems.find((item) =>
        String(item.metadata?.id) === idStr &&
        hasLibraryFile(item)
    );

    if (exactMatch || !hints?.title) {
        return exactMatch;
    }

    const normalizedTitle = normalizeLibraryText(hints.title);
    const normalizedArtist = normalizeLibraryText(hints.artistName);

    return libraryItems.find((item) => {
        if (!hasLibraryFile(item)) return false;
        if (hints.type && item.type !== hints.type) return false;

        const itemTitles = [item.metadata?.title, item.metadata?.albumTitle]
            .map((title) => normalizeLibraryText(title))
            .filter(Boolean);

        if (!itemTitles.includes(normalizedTitle)) {
            return false;
        }

        if (!normalizedArtist) {
            return true;
        }

        return normalizeLibraryText(item.metadata?.artistName) === normalizedArtist;
    });
}

export const LibraryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFreshLoad, setIsFreshLoad] = useState(true);
    const { user } = useAuth();

    // refs to avoid re-creating callbacks
    const fetchInProgress = useRef(false);
    const lastFetchedAt = useRef<number | null>(null);
    const hasItems = useRef(false);
    const prevUserId = useRef<string | null>(null);

    // Retries on 401 since Supabase might not have restored the session yet after a refresh
    const fetchLibrary = useCallback(async (forceRefresh = false) => {
        if (!user) {
            setLibraryItems([]);
            setIsLoading(false);
            setIsFreshLoad(false);
            hasItems.current = false;
            return;
        }

        // Guest users don't have a library
        if (user.isGuest) {
            setIsLoading(false);
            setIsFreshLoad(false);
            return;
        }

        // Prevent concurrent fetches
        if (fetchInProgress.current) return;

        // Skip fetch if data is fresh and not forced
        if (!forceRefresh && lastFetchedAt.current && (Date.now() - lastFetchedAt.current < CACHE_DURATION_MS)) {
            return;
        }

        const MAX_RETRIES = 2;

        try {
            fetchInProgress.current = true;
            // Only show loading spinner if we have NO cached data
            if (!hasItems.current) {
                setIsLoading(true);
            }

            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const token = await user.getIdToken();

                    // If token is empty, auth isn't ready yet — wait and retry
                    if (!token) {
                        if (attempt < MAX_RETRIES) {
                            console.log(`[Library] Empty token, retrying in 1.5s (attempt ${attempt + 1}/${MAX_RETRIES})`);
                            await new Promise(r => setTimeout(r, 1500));
                            continue;
                        }
                        throw new Error('Could not get auth token');
                    }

                    // Single call to V2 endpoint — it already merges V2 + legacy data server-side
                    const response = await axios.get(`${process.env.NEXT_PUBLIC_AWS_API_URL}/v2/downloads`, {
                        headers: { Authorization: token }
                    });

                    if (response.data.success) {
                        const rawItems = response.data.downloads || response.data.items || [];
                        const items: LibraryItem[] = rawItems.map((item: any) => {
                            const resolvedUrl = item.url || item.downloadUrl || null;
                            const hasFile = !!(item.hasFile || item.fileName || resolvedUrl);
                            const type = item.type || (item.trackId ? 'track' : 'album');

                            return {
                                id: item.id,
                                fileName: item.fileName || 'download',
                                url: resolvedUrl,
                                hasFile,
                                metadata: {
                                    id: item.metadata?.id || item.trackId || item.albumId || item.qobuzId || item.id || 0,
                                    albumId: item.albumId,
                                    title: item.metadata?.title || item.trackName || item.albumTitle || 'Unknown',
                                    albumTitle: item.metadata?.albumTitle || item.albumTitle,
                                    artistName: item.metadata?.artistName || item.artistName || 'Unknown',
                                    artistId: item.metadata?.artistId || item.artistId,
                                    image: item.metadata?.image || item.coverUrl
                                },
                                type,
                                source: 'qobuz',
                                fileSize: item.fileSize,
                                notSaved: item.notSaved ?? !hasFile,
                                createdAt: item.createdAt
                            };
                        });

                        // Sort by createdAt descending
                        items.sort((a, b) => {
                            const dateA = new Date(a.createdAt || 0).getTime();
                            const dateB = new Date(b.createdAt || 0).getTime();
                            return dateB - dateA;
                        });

                        setLibraryItems(items);
                        hasItems.current = items.length > 0;
                        lastFetchedAt.current = Date.now();
                    }

                    // Success — break out of retry loop
                    break;

                } catch (error: any) {
                    const status = error?.response?.status;

                    // Retry on 401 (token not ready) or network errors
                    if (attempt < MAX_RETRIES && (status === 401 || !status)) {
                        console.log(`[Library] Fetch failed (${status || 'network'}), retrying in 1.5s (attempt ${attempt + 1}/${MAX_RETRIES})`);
                        await new Promise(r => setTimeout(r, 1500));
                        continue;
                    }

                    throw error;
                }
            }
        } catch (error) {
            console.error('Error fetching library from AWS:', error);
        } finally {
            setIsLoading(false);
            setIsFreshLoad(false);
            fetchInProgress.current = false;
        }
    }, [user]);

    // Re-fetch when user changes
    useEffect(() => {
        const currentUserId = user?.uid || null;
        if (currentUserId !== prevUserId.current) {
            prevUserId.current = currentUserId;
            // Reset on user change
            hasItems.current = false;
            lastFetchedAt.current = null;
            setLibraryItems([]);
            setIsFreshLoad(true);
            if (currentUserId) {
                fetchLibrary(true);
            }
        }
    }, [user, fetchLibrary]);

    // Check if an item exists in the library
    const isInLibrary = useCallback((qobuzId: string | number, hints?: LibraryLookupHints): boolean => {
        return !!findLibraryItem(libraryItems, qobuzId, hints);
    }, [libraryItems]);

    // Find a library item by its ID
    const getLibraryItem = useCallback((qobuzId: string | number, hints?: LibraryLookupHints): LibraryItem | undefined => {
        return findLibraryItem(libraryItems, qobuzId, hints);
    }, [libraryItems]);

    const refreshLibrary = useCallback(async () => {
        await fetchLibrary(true);
    }, [fetchLibrary]);

    return (
        <LibraryContext.Provider value={{
            libraryItems,
            isLoading,
            isFreshLoad,
            isInLibrary,
            getLibraryItem,
            refreshLibrary
        }}>
            {children}
        </LibraryContext.Provider>
    );
};
