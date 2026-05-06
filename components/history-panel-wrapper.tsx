"use client";
import { HistoryPanel } from '@/components/history-panel';
import { useHistoryPanel } from '@/lib/history-panel-context';

export function HistoryPanelWrapper() {
    const { isOpen, closePanel } = useHistoryPanel();
    
    return <HistoryPanel isOpen={isOpen} onClose={closePanel} />;
}
