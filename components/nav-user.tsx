"use client";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Library, LogOut, Shield, User } from "lucide-react";
import { useHistoryPanel } from "@/lib/history-panel-context";
import { checkIsAdmin } from "@/lib/admin";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function NavUser() {
    const { user, logout, isGuest, guestRateLimit } = useAuth();
    const { togglePanel, isOpen } = useHistoryPanel();
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        if (user && !isGuest) {
            checkIsAdmin(user).then(setIsAdmin);
        } else {
            setIsAdmin(false);
        }
    }, [user, isGuest]);

    if (!user) return null;

    // Calculate progress percentage for guest mode
    const guestProgress = guestRateLimit
        ? ((guestRateLimit.limit - guestRateLimit.remaining) / guestRateLimit.limit) * 100
        : 0;

    // Determine color based on usage
    const getProgressColor = () => {
        if (!guestRateLimit) return 'bg-primary';
        const usagePercent = guestProgress;
        if (usagePercent >= 90) return 'bg-red-500';
        if (usagePercent >= 70) return 'bg-orange-500';
        if (usagePercent >= 50) return 'bg-yellow-500';
        return 'bg-emerald-500';
    };

    // Format time until reset
    const getResetTime = () => {
        if (!guestRateLimit?.resetsAt) return '';
        const resetDate = new Date(guestRateLimit.resetsAt);
        const now = new Date();
        const diffMs = resetDate.getTime() - now.getTime();
        const diffMins = Math.max(0, Math.ceil(diffMs / 60000));
        return diffMins > 0 ? `${diffMins}min` : 'now';
    };

    return (
        <div className="flex items-center gap-2">
            {isAdmin && (
                <Link href="/admin">
                    <Button
                        variant="outline"
                        size="sm"
                        className="transition-all duration-200 text-primary border-primary/30 hover:bg-primary/10"
                        style={{ borderRadius: '13px' }}
                    >
                        <Shield className="mr-2 h-4 w-4" />
                        Admin
                    </Button>
                </Link>
            )}

            {/* Guest Rate Limit Display */}
            {isGuest && guestRateLimit && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-full border border-border/50">
                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                <div className="flex flex-col gap-0.5 min-w-[60px]">
                                    <div className="flex items-center justify-between text-[10px]">
                                        <span className="text-muted-foreground">Guest</span>
                                        <span className="font-medium tabular-nums">
                                            {guestRateLimit.remaining}/{guestRateLimit.limit}
                                        </span>
                                    </div>
                                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-300 ${getProgressColor()}`}
                                            style={{ width: `${guestProgress}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                            <p className="font-medium">{guestRateLimit.remaining} downloads remaining</p>
                            <p className="text-muted-foreground">Resets in {getResetTime()}</p>
                            <p className="text-muted-foreground mt-1">Sign up for unlimited downloads!</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {/* Library button - only for authenticated users */}
            {!isGuest && (
                <Button
                    variant={isOpen ? "default" : "outline"}
                    size="sm"
                    onClick={togglePanel}
                    className="transition-all duration-200 h-8 w-8 sm:w-auto p-0 sm:px-3"
                    style={{ borderRadius: '13px' }}
                >
                    <Library className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Library</span>
                </Button>
            )}

            <div className="flex items-center gap-2 pl-2 border-l border-border/50">
                {user.photoURL && (
                    <img src={user.photoURL} alt="User" className="h-8 w-8 rounded-full border border-border" />
                )}
                <Button variant="ghost" size="icon" onClick={logout} title={isGuest ? "Exit Guest Mode" : "Logout"} style={{ borderRadius: '13px' }}>
                    <LogOut className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
