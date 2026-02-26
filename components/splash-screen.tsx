'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ArcodLogo from './arcod-logo';

const SplashScreen = () => {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        // We match this delay with the logo's "drawing" phase
        const timer = setTimeout(() => {
            setIsVisible(false);
        }, 1800);

        return () => clearTimeout(timer);
    }, []);

    return (
        <AnimatePresence>
            {isVisible && (
                <>
                    <motion.div
                        key="curtain-container"
                        className="fixed inset-0 z-[10] pointer-events-none"
                        exit={{ opacity: 0, transition: { delay: 1.5, duration: 0.1 } }}
                    >
                        <svg className="w-full h-full">
                            <defs>
                                <mask id="reveal-mask">
                                    <rect width="100%" height="100%" fill="white" />
                                    <motion.circle
                                        cx="50%"
                                        cy="50%"
                                        initial={{ r: '0%' }}
                                        exit={{
                                            r: '150%',
                                            transition: {
                                                duration: 1.8,
                                                ease: [0.76, 0, 0.24, 1] // Cinematic expo-out
                                            }
                                        }}
                                        fill="black"
                                    />
                                </mask>
                            </defs>
                            {/* Uses the theme's background color for perfect adaptation */}
                            <rect width="100%" height="100%" fill="hsl(var(--background))" mask="url(#reveal-mask)" />
                        </svg>
                    </motion.div>
                    <motion.div
                        key="logo"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{
                            opacity: 0,
                            scale: 1.1,
                            filter: 'blur(10px)',
                            transition: { duration: 0.8, ease: [0.76, 0, 0.24, 1] }
                        }}
                        className="fixed inset-0 z-[20] flex items-center justify-center pointer-events-none"
                    >
                        <ArcodLogo size={220} showGlow={true} />
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

export default SplashScreen;
