'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { useAuth } from '@/components/auth-provider';
import axios from 'axios';

export interface LibraryItem {
    id: string;
    fileName: string;
    url: string | null;
    metadata: {
        id: string | number; // Qobuz ID
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

interface LibraryContextType {
    libraryItems: LibraryItem[];
    isLoading: boolean;
    isFreshLoad: boolean;
    isInLibrary: (qobuzId: string | number) => boolean;
    getLibraryItem: (qobuzId: string | number) => LibraryItem | undefined;
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

    // Retries on 401 since Amplify might not have restored the session yet after a refresh
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

            let lastError: any = null;

            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const token = await user.getIdToken();

                    // If token is empty, Amplify isn't ready yet — wait and retry
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
                        const items: LibraryItem[] = response.data.items.map((item: any) => ({
                            id: item.id,
                            fileName: item.fileName || 'download',
                            url: item.url,
                            metadata: {
                                id: item.metadata?.id || 0,
                                title: item.metadata?.title || 'Unknown',
                                albumTitle: item.metadata?.title,
                                artistName: item.metadata?.artistName || 'Unknown',
                                artistId: item.metadata?.artistId,
                                image: item.metadata?.image
                            },
                            type: item.type || 'album',
                            source: 'qobuz',
                            fileSize: item.fileSize,
                            notSaved: !item.url,
                            createdAt: item.createdAt
                        }));

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
                    lastError = error;
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
    const isInLibrary = useCallback((qobuzId: string | number): boolean => {
        const idStr = String(qobuzId);
        return libraryItems.some(item =>
            String(item.metadata?.id) === idStr &&
            item.url !== null &&
            !item.notSaved
        );
    }, [libraryItems]);

    // Find a library item by its ID
    const getLibraryItem = useCallback((qobuzId: string | number): LibraryItem | undefined => {
        const idStr = String(qobuzId);
        return libraryItems.find(item =>
            String(item.metadata?.id) === idStr &&
            item.url !== null &&
            !item.notSaved
        );
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
