'use client';
import React, { useEffect, useState } from 'react';
import StatusBar from './status-bar';


const StatusBarContainer = () => {
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) return null;
    return (
        <div className='fixed bottom-0 left-0 right-0 z-[100] pointer-events-none flex justify-center p-4 sm:p-8'>
            <StatusBar />
        </div>
    );
};

export default StatusBarContainer;
