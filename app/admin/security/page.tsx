'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import {
    ArrowLeft,
    RefreshCw,
    Shield,
    Ban,
    Loader2,
    Activity,
    Users,
    Zap,
    TrendingUp,
    Globe,
    AlertTriangle,
    Clock,
    Eye,
    Trash2
} from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { checkIsAdmin } from '@/lib/admin';

import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

interface SecurityStats {
    stats: {
        hourly: { total: number; guests: number; authenticated: number; uniqueUsers: number; uniqueIPs: number };
        daily: { total: number; guests: number; authenticated: number; uniqueUsers: number; uniqueIPs: number };
    };
    topUsers: {
        hourly: { email: string; count: number; size: number; isGuest: boolean }[];
        daily: { email: string; count: number; size: number; isGuest: boolean }[];
    };
    topIPs: {
        hourly: { ip: string; count: number; size: number }[];
        daily: { ip: string; count: number; size: number }[];
    };
    blocked: {
        total: number;
        autobanned: number;
        items: { ip: string; originalIp?: string; reason?: string; blockedAt?: string; autoban?: boolean; expiresAt?: string; permanent?: boolean }[];
    };
    recentDownloads: {
        id: string;
        userEmail: string;
        albumTitle: string;
        artistName: string;
        createdAt: string;
        status: string;
        fileSize: number;
    }[];
    limits: {
        authHourly: number;
        authDaily: number;
        ipHourly: number;
        guestHourly: number;
        concurrent: number;
        autoBanRapid: number;
        autoBanHourly: number;
        autoBanDaily: number;
    };
}

function formatSize(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getThreatLevel(hourlyTotal: number, autobanned: number): {
    level: string;
    color: string;
    bg: string;
    border: string;
} {
    if (autobanned > 3 || hourlyTotal > 100) {
        return { level: 'CRITICAL', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' };
    }
    if (autobanned > 0 || hourlyTotal > 50) {
        return { level: 'HIGH', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' };
    }
    if (hourlyTotal > 20) {
        return { level: 'MODERATE', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' };
    }
    return { level: 'LOW', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' };
}

function getUserThreat(count: number, limits: SecurityStats['limits']): string {
    if (count >= limits.autoBanHourly) return 'border-l-4 border-l-red-500 bg-red-500/5';
    if (count >= limits.authHourly) return 'border-l-4 border-l-orange-500 bg-orange-500/5';
    if (count >= limits.authHourly * 0.7) return 'border-l-4 border-l-yellow-500 bg-yellow-500/5';
    return '';
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function maskEmail(email: string): string {
    if (email.includes('guest_')) {
        const ip = email.split('guest_')[1]?.split('@')[0] || '';
        return `guest:${ip}`;
    }
    return email;
}

function StatCard({ label, value, subValue, icon: Icon, color }: {
    label: string;
    value: number | string;
    subValue?: string;
    icon: any;
    color: string;
}) {
    return (
        <Card className="bg-card/60 border-border/50 overflow-hidden">
            <CardContent className="p-4">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
                        <p className={`text-2xl font-bold mt-1 ${color}`}>
                            {value}
                        </p>
                        {subValue && <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>}
                    </div>
                    <div className={`p-2 rounded-lg ${color.replace('text-', 'bg-').replace('-400', '-500/10')}`}>
                        <Icon className={`h-5 w-5 ${color}`} />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export default function SecurityPage() {
    const { user } = useAuth();
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    const [data, setData] = useState<SecurityStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [view, setView] = useState<'hourly' | 'daily'>('hourly');
    const [rankingType, setRankingType] = useState<'user' | 'ip'>('user');
    const [showRecent, setShowRecent] = useState(true);

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
            const res = await axios.get(`${API_BASE_URL}/admin/security-stats`, {
                headers: { Authorization: token }
            });
            setData(res.data);
        } catch (error) {
            console.error('Failed to fetch security stats:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user, isAuthorized]);

    useEffect(() => {
        if (isAuthorized) {
            fetchData();
            const interval = setInterval(fetchData, 15000);
            return () => clearInterval(interval);
        }
    }, [isAuthorized, fetchData]);

    const handleRefresh = () => {
        setRefreshing(true);
        fetchData();
    };

    const handleUnban = async (ip: string) => {
        if (!user) return;
        try {
            const token = await user.getIdToken();
            const originalIp = ip.replace(/_/g, '.');
            await axios.delete(`${API_BASE_URL}/admin/blocked-ips/${originalIp}`, {
                headers: { Authorization: token }
            });
            fetchData();
        } catch (error) {
            console.error('Unban error:', error);
        }
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

    if (isAuthorized === null || loading) {
        return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    if (!data) return null;

    const threat = getThreatLevel(data.stats.hourly.total, data.blocked.autobanned);
    const currentStats = view === 'hourly' ? data.stats.hourly : data.stats.daily;
    const currentUsers = view === 'hourly' ? data.topUsers.hourly : data.topUsers.daily;
    const currentIPs = view === 'hourly' ? data.topIPs.hourly : data.topIPs.daily;

    const rawTopData = rankingType === 'user' ? currentUsers : currentIPs;
    const topData = rawTopData.map((item: any) => ({
        id: item.email || item.ip,
        label: rankingType === 'user' ? maskEmail(item.email) : item.ip,
        count: item.count,
        size: item.size || 0,
        isGuest: item.isGuest || false
    }));

    return (
        <div className="w-full max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Link href="/admin"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Admin</Button></Link>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Shield className="h-6 w-6 text-primary" />Security
                    </h1>
                    <Badge className={`${threat.bg} ${threat.color} ${threat.border} border`}>
                        {threat.level}
                    </Badge>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex rounded-lg overflow-hidden border border-border/50">
                        <button
                            onClick={() => setView('hourly')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'hourly' ? 'bg-primary text-primary-foreground' : 'bg-card/60 text-muted-foreground hover:text-foreground'}`}
                        >1H</button>
                        <button
                            onClick={() => setView('daily')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'daily' ? 'bg-primary text-primary-foreground' : 'bg-card/60 text-muted-foreground hover:text-foreground'}`}
                        >24H</button>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />Refresh
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                <StatCard label="Downloads" value={currentStats.total} icon={Activity} color="text-blue-400" subValue={`${currentStats.authenticated} auth / ${currentStats.guests} guest`} />
                <StatCard label="Users" value={currentStats.uniqueUsers} icon={Users} color="text-purple-400" />
                <StatCard label="Auth" value={currentStats.authenticated} icon={Zap} color="text-emerald-400" />
                <StatCard label="Guests" value={currentStats.guests} icon={Globe} color="text-amber-400" />
                <StatCard label="Blocked" value={data.blocked.total} icon={Ban} color="text-red-400" subValue={`${data.blocked.autobanned} auto-banned`} />
                <StatCard label="IPs" value={currentStats.uniqueIPs} icon={TrendingUp} color="text-cyan-400" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card className="bg-background/80 lg:col-span-2">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-purple-400" />
                                Top Downloaders ({view === 'hourly' ? '1h' : '24h'})
                            </span>
                            <div className="flex items-center gap-2">
                                <div className="flex rounded-lg overflow-hidden border border-border/50">
                                    <button
                                        onClick={() => setRankingType('user')}
                                        className={`px-3 py-1 text-xs font-medium transition-colors ${rankingType === 'user' ? 'bg-primary/20 text-primary' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
                                    >Users</button>
                                    <button
                                        onClick={() => setRankingType('ip')}
                                        className={`px-3 py-1 text-xs font-medium transition-colors ${rankingType === 'ip' ? 'bg-primary/20 text-primary' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
                                    >Guests IPs</button>
                                </div>
                                <span className="text-xs text-muted-foreground font-normal ml-2">{topData.length} items</span>
                            </div>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
                            {topData.map((u, i) => (
                                <div
                                    key={u.id}
                                    className={`flex items-center justify-between px-3 py-2 rounded-lg ${getUserThreat(u.count, data.limits)}`}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="text-xs text-muted-foreground w-5 text-right font-mono">{i + 1}</span>
                                        <div className="min-w-0">
                                            <p className="text-sm font-mono truncate">{u.label}</p>
                                        </div>
                                        {u.isGuest && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-400">guest</Badge>}
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400 font-mono">
                                            {formatSize(u.size)}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${u.count >= data.limits.autoBanHourly ? 'bg-red-500' : u.count >= data.limits.authHourly ? 'bg-orange-500' : 'bg-primary'}`}
                                                style={{ width: `${Math.min(100, (u.count / data.limits.autoBanHourly) * 100)}%` }}
                                            />
                                        </div>
                                        <span className="text-sm font-bold tabular-nums w-8 text-right">{u.count}</span>
                                    </div>
                                </div>
                            ))}
                            {topData.length === 0 && (
                                <p className="text-center text-muted-foreground py-8">No activity</p>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card className="bg-background/80">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Ban className="h-5 w-5 text-red-400" />
                                Blocked IPs ({data.blocked.total})
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                {data.blocked.items.map((ip) => (
                                    <div key={ip.ip} className="flex items-center justify-between px-3 py-2 bg-red-500/5 rounded-lg">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-mono truncate">{(ip.originalIp || ip.ip).replace(/_/g, '.')}</p>
                                                {ip.permanent ? (
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-500/30 text-red-400 flex-shrink-0">permanent</Badge>
                                                ) : ip.autoban ? (
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-400 flex-shrink-0">temp</Badge>
                                                ) : null}
                                            </div>
                                            {ip.reason && <p className="text-[11px] text-muted-foreground truncate">{ip.reason}</p>}
                                            {ip.expiresAt && !ip.permanent && (
                                                <p className="text-[10px] text-amber-400/70">expires {new Date(ip.expiresAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                                            )}
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => handleUnban(ip.ip)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 flex-shrink-0 h-7 w-7 p-0">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ))}
                                {data.blocked.items.length === 0 && (
                                    <p className="text-center text-muted-foreground py-4 text-sm">No blocked IPs</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-background/80">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-amber-400" />
                                Rate Limits
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between"><span className="text-muted-foreground">Auth user/hour</span><span className="font-mono">{data.limits.authHourly}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Auth user/day</span><span className="font-mono">{data.limits.authDaily}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Per IP/hour</span><span className="font-mono">{data.limits.ipHourly}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Guest/hour</span><span className="font-mono">{data.limits.guestHourly}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Concurrent jobs</span><span className="font-mono">{data.limits.concurrent}</span></div>
                                <div className="h-px bg-border/50 my-1" />
                                <p className="text-xs text-muted-foreground font-medium">Auto-ban thresholds</p>
                                <div className="flex justify-between"><span className="text-muted-foreground">5 min rapid</span><span className="font-mono text-red-400">{data.limits.autoBanRapid}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Hourly</span><span className="font-mono text-red-400">{data.limits.autoBanHourly}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Daily</span><span className="font-mono text-red-400">{data.limits.autoBanDaily}</span></div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Card className="bg-background/80">
                <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowRecent(!showRecent)}>
                    <CardTitle className="text-lg flex items-center justify-between">
                        <span className="flex items-center gap-2">
                            <Eye className="h-5 w-5 text-blue-400" />
                            Recent Downloads
                        </span>
                        <Button variant="ghost" size="sm" className="text-muted-foreground">
                            {showRecent ? 'Hide' : 'Show'}
                        </Button>
                    </CardTitle>
                </CardHeader>
                {showRecent && (
                    <div className="overflow-hidden">
                        <CardContent>
                            <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
                                {data.recentDownloads.map((dl) => (
                                    <div key={dl.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-card/60 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                            <span className="text-xs text-muted-foreground w-16 flex-shrink-0">{timeAgo(dl.createdAt)}</span>
                                            <span className="text-sm font-mono truncate text-muted-foreground w-40 flex-shrink-0">{maskEmail(dl.userEmail)}</span>
                                            <span className="text-sm truncate mr-2">{typeof dl.artistName === 'object' && dl.artistName !== null ? (dl.artistName as any).display : dl.artistName} — {dl.albumTitle}</span>
                                            {dl.fileSize > 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400 font-mono flex-shrink-0">{formatSize(dl.fileSize)}</Badge>}
                                        </div>
                                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 flex-shrink-0 ${dl.status === 'completed' ? 'border-green-500/30 text-green-400' : dl.status === 'failed' ? 'border-red-500/30 text-red-400' : 'border-blue-500/30 text-blue-400'}`}>
                                            {dl.status}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </div>
                )}
            </Card>
        </div>
    );
}
