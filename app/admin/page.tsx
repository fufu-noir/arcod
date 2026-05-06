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
    Server,
    HardDrive,
    Shuffle,
    Save,
} from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { checkIsAdmin } from '@/lib/admin';

import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

interface BlockedIP {
    ip: string;
    originalIp?: string;
    reason?: string;
    blockedAt: string;
    blockedBy?: string;
    expiresAt?: string;
    permanent?: boolean;
    autoban?: boolean;
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
        <div>
            <Card className="bg-card/60 backdrop-blur-sm border-border/50 overflow-hidden">
                <div className="flex flex-col sm:flex-row">
                    {isActive && (
                        <div className="absolute left-0 top-0 h-1 bg-primary/30 w-full">
                            <div
                                className="h-full bg-primary transition-all duration-500"
                                style={{ width: `${job.progress}%` }}
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
                                <span className="ml-2">Cancel</span>
                            </Button>
                        </div>
                    )}
                </div>
            </Card>
        </div>
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
    const [bulkCancelling, setBulkCancelling] = useState<string | null>(null);
    const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
    const [maintenanceMsg, setMaintenanceMsg] = useState('');
    const [togglingMaintenance, setTogglingMaintenance] = useState(false);

    // Routing config
    const [routingMode, setRoutingMode] = useState<'vps_only' | 'worker_only' | 'hybrid'>('hybrid');
    const [vpsMaxConcurrent, setVpsMaxConcurrent] = useState('3');
    const [vpsMaxTracks, setVpsMaxTracks] = useState('3');
    const [workerMaxClaim, setWorkerMaxClaim] = useState('20');
    const [savingRouting, setSavingRouting] = useState(false);

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
            const [jobsRes, ipsRes, rateRes, maintRes, routingRes] = await Promise.all([
                axios.get(`${API_BASE_URL}/jobs`, { headers: { Authorization: token } }),
                axios.get(`${API_BASE_URL}/admin/blocked-ips`, { headers: { Authorization: token } }),
                axios.get(`${API_BASE_URL}/admin/rate-limits`, { headers: { Authorization: token } }),
                axios.get(`${API_BASE_URL}/admin/maintenance`),
                axios.get(`${API_BASE_URL}/admin/routing`, { headers: { Authorization: token } }),
            ]);

            if (jobsRes.data.success) setJobs(jobsRes.data.jobs || []);
            setBlockedIPs(ipsRes.data.blockedIPs || []);
            setRateLimitedIPs(rateRes.data.rateLimitedIPs || []);
            setMaintenanceEnabled(maintRes.data.enabled);
            setMaintenanceMsg(maintRes.data.message || '');
            if (routingRes.data.routing) {
                const r = routingRes.data.routing;
                setRoutingMode(r.mode);
                setVpsMaxConcurrent(String(r.vpsMaxConcurrent));
                setVpsMaxTracks(String(r.vpsMaxTracks));
                setWorkerMaxClaim(String(r.workerMaxClaim));
            }
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

    const handleBulkCancel = async (statuses: string[], label: string) => {
        if (!user) return;
        setBulkCancelling(label);
        try {
            const token = await user.getIdToken();
            const res = await axios.post(`${API_BASE_URL}/admin/jobs/cancel-bulk`, { statuses }, { headers: { Authorization: token } });
            console.log(`Cancelled ${res.data.cancelled} jobs`);
            fetchData();
        } catch (error) {
            console.error('Bulk cancel error:', error);
        } finally {
            setBulkCancelling(null);
        }
    };

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

    const handleSaveRouting = async () => {
        if (!user) return;
        setSavingRouting(true);
        try {
            const token = await user.getIdToken();
            await axios.post(`${API_BASE_URL}/admin/routing`, {
                mode: routingMode,
                vpsMaxConcurrent: parseInt(vpsMaxConcurrent) || 3,
                vpsMaxTracks: parseInt(vpsMaxTracks) || 3,
                workerMaxClaim: parseInt(workerMaxClaim) || 20,
            }, { headers: { Authorization: token } });
        } catch (error) { console.error('Save routing error:', error); }
        finally { setSavingRouting(false); }
    };

    const handleToggleMaintenance = async () => {
        if (!user) return;
        setTogglingMaintenance(true);
        try {
            const token = await user.getIdToken();
            const newState = !maintenanceEnabled;
            await axios.post(`${API_BASE_URL}/admin/maintenance`, {
                enabled: newState,
                message: maintenanceMsg || undefined,
            }, { headers: { Authorization: token } });
            setMaintenanceEnabled(newState);
        } catch (error) { console.error(error); }
        finally { setTogglingMaintenance(false); }
    };

    if (isAuthorized === false) {
        return (
            <div className="w-full max-w-2xl mx-auto py-20">
                <Card className="bg-red-500/10 border-red-500/30">
                    <CardContent className="flex flex-col items-center gap-4 py-12">
                        <Shield className="h-16 w-16 text-red-400" />
                        <h1 className="text-2xl font-bold text-red-400">Access Denied</h1>
                        <Link href="/"><Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></Link>
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
                    <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></Link>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6 text-primary" />Admin Panel</h1>
                    <Link href="/admin/security"><Badge variant="outline" className="cursor-pointer hover:bg-primary/10 transition-colors border-primary/30 text-primary">Security Dashboard</Badge></Link>
                </div>
                <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={refreshing}><RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>
            </div>

            {/* Maintenance Mode Toggle */}
            <Card className={`mb-4 border-2 ${maintenanceEnabled ? 'bg-yellow-500/10 border-yellow-500/40' : 'bg-card/60 border-border/50'}`}>
                <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-3">
                        <AlertCircle className={`h-5 w-5 ${maintenanceEnabled ? 'text-yellow-400' : 'text-muted-foreground'}`} />
                        <div>
                            <p className="font-semibold text-sm">{maintenanceEnabled ? 'Maintenance ACTIVE' : 'Maintenance Mode'}</p>
                            <p className="text-[11px] text-muted-foreground">{maintenanceEnabled ? 'Site is blocked for users' : 'Enable to block new downloads'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Input placeholder="Message (optional)" value={maintenanceMsg} onChange={(e) => setMaintenanceMsg(e.target.value)} className="text-xs h-8 flex-1 sm:w-56" />
                        <Button onClick={handleToggleMaintenance} disabled={togglingMaintenance} size="sm" variant={maintenanceEnabled ? 'destructive' : 'default'} className={`whitespace-nowrap ${!maintenanceEnabled ? 'bg-yellow-500 hover:bg-yellow-600 text-black' : ''}`}>
                            {togglingMaintenance ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                            {maintenanceEnabled ? 'Disable' : 'Enable'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Routing Config — compact */}
            <Card className="mb-4 bg-card/60 border-border/50">
                <CardContent className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Shuffle className="h-4 w-4 text-primary" />
                            <span className="text-sm font-bold">Download Routing</span>
                        </div>
                        <Button onClick={handleSaveRouting} disabled={savingRouting} size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                            {savingRouting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            Save
                        </Button>
                    </div>
                    <div className="flex gap-2">
                        {([
                            { value: 'vps_only', label: 'VPS Only', icon: Server },
                            { value: 'worker_only', label: 'Worker Only', icon: HardDrive },
                            { value: 'hybrid', label: 'Hybrid', icon: Shuffle },
                        ] as const).map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setRoutingMode(opt.value)}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border transition-all text-xs font-semibold ${
                                    routingMode === opt.value
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border/50 text-muted-foreground hover:border-primary/30'
                                }`}
                            >
                                <opt.icon className="h-3.5 w-3.5" />
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <div className="flex-1 flex items-center gap-2">
                            <label className="text-[11px] text-muted-foreground whitespace-nowrap">VPS concurrent</label>
                            <Input type="number" value={vpsMaxConcurrent} onChange={(e) => setVpsMaxConcurrent(e.target.value)} className="h-7 text-xs w-16" />
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                            <label className="text-[11px] text-muted-foreground whitespace-nowrap">VPS max tracks</label>
                            <Input type="number" value={vpsMaxTracks} onChange={(e) => setVpsMaxTracks(e.target.value)} className="h-7 text-xs w-16" />
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                            <label className="text-[11px] text-muted-foreground whitespace-nowrap">Worker claim</label>
                            <Input type="number" value={workerMaxClaim} onChange={(e) => setWorkerMaxClaim(e.target.value)} className="h-7 text-xs w-16" />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <Card className="bg-card/60 border-border/50"><CardContent className="p-3 text-center"><div className="text-2xl font-bold text-blue-400">{activeJobs.length}</div><div className="text-[11px] text-muted-foreground">Active</div></CardContent></Card>
                <Card className="bg-card/60 border-border/50"><CardContent className="p-3 text-center"><div className="text-2xl font-bold text-green-400">{completedJobs.length}</div><div className="text-[11px] text-muted-foreground">Completed</div></CardContent></Card>
                <Card className="bg-card/60 border-border/50"><CardContent className="p-3 text-center"><div className="text-2xl font-bold text-red-400">{failedJobs.length}</div><div className="text-[11px] text-muted-foreground">Failed</div></CardContent></Card>
                <Card className="bg-card/60 border-border/50"><CardContent className="p-3 text-center"><div className="text-2xl font-bold text-foreground">{jobs.length}</div><div className="text-[11px] text-muted-foreground">Total</div></CardContent></Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* JOBS SECTION */}
                <div className="space-y-4">
                    <Card className="bg-background/80">
                        <CardHeader className="pb-2 p-4">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-bold">Active Jobs ({activeJobs.length})</CardTitle>
                                {activeJobs.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {(['pending', 'queued'] as const).some(s => activeJobs.some(j => j.status === s)) && (
                                            <Button size="sm" variant="outline" className="text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10 text-xs h-6 px-2" disabled={bulkCancelling !== null} onClick={() => handleBulkCancel(['pending', 'queued'], 'queue')}>
                                                {bulkCancelling === 'queue' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}Queue
                                            </Button>
                                        )}
                                        {activeJobs.some(j => j.status === 'downloading') && (
                                            <Button size="sm" variant="outline" className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10 text-xs h-6 px-2" disabled={bulkCancelling !== null} onClick={() => handleBulkCancel(['downloading'], 'downloading')}>
                                                {bulkCancelling === 'downloading' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}DL
                                            </Button>
                                        )}
                                        <Button size="sm" variant="destructive" className="text-xs h-6 px-2" disabled={bulkCancelling !== null} onClick={() => handleBulkCancel(['pending', 'queued', 'downloading', 'processing'], 'all')}>
                                            {bulkCancelling === 'all' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}Cancel All
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-2 p-4 pt-0">
                            {activeJobs.length === 0 ? <p className="text-center text-muted-foreground py-6 text-sm">No active jobs</p> :
                                <>{activeJobs.map(job => <JobCard key={job.id} job={job} onCancel={handleCancel} />)}</>}
                        </CardContent>
                    </Card>
                </div>

                {/* IPs SECTION */}
                <div className="space-y-4">
                    <Card className="bg-background/80">
                        <CardHeader className="pb-2 p-4"><CardTitle className="text-sm font-bold flex items-center gap-2"><Ban className="h-4 w-4 text-red-400" />Blocked IPs ({blockedIPs.length})</CardTitle></CardHeader>
                        <CardContent className="space-y-3 p-4 pt-0">
                            <div className="flex gap-2">
                                <Input placeholder="IP address" value={newIP} onChange={(e) => setNewIP(e.target.value)} className="h-8 text-xs" />
                                <Button onClick={handleAddBlockedIP} disabled={addingIP || !newIP} size="sm" className="bg-red-500 h-8"><Plus className="h-3.5 w-3.5" /></Button>
                            </div>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {blockedIPs.map(ip => (
                                    <div key={ip.ip} className="flex justify-between p-2 bg-red-500/10 rounded items-center">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono">{ip.originalIp || ip.ip.replace(/_/g, '.')}</span>
                                                {ip.permanent ? (
                                                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-red-500/30 text-red-400">perm</Badge>
                                                ) : ip.autoban ? (
                                                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/30 text-amber-400">temp</Badge>
                                                ) : null}
                                            </div>
                                            {ip.reason && <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">{ip.reason}</p>}
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => handleRemoveBlockedIP(ip.ip)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 w-7 p-0">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-background/80">
                        <CardHeader className="pb-2 p-4"><CardTitle className="text-sm font-bold flex items-center gap-2"><RefreshCw className="h-4 w-4 text-blue-400" />Rate Limits ({rateLimitedIPs.length})</CardTitle></CardHeader>
                        <CardContent className="space-y-3 p-4 pt-0">
                            <div className="flex gap-2">
                                <Input placeholder="IP" value={newRateLimitIP} onChange={(e) => setNewRateLimitIP(e.target.value)} className="h-8 text-xs" />
                                <Input placeholder="Max/h" type="number" className="w-16 h-8 text-xs" value={newRateLimitMax} onChange={(e) => setNewRateLimitMax(e.target.value)} />
                                <Button onClick={handleAddRateLimitedIP} disabled={addingRateLimitIP || !newRateLimitIP} size="sm" className="bg-blue-500 h-8"><Plus className="h-3.5 w-3.5" /></Button>
                            </div>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {rateLimitedIPs.map(ip => (
                                    <div key={ip.ip} className="flex justify-between p-2 bg-blue-500/10 rounded items-center">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-mono font-bold">{ip.ip.replace(/_/g, '.')}</span>
                                            <span className="text-[10px] opacity-70">{ip.maxDownloadsPerHour} dl/h{ip.reason ? ` — ${ip.reason}` : ''}</span>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => handleRemoveRateLimitedIP(ip.ip)} className="h-7 w-7 p-0"><Trash2 className="h-3.5 w-3.5" /></Button>
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
