'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
// import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import {
    ArrowLeft,
    RefreshCw,
    XCircle,
    Clock,
    User as UserIcon,
    Music,
    Download,
    AlertCircle,
    CheckCircle2,
    Loader2,
    Shield,
    Ban,
    Plus,
    Trash2,
    // Timer
} from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { checkIsAdmin } from '@/lib/admin';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

interface BlockedIP {
    ip: string;
    reason?: string;
    blockedAt: string;
    blockedBy?: string;
}

interface RateLimitedIP {
    ip: string;
    maxDownloadsPerHour: number;
    reason?: string;
    createdAt: string;
    createdBy?: string;
}

interface Job {
    id: string;
    type: 'album' | 'track';
    status: 'pending' | 'processing' | 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    description: string;
    createdAt: string;
    updatedAt: string;
    albumId: string;
    albumTitle?: string;
    artistName?: string | { display: string };
    trackCount?: number;
    trackId?: string | number | null;
    downloadUrl?: string;
    fileName?: string;
    error?: string;
    userId?: string;
    userEmail?: string;
}

function getArtistName(artistName: string | { display: string } | undefined): string | undefined {
    if (!artistName) return undefined;
    if (typeof artistName === 'string') return artistName;
    if (typeof artistName === 'object' && 'display' in artistName) return artistName.display;
    return undefined;
}

function formatDuration(startDate: string): string {
    const start = new Date(startDate).getTime();
    const now = Date.now();
    const diff = now - start;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function formatTime(dateString: string): string {
    return new Date(dateString).toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

function getStatusColor(status: Job['status']): string {
    switch (status) {
        case 'pending': case 'queued': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
        case 'processing': case 'downloading': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
        case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30';
        case 'failed': case 'cancelled': return 'bg-red-500/20 text-red-400 border-red-500/30';
        default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
}

function getStatusIcon(status: Job['status']) {
    switch (status) {
        case 'pending': case 'queued': return <Clock className="h-3.5 w-3.5" />;
        case 'processing': case 'downloading': return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
        case 'completed': return <CheckCircle2 className="h-3.5 w-3.5" />;
        case 'failed': case 'cancelled': return <AlertCircle className="h-3.5 w-3.5" />;
        default: return null;
    }
}

function JobCard({ job, onCancel }: { job: Job; onCancel: (id: string) => void }) {
    const [cancelling, setCancelling] = useState(false);
    const isActive = ['pending', 'processing', 'queued', 'downloading'].includes(job.status);

    const handleCancel = async () => {
        setCancelling(true);
        await onCancel(job.id);
        setCancelling(false);
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
            <Card className="bg-card/60 backdrop-blur-sm border-border/50 overflow-hidden">
                <div className="flex flex-col sm:flex-row">
                    {isActive && (
                        <div className="absolute left-0 top-0 h-1 bg-primary/30 w-full">
                            <motion.div
                                className="h-full bg-primary"
                                initial={{ width: 0 }}
                                animate={{ width: `${job.progress}%` }}
                                transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                            />
                        </div>
                    )}

                    <CardContent className="flex-1 p-4 pt-5">
                        <div className="flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Music className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        <h3 className="font-semibold text-foreground truncate">{job.albumTitle || job.albumId}</h3>
                                    </div>
                                    <p className="text-sm text-muted-foreground truncate pl-6">{getArtistName(job.artistName)}</p>
                                </div>
                                <Badge variant="outline" className={`flex items-center gap-1.5 ${getStatusColor(job.status)}`}>
                                    {getStatusIcon(job.status)}
                                    {job.status}
                                </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{job.description}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                <div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3.5 w-3.5" /><span>{formatTime(job.createdAt)}</span></div>
                                <div className="flex items-center gap-1.5 text-muted-foreground"><RefreshCw className="h-3.5 w-3.5" /><span>{formatDuration(job.createdAt)}</span></div>
                                <div className="flex items-center gap-1.5 text-muted-foreground"><Download className="h-3.5 w-3.5" /><span>{job.type}</span></div>
                                {job.userEmail && <div className="flex items-center gap-1.5 text-muted-foreground"><UserIcon className="h-3.5 w-3.5" /><span>{job.userEmail}</span></div>}
                            </div>
                        </div>
                    </CardContent>
                    {isActive && (
                        <div className="flex sm:flex-col items-center justify-center p-4 border-t sm:border-t-0 sm:border-l border-border/30">
                            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={cancelling} className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                                {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                                <span className="ml-2">Annuler</span>
                            </Button>
                        </div>
                    )}
                </div>
            </Card>
        </motion.div>
    );
}

export default function AdminPage() {
    const { user } = useAuth();
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    const [jobs, setJobs] = useState<Job[]>([]);
    // const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [blockedIPs, setBlockedIPs] = useState<BlockedIP[]>([]);
    const [newIP, setNewIP] = useState('');
    const [newReason, setNewReason] = useState('');
    const [addingIP, setAddingIP] = useState(false);

    const [rateLimitedIPs, setRateLimitedIPs] = useState<RateLimitedIP[]>([]);
    const [newRateLimitIP, setNewRateLimitIP] = useState('');
    const [newRateLimitMax, setNewRateLimitMax] = useState('10');
    const [newRateLimitReason, setNewRateLimitReason] = useState('');
    const [addingRateLimitIP, setAddingRateLimitIP] = useState(false);

    useEffect(() => {
        const check = async () => {
            if (user) {
                const adminStatus = await checkIsAdmin(user);
                setIsAuthorized(adminStatus);
            } else {
                setIsAuthorized(false);
            }
        };
        check();
    }, [user]);

    const fetchData = useCallback(async () => {
        if (!user || !isAuthorized) return;
        try {
            const token = await user.getIdToken();
            const [jobsRes, ipsRes, rateRes] = await Promise.all([
                axios.get(`${API_BASE_URL}/jobs`, { headers: { Authorization: token } }),
                axios.get(`${API_BASE_URL}/admin/blocked-ips`, { headers: { Authorization: token } }),
                axios.get(`${API_BASE_URL}/admin/rate-limits`, { headers: { Authorization: token } })
            ]);

            if (jobsRes.data.success) setJobs(jobsRes.data.jobs || []);
            setBlockedIPs(ipsRes.data.blockedIPs || []);
            setRateLimitedIPs(rateRes.data.rateLimitedIPs || []);
        } catch (error) {
            console.error('Fetch error:', error);
        } finally {
            // setLoading(false);
            setRefreshing(false);
        }
    }, [user, isAuthorized]);

    useEffect(() => {
        if (isAuthorized) {
            fetchData();
            const interval = setInterval(fetchData, 10000); // 10s refresh
            return () => clearInterval(interval);
        }
    }, [isAuthorized, fetchData]);

    const handleCancel = async (jobId: string) => {
        if (!user) return;
        try {
            const token = await user.getIdToken();
            await axios.post(`${API_BASE_URL}/jobs/${jobId}/cancel`, {}, { headers: { Authorization: token } });
            fetchData();
        } catch (error) {
            console.error('Cancel error:', error);
        }
    };

    const handleAddBlockedIP = async () => {
        if (!user || !newIP.trim()) return;
        setAddingIP(true);
        try {
            const token = await user.getIdToken();
            await axios.post(`${API_BASE_URL}/admin/blocked-ips`, {
                ip: newIP.trim(),
                reason: newReason.trim()
            }, { headers: { Authorization: token } });
            setNewIP(''); setNewReason('');
            fetchData();
        } catch (error) { console.error(error); } finally { setAddingIP(false); }
    };

    const handleRemoveBlockedIP = async (ip: string) => {
        if (!user) return;
        try {
            const token = await user.getIdToken();
            // The backend helps us by normalizing, but let's send the original IP format
            const originalIp = ip.replace(/_/g, '.');
            await axios.delete(`${API_BASE_URL}/admin/blocked-ips/${originalIp}`, { headers: { Authorization: token } });
            fetchData();
        } catch (error) { console.error(error); }
    };

    const handleAddRateLimitedIP = async () => {
        if (!user || !newRateLimitIP.trim()) return;
        setAddingRateLimitIP(true);
        try {
            const token = await user.getIdToken();
            await axios.post(`${API_BASE_URL}/admin/rate-limits`, {
                ip: newRateLimitIP.trim(),
                maxDownloadsPerHour: parseInt(newRateLimitMax),
                reason: newRateLimitReason.trim()
            }, { headers: { Authorization: token } });
            setNewRateLimitIP(''); setNewRateLimitReason('');
            fetchData();
        } catch (error) { console.error(error); } finally { setAddingRateLimitIP(false); }
    };

    const handleRemoveRateLimitedIP = async (ip: string) => {
        if (!user) return;
        try {
            const token = await user.getIdToken();
            const originalIp = ip.replace(/_/g, '.');
            await axios.delete(`${API_BASE_URL}/admin/rate-limits/${originalIp}`, { headers: { Authorization: token } });
            fetchData();
        } catch (error) { console.error(error); }
    };

    if (isAuthorized === false) {
        return (
            <div className="w-full max-w-2xl mx-auto py-20">
                <Card className="bg-red-500/10 border-red-500/30">
                    <CardContent className="flex flex-col items-center gap-4 py-12">
                        <Shield className="h-16 w-16 text-red-400" />
                        <h1 className="text-2xl font-bold text-red-400">Accès Refusé</h1>
                        <Link href="/"><Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />Retour</Button></Link>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (isAuthorized === null) {
        return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    const activeJobs = jobs.filter(j => ['pending', 'processing', 'queued', 'downloading'].includes(j.status));
    const completedJobs = jobs.filter(j => j.status === 'completed');
    const failedJobs = jobs.filter(j => ['failed', 'cancelled'].includes(j.status));

    return (
        <div className="w-full max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Retour</Button></Link>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6 text-primary" />Admin Panel</h1>
                </div>
                <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={refreshing}><RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />Actualiser</Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <Card className="bg-card/60 border-border/50"><CardContent className="p-4 text-center"><div className="text-3xl font-bold text-blue-400">{activeJobs.length}</div><div className="text-xs text-muted-foreground">En cours</div></CardContent></Card>
                <Card className="bg-card/60 border-border/50"><CardContent className="p-4 text-center"><div className="text-3xl font-bold text-green-400">{completedJobs.length}</div><div className="text-xs text-muted-foreground">Terminés</div></CardContent></Card>
                <Card className="bg-card/60 border-border/50"><CardContent className="p-4 text-center"><div className="text-3xl font-bold text-red-400">{failedJobs.length}</div><div className="text-xs text-muted-foreground">Échoués</div></CardContent></Card>
                <Card className="bg-card/60 border-border/50"><CardContent className="p-4 text-center"><div className="text-3xl font-bold text-foreground">{jobs.length}</div><div className="text-xs text-muted-foreground">Total</div></CardContent></Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* JOBS SECTION */}
                <div className="space-y-6">
                    <Card className="bg-background/80">
                        <CardHeader className="pb-3"><CardTitle className="text-lg">Jobs Actifs</CardTitle></CardHeader>
                        <CardContent className="space-y-3">
                            {activeJobs.length === 0 ? <p className="text-center text-muted-foreground py-8">Aucun job actif</p> :
                                <AnimatePresence>{activeJobs.map(job => <JobCard key={job.id} job={job} onCancel={handleCancel} />)}</AnimatePresence>}
                        </CardContent>
                    </Card>
                </div>

                {/* IPs SECTION */}
                <div className="space-y-6">
                    <Card className="bg-background/80">
                        <CardHeader className="pb-3"><CardTitle className="text-lg flex items-center gap-2"><Ban className="h-5 w-5 text-red-400" />IPs Bloquées ({blockedIPs.length})</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex gap-2">
                                <Input placeholder="IP" value={newIP} onChange={(e) => setNewIP(e.target.value)} />
                                <Button onClick={handleAddBlockedIP} disabled={addingIP || !newIP} className="bg-red-500"><Plus className="h-4 w-4" /></Button>
                            </div>
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {blockedIPs.map(ip => (
                                    <div key={ip.ip} className="flex justify-between p-2 bg-red-500/10 rounded items-center">
                                        <span className="text-sm font-mono">{ip.ip.replace(/_/g, '.')}</span>
                                        <Button variant="ghost" size="sm" onClick={() => handleRemoveBlockedIP(ip.ip)}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-background/80">
                        <CardHeader className="pb-3"><CardTitle className="text-lg flex items-center gap-2"><RefreshCw className="h-5 w-5 text-blue-400" />Limites de Débit ({rateLimitedIPs.length})</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-col gap-3">
                                <div className="flex gap-2">
                                    <Input placeholder="IP" value={newRateLimitIP} onChange={(e) => setNewRateLimitIP(e.target.value)} />
                                    <Input placeholder="Max/h" type="number" className="w-20" value={newRateLimitMax} onChange={(e) => setNewRateLimitMax(e.target.value)} />
                                </div>
                                <div className="flex gap-2">
                                    <Input placeholder="Raison" className="flex-1" value={newRateLimitReason} onChange={(e) => setNewRateLimitReason(e.target.value)} />
                                    <Button onClick={handleAddRateLimitedIP} disabled={addingRateLimitIP || !newRateLimitIP} className="bg-blue-500"><Plus className="h-4 w-4" /></Button>
                                </div>
                            </div>
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {rateLimitedIPs.map(ip => (
                                    <div key={ip.ip} className="flex justify-between p-2 bg-blue-500/10 rounded items-center">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-mono font-bold">{ip.ip.replace(/_/g, '.')}</span>
                                            <span className="text-xs opacity-70">{ip.maxDownloadsPerHour} dl/h - {ip.reason}</span>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => handleRemoveRateLimitedIP(ip.ip)}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
