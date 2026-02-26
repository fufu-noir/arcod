'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

export type MusicSource = 'qobuz' | 'tidal';

interface MusicSourceContextType {
    source: MusicSource;
    setSource: (source: MusicSource) => void;
    toggleSource: () => void;
}

const MusicSourceContext = createContext<MusicSourceContextType>({
    source: 'qobuz',
    setSource: () => { },
    toggleSource: () => { }
});

export function MusicSourceProvider({ children }: { children: React.ReactNode }) {
    const [source, setSource] = useState<MusicSource>('qobuz');

    const toggleSource = useCallback(() => {
        setSource((prev) => (prev === 'qobuz' ? 'tidal' : 'qobuz'));
    }, []);

    return (
        <MusicSourceContext.Provider value={{ source, setSource, toggleSource }}>
            {children}
        </MusicSourceContext.Provider>
    );
}

export const useMusicSource = () => useContext(MusicSourceContext);
