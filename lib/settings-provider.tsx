'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

export interface SettingsProps {
    background: 'particles' | 'solid' | 'futuristic';
    embedLyrics: boolean;
    lyricsMode: 'embedded' | 'sidecar';
    zipName: string;
    trackName: string;
    outputCodec: 'FLAC' | 'WAV' | 'ALAC' | 'MP3' | 'AAC' | 'OPUS';
    outputQuality: '27' | '7' | '6' | '5';
    bitrate: number | undefined;
    applyMetadata: boolean;
    fixMD5: boolean;
    explicitContent: boolean;
    albumArtSize: number;
    albumArtQuality: number;
}

export const nameVariables = ['artists', 'name', 'album', 'year', 'track', 'disc', 'genre', 'version'];

const defaultSettings: SettingsProps = {
    background: 'futuristic',
    embedLyrics: true,
    lyricsMode: 'embedded',
    zipName: '{artists} - {name}',
    trackName: '{track} - {name}',
    outputCodec: 'FLAC',
    outputQuality: '27',
    bitrate: 320,
    applyMetadata: true,
    fixMD5: true,
    explicitContent: true,
    albumArtSize: 1200,
    albumArtQuality: 0.8
};

interface SettingsContextType {
    settings: SettingsProps;
    setSettings: React.Dispatch<React.SetStateAction<SettingsProps>>;
    resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<SettingsProps>(defaultSettings);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('arcod-settings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setSettings({ ...defaultSettings, ...parsed });
            } catch (e) {
                console.error('Failed to parse settings', e);
            }
        }
        setMounted(true);
    }, []);

    useEffect(() => {
        if (mounted) {
            localStorage.setItem('arcod-settings', JSON.stringify(settings));
        }
    }, [settings, mounted]);

    const resetSettings = () => {
        setSettings(defaultSettings);
    };

    return (
        <SettingsContext.Provider value={{ settings, setSettings, resetSettings }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
