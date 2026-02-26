'use client';

import Particles, { initParticlesEngine } from '@tsparticles/react';
import { useEffect, useMemo, useState } from 'react';
import { loadSlim } from '@tsparticles/slim';
import { useTheme } from 'next-themes';
import { useSettings } from '@/lib/settings-provider';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { getHex } from './mode-toggle';

const ParticlesComponent = ({ className }: { className: string }) => {
    const { resolvedTheme } = useTheme();
    const [, setInit] = useState(false);
    const { settings } = useSettings();

    useEffect(() => {
        initParticlesEngine(async (engine) => {
            await loadSlim(engine);
        }).then(() => {
            setInit(true);
        });
    }, []);

    const baseColor = resolvedTheme !== 'light' ? '' : '#f8fafc';
    const foregroundColor = resolvedTheme !== 'light' ? getHex(String(resolvedTheme), resolvedTheme) : '#1e3a8a';

    const options = useMemo(
        () => ({
            background: {
                color: {
                    value: baseColor
                }
            },
            fpsLimit: typeof window !== 'undefined' && window.innerWidth < 768 ? 120 : 0, // 0 = unlimited on PC, 120 on mobile
            interactivity: {
                events: {
                    onClick: {
                        enable: typeof window !== 'undefined' && window.innerWidth >= 768, // Disable on mobile
                        mode: 'repulse'
                    },
                    onHover: {
                        enable: typeof window !== 'undefined' && window.innerWidth >= 768, // Disable on mobile
                        mode: 'grab'
                    }
                },
                modes: {
                    repulse: {
                        distance: 150, // Reduced from 200
                        duration: 0.4
                    },
                    grab: {
                        distance: 120, // Reduced from 150
                        line_linked: {
                            opacity: 15
                        }
                    }
                }
            },
            particles: {
                color: {
                    value: foregroundColor
                },
                links: {
                    color: foregroundColor,
                    enable: false
                },
                move: {
                    direction: 'none' as const,
                    enable: true,
                    outModes: {
                        default: 'bounce' as const
                    },
                    random: true,
                    speed: 0.4, // Reduced from 0.6 for smoother performance
                    straight: false
                },
                number: {
                    density: {
                        enable: true
                    },
                    value: typeof window !== 'undefined' && window.innerWidth < 768 ? 25 : 50 // Significantly reduced from 40/80
                },
                opacity: {
                    value: 0.9
                },
                shape: {
                    type: 'circle'
                },
                size: {
                    value: { min: 1, max: 2.5 } // Slightly smaller particles
                }
            },
            detectRetina: false // Disable retina detection for performance
        }),
        [resolvedTheme]
    );

    const [isSuccess, setIsSuccess] = useState(false);

    useEffect(() => {
        const handleJobCompleted = () => {
            setIsSuccess(true);
            setTimeout(() => setIsSuccess(false), 2000);
        };

        window.addEventListener('job-completed', handleJobCompleted);
        return () => window.removeEventListener('job-completed', handleJobCompleted);
    }, []);

    const renderBackground = () => {
        switch (settings.background) {
            case 'particles':
                return (
                    <motion.div
                        key='particles'
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ type: 'spring', duration: 2 }}
                        exit={{ opacity: 0 }}
                    >
                        <Particles className={className} options={options} />
                    </motion.div>
                );
            case 'futuristic':
                return (
                    <motion.div
                        key='futuristic'
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ type: 'spring', duration: 2 }}
                        exit={{ opacity: 0 }}
                        className={cn(className, 'futuristic-background')}
                    >
                        <div className='grid-overlay' />
                        <div className='concentric-arcs-container'>
                            <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMax slice">
                                <circle cx="500" cy="500" r="490" fill="none" className="arc-1" stroke="currentColor" strokeWidth="1" />
                                <circle cx="500" cy="500" r="350" fill="none" className="arc-2" stroke="currentColor" strokeWidth="0.7" />
                                <circle cx="500" cy="500" r="210" fill="none" className="arc-3" stroke="currentColor" strokeWidth="0.4" />
                            </svg>
                        </div>
                        <div className='stars-container'>
                            {[...Array(12)].map((_, i) => (
                                <div key={i} className={cn('star', isSuccess && 'success-blink')} />
                            ))}
                        </div>
                    </motion.div>
                );
            default:
                return <div className={cn(className, 'bg-background')} />;
        }
    };

    return (
        <>
            <AnimatePresence>{renderBackground()}</AnimatePresence>
        </>
    );
};

export default ParticlesComponent;
