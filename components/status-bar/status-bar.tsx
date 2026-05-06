'use client';
import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Button } from '../ui/button';
import { ChevronDown, ChevronUp, List as QueueIcon, LucideIcon, X, Loader2, Trash2, ActivityIcon, DotIcon } from 'lucide-react';
import { motion, useSpring, useMotionTemplate, useMotionValue, animate } from 'framer-motion';
import { useStatusBar } from '@/lib/status-bar/context';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';
import { Input } from '../ui/input';
import { clearQueue } from '@/lib/status-bar/jobs';
import { Progress } from '../ui/progress';

export type QueueProps = {
    title: string;
    icon?: LucideIcon | null;
    UUID: string;
    remove?: () => void;
};

export type StatusBarProps = {
    open: boolean;
    openPreference: boolean;
    title: string;
    description: string;
    progress: number;
    processing: boolean;
    queue?: QueueProps[];
    onCancel?: () => void;
};

const smoothSpring = {
    type: 'spring',
    stiffness: 330,
    damping: 30,
    mass: 0.82
};

const bouncySpring = {
    type: 'spring',
    stiffness: 360,
    damping: 26,
    mass: 0.7
};

const softEase = {
    duration: 0.24,
    ease: [0.22, 1, 0.36, 1]
};

const queuePanelTransition = {
    type: 'spring',
    stiffness: 340,
    damping: 30,
    mass: 0.95
};

// Shimmer offset for the progress border
const BORDER_WIDTH = 3; // px - Increased for better visibility

const StatusBar = () => {
    const { statusBar, setStatusBar } = useStatusBar();
    const [queueOpen, setQueueOpen] = useState<boolean>(false);
    const [search, setSearch] = useState<string>('');
    const [viewportWidth, setViewportWidth] = useState<number>(() => typeof window !== 'undefined' ? window.innerWidth : 1440);
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    const hasQueue = (statusBar.queue?.length ?? 0) > 0;
    const queueCount = statusBar.queue?.length ?? 0;
    const isProcessing = statusBar.processing;
    const isOpen = statusBar.open;
    const hasActiveTask = isProcessing || statusBar.progress > 0;
    const isIdleExpanded = isOpen && !queueOpen && !hasActiveTask;

    // Smooth progress spring
    const progressSpring = useSpring(0, {
        stiffness: 40,
        damping: 15,
        mass: 1
    });

    const [success, setSuccess] = useState(false);

    // Keep the UI active during processing OR success animation
    const isActive = isProcessing || success;

    // Dynamic border color & glow for success state
    const borderColor = useMotionValue('hsl(var(--primary))');
    const borderOpacity = useMotionValue(1);
    const glowIntensity = useMotionValue(0);
    const scaleAnim = useSpring(1, { stiffness: 300, damping: 15 });

    // Subtle breathing animation for the start angle
    const rotation = useMotionValue(-90);

    // Monitor progress for success animation
    // Track previous state to detect completion
    const prevProcessing = useRef(isProcessing);
    const prevProgress = useRef(statusBar.progress);

    // Monitor progress for success animation
    useEffect(() => {
        // Trigger Success on hitting 100% OR finishing with high progress
        const completedNormally = isProcessing && statusBar.progress >= 100;
        const finishedIdeally = !isProcessing && prevProcessing.current && prevProgress.current > 85;

        if ((completedNormally || finishedIdeally) && !success) {
            setSuccess(true);
            progressSpring.set(100);
            borderOpacity.set(1);

            // 1. Flash White -> Green
            const flashSeq = async () => {
                borderColor.set('#ffffff');
                await animate(borderColor, '#ffffff', { duration: 0.1 }).then(() => {
                    animate(borderColor, '#22c55e', { duration: 0.4 });
                });
            };
            flashSeq();

            // 2. Pulse Scale (thump)
            scaleAnim.set(1.05);
            setTimeout(() => scaleAnim.set(1), 300);

            // 3. Success Glow Burst
            animate(glowIntensity, 1, {
                duration: 0.2, onComplete: () => {
                    animate(glowIntensity, 0, { duration: 0.8, delay: 0.5 });
                }
            });

            // 4. Reset after animation completes
            setTimeout(() => {
                setSuccess(false);
                progressSpring.set(0);
                borderColor.set('hsl(var(--primary))');
                glowIntensity.set(0);
                scaleAnim.set(1);

                // Clear the status bar display so "Finished" doesn't linger
                setStatusBar(prev => ({
                    ...prev,
                    title: '',
                    description: '',
                    progress: 0,
                    processing: false
                }));
            }, 2500);
        } else if (isProcessing) {
            progressSpring.set(statusBar.progress);
            if (!success) {
                borderOpacity.set(1);
                if (borderColor.get() !== 'hsl(var(--primary))') borderColor.set('hsl(var(--primary))');
            }
        } else if (!success) {
            progressSpring.set(0);
            borderOpacity.set(0);
        }

        // Update refs
        prevProcessing.current = isProcessing;
        prevProgress.current = statusBar.progress;
    }, [isProcessing, statusBar.progress, success, progressSpring, borderColor, glowIntensity, scaleAnim, borderOpacity]);

    useEffect(() => {
        if (!isActive) return;
        // Subtle breathing/shimmer of the start angle (±15deg)
        const controls = animate(rotation, [-90, -75, -105, -90], {
            duration: 8,
            ease: "easeInOut",
            repeat: Infinity,
        });
        return () => controls.stop();
    }, [isActive, rotation]);

    useEffect(() => {
        const updateViewportWidth = () => setViewportWidth(window.innerWidth);

        updateViewportWidth();
        window.addEventListener('resize', updateViewportWidth);

        return () => window.removeEventListener('resize', updateViewportWidth);
    }, []);

    // Efficiently compile the gradient string without re-renders
    const progressBorderGradient = useMotionTemplate`conic-gradient(from ${rotation}deg, ${borderColor} 0deg, ${borderColor} ${progressSpring}%, transparent ${progressSpring}%, transparent 360deg)`;

    const glowShadow = useMotionTemplate`0 0 40px -5px rgba(34, 197, 94, ${glowIntensity})`;

    // Reset search when queue closes
    useEffect(() => {
        if (!queueOpen) setSearch('');
    }, [queueOpen]);

    useEffect(() => {
        if (isOpen) return;

        // Let the island collapse first, then reset the queue panel state.
        const timeout = window.setTimeout(() => {
            setQueueOpen(false);
        }, 180);

        return () => window.clearTimeout(timeout);
    }, [isOpen]);

    const filteredItems = statusBar.queue?.filter((item) =>
        item.title.toLowerCase().includes(search.toLowerCase())
    ) || [];

    const shellState = !isOpen ? 'closed' : queueOpen ? 'queue' : 'expanded';
    const shellWidth = !isOpen
        ? 188
        : queueOpen
            ? Math.min(520, viewportWidth * 0.95)
            : Math.min(468, viewportWidth * 0.9);
    const queueItemsHeight = Math.min(filteredItems.length, 4) * 52;
    const queueEmptyHeight = filteredItems.length === 0 && !isProcessing ? 84 : 0;
    const queueProcessingHeight = isProcessing ? 78 : 0;
    const queueShellHeight = Math.min(
        430,
        Math.max(252, 148 + queueProcessingHeight + Math.max(queueItemsHeight, queueEmptyHeight))
    );
    const shellHeight = !isOpen ? 52 : queueOpen ? queueShellHeight : hasActiveTask ? 138 : 104;
    const shellRadius = !isOpen ? 26 : queueOpen ? 30 : 38;
    const innerRadius = Math.max(shellRadius - (isActive ? BORDER_WIDTH : 1), 24);
    const panelRadius = Math.max(innerRadius - 4, 22);
    const queuePanelClipCollapsed = `inset(10% 0% 10% 0% round ${panelRadius}px)`;
    const queuePanelClipExpanded = `inset(0% 0% 0% 0% round ${panelRadius}px)`;
    const baseShadow = !isOpen
        ? '0 14px 34px -18px rgba(0, 0, 0, 0.68)'
        : queueOpen
            ? '0 28px 70px -24px rgba(0, 0, 0, 0.58), 0 0 0 1px hsl(var(--primary) / 0.08)'
            : '0 22px 54px -22px rgba(0, 0, 0, 0.58), 0 0 0 1px hsl(var(--primary) / 0.06)';
    const containerShadow = useMotionTemplate`${baseShadow}, ${glowShadow}`;

    return (
        <motion.div
            initial={false}
            animate={{
                width: shellWidth,
                height: shellHeight,
                borderRadius: shellRadius,
            }}
            transition={smoothSpring}
            onClick={() => !isOpen && setStatusBar({ ...statusBar, open: true })}
            className='relative shrink-0 cursor-pointer pointer-events-auto overflow-visible'
            style={{
                maxWidth: '95vw',
                boxSizing: 'border-box',
                transformOrigin: 'center bottom',
                willChange: 'transform, width, height, border-radius',
                padding: isActive ? BORDER_WIDTH : 0,
                boxShadow: containerShadow,
                scale: scaleAnim
            }}
        >
            {/* Animated progress border overlay */}
            {isActive && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className='absolute inset-0 pointer-events-none'
                    style={{
                        borderRadius: 'inherit',
                        background: progressBorderGradient,
                        opacity: borderOpacity, // Allow fading out the border
                        zIndex: 0,
                    }}
                >
                    {/* Glow effect on the leading edge/entire border */}
                    <motion.div
                        className='absolute inset-0 pointer-events-none'
                        style={{
                            borderRadius: 'inherit',
                            background: progressBorderGradient,
                            filter: 'blur(8px)',
                            opacity: 0.5,
                        }}
                    />
                </motion.div>
            )}

            {/* Non-processing border fallback */}
            {!isActive && (
                <div
                    className={cn(
                        'absolute inset-0 pointer-events-none border',
                        isOpen ? 'border-primary/16' : 'border-white/10'
                    )}
                    style={{
                        borderRadius: 'inherit',
                        zIndex: 0,
                    }}
                />
            )}

            {/* Inner background that masks the gradient, leaving only the border visible */}
            <motion.div
                initial={false}
                animate={{
                    borderRadius: innerRadius
                }}
                transition={smoothSpring}
                className='relative h-full w-full overflow-hidden'
                style={{
                    borderRadius: innerRadius,
                    background: 'linear-gradient(180deg, hsl(var(--background) / 0.98), hsl(var(--background) / 0.92))',
                    backdropFilter: 'blur(60px)',
                    zIndex: 1,
                }}
            >
                {/* Pulse effect for processing in collapsed state */}
                {isProcessing && !isOpen && (
                    <motion.div
                        className='absolute inset-0 rounded-full bg-primary/10 pointer-events-none'
                        animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.02, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                )}

                {/* Ambient shell background that morphs with the island */}
                <motion.div
                    initial={false}
                    animate={{
                        opacity: shellState === 'closed' ? 0.03 : shellState === 'queue' ? 0.18 : 0.1,
                        scale: shellState === 'queue' ? 1.01 : 1
                    }}
                    transition={smoothSpring}
                    className='absolute inset-0 pointer-events-none'
                    style={{
                        background: 'radial-gradient(120% 140% at 50% -10%, hsl(var(--primary) / 0.18) 0%, transparent 58%)'
                    }}
                />
                <motion.div
                    initial={false}
                    animate={{
                        opacity: shellState === 'closed' ? 0.015 : shellState === 'queue' ? 0.08 : 0.045,
                        scale: shellState === 'queue' ? 1.015 : 1
                    }}
                    transition={smoothSpring}
                    className='absolute inset-0 pointer-events-none'
                    style={{
                        background: 'radial-gradient(90% 120% at 50% 120%, hsl(var(--primary) / 0.14) 0%, transparent 66%)'
                    }}
                />
                <motion.div
                    initial={false}
                    animate={{
                        opacity: shellState === 'closed' ? 0.08 : 0.2,
                        scaleX: shellState === 'queue' ? 1 : 0.97
                    }}
                    transition={smoothSpring}
                    className='absolute inset-x-[16%] top-0 h-px bg-white/25 pointer-events-none origin-center'
                />

                {/* Content container that morphs between the compact pill and the expanded island */}
                <motion.div
                    initial={false}
                    animate={{
                        paddingTop: !isOpen ? 10 : queueOpen ? 16 : hasActiveTask ? 16 : 14,
                        paddingBottom: !isOpen ? 10 : queueOpen ? 16 : hasActiveTask ? 16 : 14,
                        paddingLeft: !isOpen ? 16 : queueOpen ? 16 : 18,
                        paddingRight: !isOpen ? 16 : queueOpen ? 16 : 18
                    }}
                    transition={smoothSpring}
                    className='relative flex h-full w-full flex-col'
                >
                    <AnimatePresence initial={false} mode='wait'>
                        {!isOpen ? (
                            <motion.div
                                key='collapsed-state'
                                initial={{ opacity: 0, scale: 0.94, y: 6 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.98, y: -4 }}
                                transition={softEase}
                                className='flex h-full w-full items-center justify-center gap-3'
                            >
                                <motion.div
                                    className='relative'
                                    animate={isProcessing && !isOpen ? { rotate: 360 } : { rotate: 0 }}
                                    transition={isProcessing && !isOpen ? { duration: 2, repeat: Infinity, ease: 'linear' } : bouncySpring}
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2 className='w-4 h-4 text-primary' />
                                            <div className='absolute inset-0 bg-primary/40 blur-lg rounded-full' />
                                        </>
                                    ) : (
                                        <motion.div
                                            animate={{ y: [0, -2, 0] }}
                                            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                                        >
                                            <ChevronUp className='w-4 h-4 text-primary' />
                                        </motion.div>
                                    )}
                                </motion.div>

                                <div className='flex items-center gap-3 min-w-0'>
                                    <span className='text-xs font-bold tracking-wider text-foreground/80 uppercase truncate'>
                                        {isProcessing ? statusBar.title : 'Queue'}
                                    </span>

                                    {isProcessing ? (
                                        <motion.span
                                            key={statusBar.progress}
                                            initial={{ scale: 1.16 }}
                                            animate={{ scale: 1 }}
                                            transition={bouncySpring}
                                            className='bg-primary/20 text-primary font-mono text-[10px] px-2 py-0.5 rounded-md font-bold tabular-nums'
                                        >
                                            {Math.round(statusBar.progress)}%
                                        </motion.span>
                                    ) : hasQueue && (
                                        <motion.span
                                            animate={{ scale: [1, 1.06, 1] }}
                                            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                                            className='bg-white/10 text-muted-foreground text-[10px] px-2 py-0.5 rounded-md font-bold'
                                        >
                                            {statusBar.queue?.length}
                                        </motion.span>
                                    )}
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key='expanded-state'
                                initial={{ opacity: 0, scale: 0.985, y: 8 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.99, y: 6 }}
                                transition={softEase}
                                className={cn(
                                    'flex h-full w-full min-h-0 flex-col',
                                    hasActiveTask ? 'gap-4' : 'gap-3'
                                )}
                            >
                                {/* Header Row */}
                                <div className='flex items-center justify-between gap-3'>
                                    <motion.div
                                        whileHover={{ scale: 1.04 }}
                                        whileTap={{ scale: 0.97 }}
                                        transition={bouncySpring}
                                    >
                                        <Button
                                            variant='ghost'
                                            size='icon'
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setQueueOpen(!queueOpen);
                                            }}
                                            className={cn(
                                                'size-10 rounded-xl relative shrink-0 transition-all duration-200',
                                                queueOpen
                                                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                                    : hasQueue
                                                        ? 'bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20'
                                                        : 'opacity-30 cursor-not-allowed'
                                            )}
                                            disabled={!hasQueue && !queueOpen}
                                        >
                                            <QueueIcon className='w-4 h-4' />
                                            {hasQueue && !queueOpen && (
                                                <motion.span
                                                    initial={{ scale: 0.8, opacity: 0 }}
                                                    animate={{ scale: 1, opacity: 1 }}
                                                    transition={bouncySpring}
                                                    className='absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[16px] text-center'
                                                >
                                                    {statusBar.queue?.length}
                                                </motion.span>
                                            )}
                                        </Button>
                                    </motion.div>

                                    <div className='flex-1 flex flex-col items-center text-center min-w-0 px-2'>
                                        <AnimatePresence initial={false} mode='popLayout'>
                                            {queueOpen ? (
                                                <motion.p
                                                    key='queue-title'
                                                    initial={{ opacity: 0, y: -6 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: 6 }}
                                                    transition={softEase}
                                                    className='text-sm font-bold tracking-tight text-foreground'
                                                >
                                                    Queue ({statusBar.queue?.length || 0})
                                                </motion.p>
                                            ) : (
                                                <motion.div
                                                    key='status-title'
                                                    initial={{ opacity: 0, y: -6 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: 6 }}
                                                    transition={softEase}
                                                    className='flex flex-col items-center'
                                                >
                                                    <p className='text-sm font-bold tracking-tight truncate text-foreground'>
                                                        {hasActiveTask ? (statusBar.title || 'Current task') : 'Queue'}
                                                    </p>
                                                    {!isIdleExpanded && (hasActiveTask ? statusBar.description : (hasQueue ? `${queueCount} waiting in queue` : 'Nothing running right now')) && (
                                                        <p className='text-xs text-muted-foreground truncate'>
                                                            {hasActiveTask ? statusBar.description : (hasQueue ? `${queueCount} waiting in queue` : 'Nothing running right now')}
                                                        </p>
                                                    )}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    <motion.div
                                        initial={false}
                                        whileHover='hover'
                                        whileTap='tap'
                                        transition={bouncySpring}
                                    >
                                        <Button
                                            variant='ghost'
                                            size='icon'
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setStatusBar({ ...statusBar, open: false });
                                            }}
                                            className='size-10 rounded-xl hover:bg-white/10 text-muted-foreground shrink-0'
                                        >
                                            <motion.div
                                                variants={{
                                                    hover: { scale: 1.04, y: 1 },
                                                    tap: { scale: 0.97, y: 0.5 }
                                                }}
                                                transition={bouncySpring}
                                            >
                                                <ChevronDown className='w-4 h-4' />
                                            </motion.div>
                                        </Button>
                                    </motion.div>
                                </div>

                                <div className='relative flex-1 min-h-0 overflow-visible'>
                                    <AnimatePresence initial={false} mode='wait'>
                                        {!queueOpen && hasActiveTask ? (
                                            <motion.div
                                                key='progress-panel'
                                                initial={{ opacity: 0, y: 6, scale: 0.985 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: -6, scale: 0.99 }}
                                                transition={softEase}
                                                className='flex w-full items-center gap-3 bg-white/6 p-3 overflow-hidden'
                                                style={{ borderRadius: panelRadius }}
                                            >
                                                <div className='flex-1 h-2 bg-primary/10 rounded-full overflow-hidden'>
                                                    <motion.div
                                                        className='h-full bg-gradient-to-r from-primary via-primary/80 to-primary rounded-full'
                                                        initial={false}
                                                        animate={{ width: `${statusBar.progress}%` }}
                                                        transition={{ type: 'spring', stiffness: 80, damping: 14 }}
                                                    />
                                                </div>
                                                <span className='text-xs font-mono font-bold text-primary tabular-nums w-10 text-right'>
                                                    {Math.round(statusBar.progress)}%
                                                </span>
                                                <motion.div
                                                    whileHover={{ scale: 1.06 }}
                                                    whileTap={{ scale: 0.94 }}
                                                    transition={bouncySpring}
                                                >
                                                    <Button
                                                        variant='ghost'
                                                        size='icon'
                                                        className='size-7 rounded-lg shrink-0 hover:bg-destructive/20 hover:text-destructive text-muted-foreground'
                                                        disabled={!isProcessing}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            statusBar.onCancel?.();
                                                        }}
                                                    >
                                                        <X className='w-3 h-3' />
                                                    </Button>
                                                </motion.div>
                                            </motion.div>
                                        ) : !queueOpen ? (
                                            <motion.div
                                                key='idle-panel'
                                                initial={{ opacity: 0, y: 6, scale: 0.985 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: -6, scale: 0.99 }}
                                                transition={softEase}
                                                className='flex h-full items-center justify-center'
                                            >
                                                <div className='flex items-center gap-2'>
                                                    <span className='size-1.5 rounded-full bg-primary/75' />
                                                    <p className='text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/50'>
                                                        {hasQueue ? `${queueCount} Pending` : 'No Active Task'}
                                                    </p>
                                                </div>
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key='queue-panel'
                                                initial={{
                                                    opacity: 0,
                                                    y: 8,
                                                    scale: 0.99,
                                                    clipPath: queuePanelClipCollapsed
                                                }}
                                                animate={{
                                                    opacity: 1,
                                                    y: 0,
                                                    scale: 1,
                                                    clipPath: queuePanelClipExpanded
                                                }}
                                                exit={{
                                                    opacity: 0,
                                                    y: -8,
                                                    scale: 0.99,
                                                    clipPath: queuePanelClipCollapsed
                                                }}
                                                transition={queuePanelTransition}
                                                className='flex h-full min-h-0 flex-col gap-3 overflow-hidden'
                                            >
                                                {/* Search + Clear */}
                                                <div className='flex gap-2'>
                                                    <Input
                                                        placeholder='Search queue...'
                                                        value={search}
                                                        onChange={(event) => setSearch(event.target.value)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className='flex-1 h-9 text-sm rounded-xl border-primary/10 bg-primary/5 focus-visible:ring-primary/20 transition-all'
                                                    />
                                                    {hasQueue && (
                                                        <Button
                                                            variant='ghost'
                                                            size='sm'
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                clearQueue(setStatusBar);
                                                            }}
                                                            className='shrink-0 h-9 text-destructive hover:bg-destructive/10 hover:text-destructive rounded-xl'
                                                        >
                                                            <Trash2 className='size-3.5 mr-1' />
                                                            Clear
                                                        </Button>
                                                    )}
                                                </div>

                                                {/* Queue Items */}
                                                <ScrollArea className='flex-1 min-h-0 -mx-1 px-1' ref={scrollAreaRef}>
                                                    <div className='flex flex-col gap-2'>
                                                        {/* Currently Processing */}
                                                        {isProcessing && (
                                                            <motion.div
                                                                layout
                                                                initial={{ opacity: 0, scale: 0.97 }}
                                                                animate={{ opacity: 1, scale: 1 }}
                                                                transition={smoothSpring}
                                                                className='p-3 rounded-xl bg-primary/10 border border-primary/20 shadow-sm'
                                                            >
                                                                <div className='flex items-center justify-between gap-2 mb-2'>
                                                                    <div className='flex items-center gap-2 min-w-0'>
                                                                        <div className='size-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0'>
                                                                            <ActivityIcon className='size-4 text-primary animate-pulse' />
                                                                        </div>
                                                                        <div className='min-w-0'>
                                                                            <p className='text-xs font-semibold truncate text-foreground'>
                                                                                {statusBar.title}
                                                                            </p>
                                                                            <p className='text-[10px] text-muted-foreground truncate'>
                                                                                {statusBar.description || 'Processing...'}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                    <Button
                                                                        size='icon'
                                                                        variant='ghost'
                                                                        className='size-7 rounded-lg hover:bg-destructive/10 hover:text-destructive shrink-0'
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            statusBar.onCancel?.();
                                                                        }}
                                                                    >
                                                                        <X className='size-3' />
                                                                    </Button>
                                                                </div>
                                                                <Progress value={statusBar.progress} className='h-1' />
                                                            </motion.div>
                                                        )}

                                                        {/* Queue Items */}
                                                        {filteredItems.map((item, index) => (
                                                            <motion.div
                                                                layout
                                                                key={`${item.UUID}-${index}`}
                                                                initial={{ opacity: 0, x: -8 }}
                                                                animate={{ opacity: 1, x: 0 }}
                                                                exit={{ opacity: 0, x: 8 }}
                                                                transition={{ ...bouncySpring, delay: index * 0.015 }}
                                                                className='flex items-center justify-between p-2.5 rounded-xl bg-card/40 border border-border/40 hover:border-primary/20 transition-all group'
                                                            >
                                                                <div className='flex items-center gap-2.5 min-w-0'>
                                                                    <div className='size-7 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors relative'>
                                                                        {item.icon ? (
                                                                            <item.icon className='size-3.5 text-muted-foreground group-hover:text-primary transition-colors' />
                                                                        ) : (
                                                                            <DotIcon className='size-3.5 text-muted-foreground' />
                                                                        )}
                                                                        <span className='absolute -top-1 -right-1 bg-muted text-muted-foreground text-[8px] font-bold px-1 rounded-full min-w-[12px] text-center'>
                                                                            {index + 1}
                                                                        </span>
                                                                    </div>
                                                                    <p className='text-xs font-medium truncate text-foreground/80 group-hover:text-foreground transition-colors'>
                                                                        {item.title}
                                                                    </p>
                                                                </div>
                                                                <Button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (item.remove) item.remove();
                                                                        setStatusBar(prev => ({
                                                                            ...prev,
                                                                            queue: prev.queue?.filter(q => q.UUID !== item.UUID)
                                                                        }));
                                                                    }}
                                                                    size='icon'
                                                                    variant='ghost'
                                                                    className='size-6 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive'
                                                                >
                                                                    <X className='size-3' />
                                                                </Button>
                                                            </motion.div>
                                                        ))}

                                                        {/* Empty State */}
                                                        {filteredItems.length === 0 && !isProcessing && (
                                                            <motion.div
                                                                initial={{ opacity: 0 }}
                                                                animate={{ opacity: 1 }}
                                                                transition={softEase}
                                                                className='flex flex-col items-center justify-center text-center py-6'
                                                            >
                                                                <div className='size-10 rounded-full bg-muted/20 flex items-center justify-center mb-2'>
                                                                    <QueueIcon className='size-5 text-muted-foreground/50' />
                                                                </div>
                                                                <p className='text-xs font-medium text-muted-foreground'>Queue is empty</p>
                                                            </motion.div>
                                                        )}
                                                    </div>
                                                </ScrollArea>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </motion.div>
        </motion.div >
    );
};

export default StatusBar;
