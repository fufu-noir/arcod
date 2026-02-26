"use client";
import React, { createContext, useContext, useState, useCallback } from 'react';

interface HistoryPanelContextType {
    isOpen: boolean;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
}

const HistoryPanelContext = createContext<HistoryPanelContextType | undefined>(undefined);

export function HistoryPanelProvider({ children }: { children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);

    const openPanel = useCallback(() => setIsOpen(true), []);
    const closePanel = useCallback(() => setIsOpen(false), []);
    const togglePanel = useCallback(() => setIsOpen(prev => !prev), []);

    return (
        <HistoryPanelContext.Provider value={{ isOpen, openPanel, closePanel, togglePanel }}>
            {children}
        </HistoryPanelContext.Provider>
    );
}

export function useHistoryPanel() {
    const context = useContext(HistoryPanelContext);
    if (context === undefined) {
        throw new Error('useHistoryPanel must be used within a HistoryPanelProvider');
    }
    return context;
}
