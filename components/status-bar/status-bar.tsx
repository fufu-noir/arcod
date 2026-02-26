'use client';
import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { Button } from '../ui/button';
import { ChevronDown, ChevronUp, List as QueueIcon, LucideIcon, X, Loader2, Trash2, ActivityIcon, DotIcon } from 'lucide-react';
import { motion, useSpring, useMotionTemplate, useMotionValue, animate } from 'motion/react';
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
    duration: 0.55,
    bounce: 0.15
};

const bouncySpring = {
    type: 'spring',
    stiffness: 500,
    damping: 15,
    mass: 0.8
};

// Shimmer offset for the progress border
// Shimmer offset for the progress border
const BORDER_WIDTH = 3; // px - Increased for better visibility

const StatusBar = () => {
    const { statusBar, setStatusBar } = useStatusBar();
    const [queueOpen, setQueueOpen] = useState<boolean>(false);
    const [search, setSearch] = useState<string>('');
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    const hasQueue = (statusBar.queue?.length ?? 0) > 0;
    const isProcessing = statusBar.processing;
    const isOpen = statusBar.open;

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

    // Efficiently compile the gradient string without re-renders
    const progressBorderGradient = useMotionTemplate`conic-gradient(from ${rotation}deg, ${borderColor} 0deg, ${borderColor} ${progressSpring}%, transparent ${progressSpring}%, transparent 360deg)`;

    // Dynamic shadow combining the standard status shadow + the success glow burst
    const containerShadow = useMotionTemplate`
        ${isOpen ? '0 0 60px -15px hsl(var(--primary) / 0.4), 0 25px 50px -12px rgba(0, 0, 0, 0.5)' : '0 20px 50px -15px rgba(0, 0, 0, 0.6)'},
        0 0 40px -5px rgba(34, 197, 94, ${glowIntensity})
    `;

    // Reset search when queue closes
    useEffect(() => {
        if (!queueOpen) setSearch('');
    }, [queueOpen]);

    const filteredItems = statusBar.queue?.filter((item) =>
        item.title.toLowerCase().includes(search.toLowerCase())
    ) || [];

    // Calculate dynamic height based on queue state
    const getExpandedHeight = () => {
        if (!queueOpen) return 'auto';
        const baseHeight = 200; // Minimum height for queue
        const itemHeight = 56; // Height per queue item
        const headerHeight = 60; // Search + header
        const processingHeight = isProcessing ? 100 : 0;
        const contentHeight = Math.min(filteredItems.length * itemHeight + headerHeight + processingHeight, 350);
        return Math.max(baseHeight, contentHeight);
    };

    const currentBorderRadius = isOpen ? (queueOpen ? 28 : 40) : 60;

    return (
        <motion.div
            initial={false}
            animate={{
                minWidth: isOpen ? Math.min(500, window.innerWidth * 0.95) : 0,
                height: queueOpen ? getExpandedHeight() : 'auto',
                borderRadius: currentBorderRadius,
            }}
            whileHover={{}}
            whileTap={{}}
            transition={smoothSpring}
            onClick={() => !isOpen && setStatusBar({ ...statusBar, open: true })}
            className={cn(
                'relative pointer-events-auto cursor-pointer',
                !isActive && 'border-2',
                !isActive && (isOpen ? 'border-primary/20' : 'border-white/10'),
            )}
            style={{
                maxWidth: '95vw',
                willChange: 'transform',
                padding: isActive ? BORDER_WIDTH : 0,
                boxShadow: containerShadow, // Use the dynamic shadow
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
                    className='absolute inset-0 pointer-events-none'
                    style={{
                        borderRadius: 'inherit',
                        zIndex: 0,
                    }}
                />
            )}

            {/* Inner background that masks the gradient, leaving only the border visible */}
            <motion.div
                className='relative overflow-hidden'
                style={{
                    borderRadius: isActive ? currentBorderRadius - BORDER_WIDTH : 'inherit',
                    background: 'hsl(var(--background) / 0.95)',
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

                {/* Background Glow for expanded state */}
                <motion.div
                    initial={false}
                    animate={{
                        opacity: isOpen ? 0.15 : 0,
                        scale: isOpen ? 1 : 0.5
                    }}
                    transition={smoothSpring}
                    className='absolute -top-20 -left-20 w-40 h-40 bg-primary blur-[80px] rounded-full pointer-events-none'
                />
                <motion.div
                    initial={false}
                    animate={{
                        opacity: isOpen ? 0.15 : 0,
                        scale: isOpen ? 1 : 0.5
                    }}
                    transition={smoothSpring}
                    className='absolute -bottom-20 -right-20 w-40 h-40 bg-primary blur-[80px] rounded-full pointer-events-none'
                />

                {/* Content container with animated padding — grid stacks both states in same cell for crossfade */}
                <motion.div
                    initial={false}
                    animate={{
                        padding: isOpen ? (queueOpen ? 16 : 20) : 14,
                        paddingLeft: isOpen ? (queueOpen ? 16 : 20) : 24,
                        paddingRight: isOpen ? (queueOpen ? 16 : 20) : 24
                    }}
                    transition={smoothSpring}
                    className='relative h-full'
                    style={{ display: 'grid' }}
                >
                    {/* Collapsed state — always mounted, fades via opacity */}
                    <motion.div
                        initial={false}
                        animate={{
                            opacity: isOpen ? 0 : 1,
                            scale: isOpen ? 0.9 : 1,
                        }}
                        transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
                        className='flex items-center gap-4'
                        style={{
                            gridArea: '1/1',
                            pointerEvents: isOpen ? 'none' : 'auto',
                            position: isOpen ? 'absolute' : 'relative',
                        }}
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

                        <div className='flex items-center gap-3'>
                            <span className='text-xs font-bold tracking-wider text-foreground/80 uppercase truncate'>
                                {isProcessing ? statusBar.title : 'Queue'}
                            </span>

                            {isProcessing ? (
                                <motion.span
                                    key={statusBar.progress}
                                    initial={{ scale: 1.3 }}
                                    animate={{ scale: 1 }}
                                    transition={bouncySpring}
                                    className='bg-primary/20 text-primary font-mono text-[10px] px-2 py-0.5 rounded-md font-bold tabular-nums'
                                >
                                    {Math.round(statusBar.progress)}%
                                </motion.span>
                            ) : hasQueue && (
                                <motion.span
                                    animate={{ scale: [1, 1.1, 1] }}
                                    transition={{ duration: 2, repeat: Infinity }}
                                    className='bg-white/10 text-muted-foreground text-[10px] px-2 py-0.5 rounded-md font-bold'
                                >
                                    {statusBar.queue?.length}
                                </motion.span>
                            )}
                        </div>
                    </motion.div>

                    {/* Expanded state — always mounted, fades via opacity */}
                    <motion.div
                        initial={false}
                        animate={{
                            opacity: isOpen ? 1 : 0,
                            scale: isOpen ? 1 : 0.96,
                        }}
                        transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
                        className='flex flex-col gap-4'
                        style={{
                            gridArea: '1/1',
                            pointerEvents: isOpen ? 'auto' : 'none',
                            position: isOpen ? 'relative' : 'absolute',
                        }}
                    >
                        {/* Header Row */}
                        <div className='flex items-center justify-between gap-3'>
                            <motion.div
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
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
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            transition={bouncySpring}
                                            className='absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[16px] text-center'
                                        >
                                            {statusBar.queue?.length}
                                        </motion.span>
                                    )}
                                </Button>
                            </motion.div>

                            <div className='flex-1 flex flex-col items-center text-center min-w-0 px-2'>
                                <AnimatePresence mode='wait'>
                                    {queueOpen ? (
                                        <motion.p
                                            key='queue-title'
                                            initial={{ opacity: 0, y: -5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: 5 }}
                                            className='text-sm font-bold tracking-tight text-foreground'
                                        >
                                            Queue ({statusBar.queue?.length || 0})
                                        </motion.p>
                                    ) : (
                                        <motion.div
                                            key='status-title'
                                            initial={{ opacity: 0, y: -5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: 5 }}
                                            className='flex flex-col items-center'
                                        >
                                            <p className='text-sm font-bold tracking-tight truncate text-foreground uppercase'>
                                                {statusBar.title || 'No active task'}
                                            </p>
                                            {statusBar.description && (
                                                <p className='text-xs text-muted-foreground truncate'>
                                                    {statusBar.description}
                                                </p>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            <motion.div
                                whileHover={{ scale: 1.1, rotate: 180 }}
                                whileTap={{ scale: 0.9 }}
                                transition={bouncySpring}
                            >
                                <Button
                                    variant='ghost'
                                    size='icon'
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setQueueOpen(false);
                                        setStatusBar({ ...statusBar, open: false });
                                    }}
                                    className='size-10 rounded-xl hover:bg-white/10 text-muted-foreground shrink-0'
                                >
                                    <ChevronDown className='w-4 h-4' />
                                </Button>
                            </motion.div>
                        </div>

                        {/* Progress Row - Only show when not in queue mode */}
                        <AnimatePresence>
                            {!queueOpen && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={smoothSpring}
                                    className='flex items-center gap-3 bg-white/5 p-3 rounded-2xl overflow-hidden'
                                >
                                    <div className='flex-1 h-2 bg-primary/10 rounded-full overflow-hidden'>
                                        <motion.div
                                            className='h-full bg-gradient-to-r from-primary via-primary/80 to-primary rounded-full'
                                            initial={false}
                                            animate={{ width: `${statusBar.progress}%` }}
                                            transition={{ type: 'spring', stiffness: 80, damping: 12 }}
                                        />
                                    </div>
                                    <span className='text-xs font-mono font-bold text-primary tabular-nums w-10 text-right'>
                                        {Math.round(statusBar.progress)}%
                                    </span>
                                    <motion.div
                                        whileHover={{ scale: 1.2, rotate: 90 }}
                                        whileTap={{ scale: 0.8 }}
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
                            )}
                        </AnimatePresence>

                        {/* Queue View - Integrated into the dynamic island */}
                        <AnimatePresence>
                            {queueOpen && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={smoothSpring}
                                    className='flex flex-col gap-3 flex-1 overflow-hidden'
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
                                    <ScrollArea className='flex-1 -mx-1 px-1' ref={scrollAreaRef}>
                                        <div className='flex flex-col gap-2'>
                                            {/* Currently Processing */}
                                            {isProcessing && (
                                                <motion.div
                                                    initial={{ opacity: 0, scale: 0.95 }}
                                                    animate={{ opacity: 1, scale: 1 }}
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
                                                    key={`${item.UUID}-${index}`}
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: 10 }}
                                                    transition={{ ...bouncySpring, delay: index * 0.02 }}
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
                    </motion.div>
                </motion.div>
            </motion.div>
        </motion.div >
    );
};

export default StatusBar;
