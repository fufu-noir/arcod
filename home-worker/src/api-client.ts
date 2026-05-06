import axios, { AxiosInstance } from 'axios';
import { config } from './config.js';

const client: AxiosInstance = axios.create({
    baseURL: config.server.url,
    timeout: 15_000,
    headers: { Authorization: `Bearer ${config.server.apiKey}` },
});

export interface WorkerJob {
    id: string;
    albumId: string;
    trackId: string | null;
    artistName: string;
    albumTitle: string;
    quality: number;
    format: string;
    bitrate: number;
    country: string;
    userId: string;
    tracksCount: number;
    trackName: string | null;
    zipName: string | null;
    embedLyrics: boolean | number;
    lyricsMode: string | null;
    attachCover: boolean | number;
    downloadBooklet: boolean | number;
}

export async function claimJobs(count: number): Promise<WorkerJob[]> {
    const { data } = await client.post('/v2/workers/claim', {
        workerId: config.workerId,
        count,
    });
    return data.jobs || [];
}

export async function updateJob(downloadId: string, updates: Record<string, any>): Promise<void> {
    await client.post('/v2/workers/update', {
        downloadId,
        workerId: config.workerId,
        updates,
    });
}

export async function sendHeartbeat(activeJobIds: string[]): Promise<void> {
    await client.post('/v2/workers/heartbeat', {
        workerId: config.workerId,
        activeJobIds,
    });
}

export async function releaseJobs(jobIds?: string[]): Promise<void> {
    await client.post('/v2/workers/release', {
        workerId: config.workerId,
        jobIds,
    });
}
