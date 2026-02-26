interface TrackInfo {
    id: number;
    title: string;
    track_number: number;
    media_number: number;
    duration: number;
    performer?: {
        name: string;
    };
}
interface AlbumInfo {
    id: string;
    title: string;
    artist?: {
        name: string;
    };
    tracks: {
        items: TrackInfo[];
    };
    image?: {
        large?: string;
        small?: string;
    };
    genre?: {
        name: string;
    };
    label?: {
        name: string;
    };
    release_date_original?: string;
}
interface DownloadSettings {
    quality: number;
    format: string;
}
export declare function processAlbumDownload(jobId: string, albumInfo: AlbumInfo, settings: DownloadSettings, country?: string, trackId?: string | number | null): Promise<void>;
export {};
//# sourceMappingURL=download.d.ts.map