'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface ArcodLogoProps {
    className?: string;
    size?: number;
    showGlow?: boolean;
}

const ArcodLogo = ({ className, size = 120, showGlow = false }: ArcodLogoProps) => {
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Main path animation
    const mainPathVariants = {
        hidden: {
            pathLength: 0,
            opacity: 0,
            scale: 0.9,
        },
        visible: {
            pathLength: 1,
            opacity: 1,
            scale: 1,
            transition: {
                pathLength: { duration: 1.5, ease: [0.43, 0.13, 0.23, 0.96], delay: 0.2 },
                opacity: { duration: 0.3, delay: 0.2 },
                scale: {
                    type: "spring",
                    stiffness: 100,
                    damping: 15,
                    delay: 0.2
                }
            }
        }
    };

    // Fill reveal
    const fillVariants = {
        hidden: { opacity: 0, filter: 'brightness(2) blur(5px)' },
        visible: {
            opacity: 1,
            filter: 'brightness(1) blur(0px)',
            transition: {
                delay: 1.7,
                duration: 0.8,
                ease: "easeOut"
            }
        }
    };

    return (
        <div className={cn("relative flex items-center justify-center", className)}>
            <div className="relative z-[100]" style={{ width: size, height: (size * 2553) / 3000 }}>
                {/* Background Lueur */}
                {showGlow && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.4 }}
                        transition={{ delay: 2.2, duration: 2 }}
                        className="absolute inset-[-60px] bg-primary/20 blur-[60px] rounded-full -z-10"
                    />
                )}

                <svg
                    viewBox="0 0 3000 2553"
                    className={cn(
                        "w-full h-full overflow-visible",
                        showGlow && "drop-shadow-[0_0_20px_hsl(var(--primary)/0.4)]"
                    )}
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <g className="text-primary">
                        <motion.path
                            d="m17 2486.33l1229.15-2465.33 525.92 1.98 1210.39 2463.35h-518.75c-45.22 0-124.14-56.55-149.73-95.26l-226.06-443.39h-902.71l277.76-579.46h334.94l-285.65-590.95-16.84-0.97-782.65 1584.91c-25.1 52.79-109.42 125.12-168.85 125.12z"
                            variants={mainPathVariants}
                            initial="hidden"
                            animate={isMounted ? "visible" : "hidden"}
                            stroke="currentColor"
                            strokeWidth="45"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <motion.path
                            d="m2680.3 1506.95l-441.24-889.49 706.73 301.8c34.39 37.9 48.35 89.66 21.76 136.19-98.04 148.79-182.18 308.06-287.25 451.5z"
                            variants={mainPathVariants}
                            initial="hidden"
                            animate={isMounted ? "visible" : "hidden"}
                            stroke="currentColor"
                            strokeWidth="45"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <motion.path
                            d="m2251.31 629.62q20.42 18.37 40.84 36.73"
                            variants={mainPathVariants}
                            initial="hidden"
                            animate={isMounted ? "visible" : "hidden"}
                            stroke="currentColor"
                            strokeWidth="80"
                            strokeLinecap="round"
                        />

                        {/* Final Fill Reveal */}
                        <motion.g
                            variants={fillVariants}
                            initial="hidden"
                            animate={isMounted ? "visible" : "hidden"}
                        >
                            <path
                                d="m17 2486.33l1229.15-2465.33 525.92 1.98 1210.39 2463.35h-518.75c-45.22 0-124.14-56.55-149.73-95.26l-226.06-443.39h-902.71l277.76-579.46h334.94l-285.65-590.95-16.84-0.97-782.65 1584.91c-25.1 52.79-109.42 125.12-168.85 125.12z"
                                fill="currentColor"
                            />
                            <path
                                d="m2680.3 1506.95l-441.24-889.49 706.73 301.8c34.39 37.9 48.35 89.66 21.76 136.19-98.04 148.79-182.18 308.06-287.25 451.5z"
                                fill="currentColor"
                            />
                        </motion.g>
                    </g>
                </svg>
            </div>
        </div>
    );
};

export default ArcodLogo;
