import { LucideIcon } from 'lucide-react';

/**
 * Tidal types - mirrors the Qobuz types for interoperability
 * We normalize Tidal data into the same QobuzAlbum/QobuzTrack/QobuzArtist shapes
 * so the existing UI components (ReleaseCard, etc.) can render them seamlessly.
 */

export type TidalImage = {
    url: string;
    width: number;
    height: number;
};

export type TidalArtistRaw = {
    id: number;
    name: string;
    picture?: string | null;
    artistTypes?: string[];
    url?: string;
};

export type TidalAlbumRaw = {
    id: number;
    title: string;
    duration: number;
    streamReady: boolean;
    streamStartDate?: string;
    allowStreaming: boolean;
    numberOfTracks: number;
    numberOfVolumes: number;
    releaseDate: string;
    copyright?: string;
    type?: string;
    version?: string | null;
    cover: string;
    url?: string;
    explicit: boolean;
    upc?: string;
    audioQuality?: string;
    audioModes?: string[];
    artist: TidalArtistRaw;
    artists: TidalArtistRaw[];
};

export type TidalTrackRaw = {
    id: number;
    title: string;
    duration: number;
    trackNumber: number;
    volumeNumber: number;
    isrc?: string;
    copyright?: string;
    streamReady: boolean;
    version?: string | null;
    explicit: boolean;
    audioQuality?: string;
    audioModes?: string[];
    artist: TidalArtistRaw;
    artists: TidalArtistRaw[];
    album: TidalAlbumRaw;
    url?: string;
};

export type TidalSearchResults = {
    artists: {
        limit: number;
        offset: number;
        totalNumberOfItems: number;
        items: TidalArtistRaw[];
    };
    albums: {
        limit: number;
        offset: number;
        totalNumberOfItems: number;
        items: TidalAlbumRaw[];
    };
    tracks: {
        limit: number;
        offset: number;
        totalNumberOfItems: number;
        items: TidalTrackRaw[];
    };
};

// Tidal cover URL builder
export function getTidalCoverUrl(coverId: string | undefined | null, size: number = 640): string {
    if (!coverId) return '';
    return `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

// Tidal artist image URL builder
export function getTidalArtistImageUrl(pictureId: string | undefined | null, size: number = 640): string {
    if (!pictureId) return '';
    return `https://resources.tidal.com/images/${pictureId.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

/**
 * Normalizes Tidal data into Qobuz-compatible shapes.
 * This lets us reuse the entire UI (ReleaseCard, download buttons, etc.) without changes.
 */
import { QobuzAlbum, QobuzTrack, QobuzArtist, QobuzSearchResults } from './qobuz-dl';

export function normalizeTidalAlbum(album: TidalAlbumRaw): QobuzAlbum {
    const coverUrl = getTidalCoverUrl(album.cover);
    return {
        maximum_bit_depth: album.audioQuality === 'HI_RES' || album.audioQuality === 'HI_RES_LOSSLESS' ? 24 : 16,
        image: {
            small: getTidalCoverUrl(album.cover, 160),
            thumbnail: getTidalCoverUrl(album.cover, 80),
            large: coverUrl,
            back: null
        },
        artist: {
            image: null,
            name: album.artist.name,
            id: album.artist.id,
            albums_count: 0
        },
        artists: album.artists.map((a) => ({
            id: a.id,
            name: a.name,
            roles: a.artistTypes || []
        })),
        released_at: album.releaseDate ? new Date(album.releaseDate).getTime() / 1000 : 0,
        label: { name: '', id: 0, albums_count: 0 },
        title: album.title,
        qobuz_id: 0,
        version: album.version || null,
        duration: album.duration,
        parental_warning: album.explicit,
        tracks_count: album.numberOfTracks,
        genre: { path: [], color: '', name: '', id: 0 },
        id: String(album.id),
        maximum_sampling_rate: album.audioQuality === 'HI_RES' || album.audioQuality === 'HI_RES_LOSSLESS' ? 96 : 44.1,
        release_date_original: album.releaseDate || '',
        hires: album.audioQuality === 'HI_RES' || album.audioQuality === 'HI_RES_LOSSLESS',
        upc: album.upc || '',
        streamable: album.streamReady,
        // Custom marker for Tidal source
        _source: 'tidal'
    } as QobuzAlbum & { _source: string };
}

export function normalizeTidalTrack(track: TidalTrackRaw): QobuzTrack {
    return {
        isrc: track.isrc || null,
        copyright: track.copyright || '',
        maximum_bit_depth: track.audioQuality === 'HI_RES' || track.audioQuality === 'HI_RES_LOSSLESS' ? 24 : 16,
        maximum_sampling_rate: track.audioQuality === 'HI_RES' || track.audioQuality === 'HI_RES_LOSSLESS' ? 96 : 44.1,
        performer: {
            name: track.artist.name,
            id: track.artist.id
        },
        album: track.album ? normalizeTidalAlbum(track.album) : {} as QobuzAlbum,
        track_number: track.trackNumber,
        released_at: 0,
        title: track.title,
        version: track.version || null,
        duration: track.duration,
        parental_warning: track.explicit,
        id: track.id,
        hires: track.audioQuality === 'HI_RES' || track.audioQuality === 'HI_RES_LOSSLESS',
        streamable: track.streamReady,
        media_number: track.volumeNumber,
        _source: 'tidal'
    } as QobuzTrack & { _source: string };
}

export function normalizeTidalArtist(artist: TidalArtistRaw): QobuzArtist {
    const imageUrl = getTidalArtistImageUrl(artist.picture);
    return {
        image: imageUrl
            ? {
                small: getTidalArtistImageUrl(artist.picture, 160),
                medium: getTidalArtistImageUrl(artist.picture, 320),
                large: imageUrl,
                extralarge: imageUrl,
                mega: imageUrl
            }
            : null,
        name: artist.name,
        id: artist.id,
        albums_count: 0,
        _source: 'tidal'
    } as QobuzArtist & { _source: string };
}

export function normalizeTidalSearchResults(results: TidalSearchResults, query: string): QobuzSearchResults {
    return {
        query,
        switchTo: null,
        albums: {
            limit: results.albums.limit,
            offset: results.albums.offset,
            total: results.albums.totalNumberOfItems,
            items: results.albums.items.map(normalizeTidalAlbum)
        },
        tracks: {
            limit: results.tracks.limit,
            offset: results.tracks.offset,
            total: results.tracks.totalNumberOfItems,
            items: results.tracks.items.map(normalizeTidalTrack)
        },
        artists: {
            limit: results.artists.limit,
            offset: results.artists.offset,
            total: results.artists.totalNumberOfItems,
            items: results.artists.items.map(normalizeTidalArtist)
        }
    };
}
