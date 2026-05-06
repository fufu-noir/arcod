'use client';
import React, { createContext, ReactNode, useContext } from 'react';

export type DownloadMode = 'cloud';

interface DownloadModeContextType {
    mode: DownloadMode;
}

const DownloadModeContext = createContext<DownloadModeContextType | undefined>(undefined);

export const DownloadModeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Cloud only - no local mode
    const mode: DownloadMode = 'cloud';

    return (
        <DownloadModeContext.Provider value={{ mode }}>
            {children}
        </DownloadModeContext.Provider>
    );
};

export const useDownloadMode = () => {
    const context = useContext(DownloadModeContext);
    if (!context) {
        throw new Error('useDownloadMode must be used within a DownloadModeProvider');
    }
    return context;
};
