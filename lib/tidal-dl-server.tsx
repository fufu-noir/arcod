import axios from 'axios';
import { TidalSearchResults, normalizeTidalSearchResults, normalizeTidalAlbum, TidalAlbumRaw, TidalTrackRaw } from './tidal-dl';
import { QobuzSearchResults } from './qobuz-dl';

/**
 * Tidal API Server Module
 * Uses the unofficial Tidal API (api.tidal.com/v1) for search, album info, and track streaming.
 * Requires TIDAL_AUTH_TOKEN and TIDAL_COUNTRY_CODE env vars.
 */

const TIDAL_API_BASE = 'https://api.tidal.com/v1';

function getTidalConfig() {
    return {
        authToken: process.env.TIDAL_AUTH_TOKEN || '',
        countryCode: process.env.TIDAL_COUNTRY_CODE || 'US',
    };
}

function getTidalHeaders() {
    const config = getTidalConfig();
    return {
        'X-Tidal-Token': config.authToken,
        'Content-Type': 'application/json',
    };
}

/**
 * Search Tidal catalog
 */
export async function searchTidal(
    query: string,
    limit: number = 10,
    offset: number = 0,
    countryCode?: string
): Promise<QobuzSearchResults> {
    const config = getTidalConfig();
    const country = countryCode || config.countryCode;

    // Check for Tidal URL patterns
    let switchTo: string | null = null;
    const tidalAlbumMatch = query.match(/(?:https?:\/\/)?(?:listen\.)?tidal\.com\/(?:browse\/)?album\/(\d+)/);
    const tidalTrackMatch = query.match(/(?:https?:\/\/)?(?:listen\.)?tidal\.com\/(?:browse\/)?track\/(\d+)/);
    const tidalArtistMatch = query.match(/(?:https?:\/\/)?(?:listen\.)?tidal\.com\/(?:browse\/)?artist\/(\d+)/);

    if (tidalAlbumMatch) {
        switchTo = 'albums';
        query = tidalAlbumMatch[1];
    } else if (tidalTrackMatch) {
        switchTo = 'tracks';
        query = tidalTrackMatch[1];
    } else if (tidalArtistMatch) {
        switchTo = 'artists';
        query = tidalArtistMatch[1];
    }

    const url = `${TIDAL_API_BASE}/search`;
    const response = await axios.get(url, {
        params: {
            query,
            limit,
            offset,
            countryCode: country,
            types: 'ARTISTS,ALBUMS,TRACKS',
        },
        headers: getTidalHeaders(),
        timeout: 15000,
    });

    const tidalResults: TidalSearchResults = response.data;
    const normalized = normalizeTidalSearchResults(tidalResults, query);
    normalized.switchTo = switchTo as any;

    return normalized;
}

/**
 * Get Tidal album info with tracks
 */
export async function getTidalAlbumInfo(albumId: string, countryCode?: string) {
    const config = getTidalConfig();
    const country = countryCode || config.countryCode;

    // Fetch album details
    const albumResponse = await axios.get(`${TIDAL_API_BASE}/albums/${albumId}`, {
        params: { countryCode: country },
        headers: getTidalHeaders(),
        timeout: 15000,
    });

    const albumData: TidalAlbumRaw = albumResponse.data;

    // Fetch album tracks
    const tracksResponse = await axios.get(`${TIDAL_API_BASE}/albums/${albumId}/tracks`, {
        params: {
            countryCode: country,
            limit: 100,
            offset: 0,
        },
        headers: getTidalHeaders(),
        timeout: 15000,
    });

    const normalizedAlbum = normalizeTidalAlbum(albumData);

    // Add tracks to the album
    const tracks = tracksResponse.data.items.map((track: TidalTrackRaw) => {
        const { normalizeTidalTrack } = require('./tidal-dl');
        const normalizedTrack = normalizeTidalTrack(track);
        normalizedTrack.album = normalizedAlbum;
        return normalizedTrack;
    });

    return {
        ...normalizedAlbum,
        tracks: {
            offset: tracksResponse.data.offset || 0,
            limit: tracksResponse.data.limit || 100,
            total: tracksResponse.data.totalNumberOfItems || tracks.length,
            items: tracks,
        },
        _source: 'tidal',
    };
}

/**
 * Get Tidal track stream URL
 */
export async function getTidalStreamUrl(trackId: string, quality: string = 'LOSSLESS', countryCode?: string) {
    const config = getTidalConfig();
    const country = countryCode || config.countryCode;

    // Map quality numbers to Tidal quality strings
    let tidalQuality = 'LOSSLESS';
    if (quality === '5' || quality === 'LOW') tidalQuality = 'LOW';
    else if (quality === '6' || quality === 'HIGH') tidalQuality = 'HIGH';
    else if (quality === '7' || quality === 'LOSSLESS') tidalQuality = 'LOSSLESS';
    else if (quality === '27' || quality === 'HI_RES' || quality === 'HI_RES_LOSSLESS') tidalQuality = 'HI_RES_LOSSLESS';

    const response = await axios.get(`${TIDAL_API_BASE}/tracks/${trackId}/streamUrl`, {
        params: {
            soundQuality: tidalQuality,
            countryCode: country,
        },
        headers: getTidalHeaders(),
        timeout: 15000,
    });

    return {
        url: response.data.url,
        codec: response.data.codec,
        mimeType: response.data.mimeType || 'audio/flac',
    };
}

/**
 * Get Tidal artist info
 */
export async function getTidalArtist(artistId: string, countryCode?: string) {
    const config = getTidalConfig();
    const country = countryCode || config.countryCode;

    const response = await axios.get(`${TIDAL_API_BASE}/artists/${artistId}`, {
        params: { countryCode: country },
        headers: getTidalHeaders(),
        timeout: 15000,
    });

    return response.data;
}
