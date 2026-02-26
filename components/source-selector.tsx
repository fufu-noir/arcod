'use client';

import React from 'react';
import { useMusicSource, MusicSource } from '@/lib/music-source-provider';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// Qobuz Logo SVG Component
const QobuzLogo = ({ className, size = 20 }: { className?: string; size?: number }) => (
    <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        fill="currentColor"
    >
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
        <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
        <circle cx="12" cy="12" r="2" />
        <path d="M18 18l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
);

// Tidal Logo SVG Component
const TidalLogo = ({ className, size = 20 }: { className?: string; size?: number }) => (
    <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        fill="currentColor"
    >
        <path d="M12.012 3.992L8.008 7.996 4.004 3.992 0 7.996l4.004 4.004L8.008 8l4.004 4-4.004 4.004 4.004 4.004 4.004-4.004-4.004-4.008 4.004-3.996 4.004 3.996 4.004-4.004z" transform="translate(0, 2)" />
    </svg>
);

interface SourceSelectorProps {
    className?: string;
}

const SourceSelector = ({ className }: SourceSelectorProps) => {
    const { source, setSource } = useMusicSource();

    return (
        <div
            className={cn(
                'relative flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/50 border border-border/30',
                className
            )}
        >
            {/* Animated background pill */}
            <motion.div
                className="absolute top-0.5 bottom-0.5 rounded-md bg-primary/15 border border-primary/30"
                animate={{
                    left: source === 'qobuz' ? '2px' : '50%',
                    width: 'calc(50% - 4px)',
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />

            {/* Qobuz Button */}
            <button
                type="button"
                onClick={() => setSource('qobuz')}
                className={cn(
                    'relative z-10 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer select-none',
                    source === 'qobuz'
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground/80'
                )}
                title="Search via Qobuz"
            >
                <QobuzLogo size={14} />
                <span className="hidden sm:inline">Qobuz</span>
            </button>

            {/* Tidal Button */}
            <button
                type="button"
                onClick={() => setSource('tidal')}
                className={cn(
                    'relative z-10 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer select-none',
                    source === 'tidal'
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground/80'
                )}
                title="Search via Tidal"
            >
                <TidalLogo size={14} />
                <span className="hidden sm:inline">Tidal</span>
            </button>
        </div>
    );
};

export default SourceSelector;
export { QobuzLogo, TidalLogo };
