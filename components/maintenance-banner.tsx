'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

export default function MaintenanceBanner() {
    const [enabled, setEnabled] = useState(false);
    const [message, setMessage] = useState('');
    const pathname = usePathname();

    useEffect(() => {
        let mounted = true;

        const check = async () => {
            try {
                const res = await axios.get(`${API_BASE_URL}/admin/maintenance`);
                if (mounted) {
                    setEnabled(res.data.enabled);
                    setMessage(res.data.message || '');
                }
            } catch {
                // Server unreachable — don't show banner
            }
        };

        check();
        const interval = setInterval(check, 30000);
        return () => { mounted = false; clearInterval(interval); };
    }, []);

    if (!enabled || pathname?.startsWith('/admin')) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
            <div className="max-w-md mx-4 text-center space-y-4">
                <div className="flex justify-center">
                    <div className="p-4 rounded-full bg-yellow-500/20 border border-yellow-500/30">
                        <AlertTriangle className="h-12 w-12 text-yellow-400" />
                    </div>
                </div>
                <h1 className="text-2xl font-bold text-white">Under Maintenance</h1>
                <p className="text-white/70 text-sm leading-relaxed">{message}</p>
                <p className="text-white/40 text-xs">Service will be back shortly.</p>
            </div>
        </div>
    );
}
