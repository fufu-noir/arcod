"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-config";
import type { User as SupabaseUser } from "@supabase/supabase-js";

// User interface used across the app (unchanged contract)
export interface User {
    uid: string;
    email: string | null;
    getIdToken: () => Promise<string>;
    displayName?: string | null;
    photoURL?: string | null;
    isGuest?: boolean;
}

// Guest rate limit info
export interface GuestRateLimitInfo {
    downloadsThisHour: number;
    limit: number;
    remaining: number;
    resetsAt: string;
    isLimited: boolean;
}

// Return type for signInWithEmail to handle migrated users
export interface SignInResult {
    success: boolean;
    requiresNewPassword?: boolean;
}

// Return type for checkEmailExists
export type EmailCheckResult = 'exists' | 'not_found' | 'force_reset';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    isGuest: boolean;
    guestRateLimit: GuestRateLimitInfo | null;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<SignInResult>;
    signUpWithEmail: (email: string, password: string) => Promise<void>;
    completeNewPassword: (newPassword: string) => Promise<void>;
    checkEmailExists: (email: string) => Promise<EmailCheckResult>;
    sendResetCode: (email: string) => Promise<void>;
    confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>;
    confirmSignUpWithCode: (email: string, code: string) => Promise<void>;
    resendSignUpCode: (email: string) => Promise<void>;
    continueAsGuest: () => void;
    refreshGuestRateLimit: () => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    isGuest: false,
    guestRateLimit: null,
    signInWithGoogle: async () => { },
    signInWithEmail: async () => ({ success: false }),
    signUpWithEmail: async () => { },
    completeNewPassword: async () => { },
    checkEmailExists: async () => 'not_found',
    sendResetCode: async () => { },
    confirmPasswordReset: async () => { },
    confirmSignUpWithCode: async () => { },
    resendSignUpCode: async () => { },
    continueAsGuest: () => { },
    refreshGuestRateLimit: async () => { },
    logout: async () => { },
});

export const useAuth = () => useContext(AuthContext);

function mapSupabaseUser(sbUser: SupabaseUser): User {
    return {
        uid: sbUser.id,
        email: sbUser.email || null,
        getIdToken: async () => {
            // Return current session token, refresh if needed
            const { data } = await supabase.auth.getSession();
            return data.session?.access_token || "";
        },
        displayName: sbUser.user_metadata?.full_name || sbUser.email?.split('@')[0] || "User",
        photoURL: sbUser.user_metadata?.avatar_url || null,
        isGuest: false,
    };
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [guestRateLimit, setGuestRateLimit] = useState<GuestRateLimitInfo | null>(null);

    const isGuest = user?.isGuest === true;

    // Fetch guest rate limit from API
    const fetchGuestRateLimit = async () => {
        try {
            const response = await fetch('/api/v2/guest/rate-limit');
            if (response.ok) {
                const data = await response.json();
                setGuestRateLimit(data);
            }
        } catch (error) {
            console.error('[AUTH] Failed to fetch guest rate limit:', error);
        }
    };

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(mapSupabaseUser(session.user));
                setGuestRateLimit(null);
            } else {
                // Check for stored guest session
                const storedGuest = typeof window !== 'undefined' ? localStorage.getItem('arcod_guest_session') : null;
                if (storedGuest) {
                    setUser({
                        uid: 'guest', email: null, getIdToken: async () => "",
                        displayName: "Guest", photoURL: null, isGuest: true,
                    });
                    fetchGuestRateLimit();
                } else {
                    setUser(null);
                }
            }
            setLoading(false);
        });

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                console.log(`[AUTH] Event: ${event}`);
                if (session?.user) {
                    if (typeof window !== 'undefined') {
                        localStorage.removeItem('arcod_guest_session');
                    }
                    setUser(mapSupabaseUser(session.user));
                    setGuestRateLimit(null);
                } else if (event === 'SIGNED_OUT') {
                    setUser(null);
                    setGuestRateLimit(null);
                }
                setLoading(false);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    // Refresh guest rate limit periodically
    useEffect(() => {
        if (!isGuest) return;
        const interval = setInterval(fetchGuestRateLimit, 30000);
        return () => clearInterval(interval);
    }, [isGuest]);

    const signInWithGoogle = async () => {
        try {
            console.log("[AUTH] Starting Google login");
            if (typeof window !== 'undefined') {
                localStorage.removeItem('arcod_guest_session');
            }
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.origin,
                },
            });
            if (error) throw error;
        } catch (error) {
            console.error("[AUTH] Google Login error:", error);
            throw error;
        }
    };

    const signInWithEmail = async (email: string, password: string): Promise<SignInResult> => {
        try {
            console.log("[AUTH] Starting email login");
            if (typeof window !== 'undefined') {
                localStorage.removeItem('arcod_guest_session');
            }
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (error) throw error;
            return { success: true };
        } catch (error: any) {
            console.error("[AUTH] Email login error:", error);
            throw error;
        }
    };

    const completeNewPassword = async (newPassword: string) => {
        void newPassword;
        // Not needed for Supabase — password update is handled via updateUser
        console.warn("[AUTH] completeNewPassword not needed with Supabase");
    };

    const signUpWithEmail = async (email: string, password: string) => {
        try {
            console.log("[AUTH] Starting email signup");
            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: window.location.origin,
                },
            });
            if (error) throw error;
            console.log("[AUTH] Signup successful, check email for confirmation");
        } catch (error) {
            console.error("[AUTH] Email signup error:", error);
            throw error;
        }
    };

    const confirmSignUpWithCode = async (email: string, code: string) => {
        try {
            console.log("[AUTH] Confirming signup with OTP");
            const { error } = await supabase.auth.verifyOtp({
                email,
                token: code,
                type: 'signup',
            });
            if (error) throw error;
        } catch (error) {
            console.error("[AUTH] Confirm signup error:", error);
            throw error;
        }
    };

    const resendSignUpCodeFn = async (email: string) => {
        try {
            console.log("[AUTH] Resending signup email");
            const { error } = await supabase.auth.resend({
                type: 'signup',
                email,
            });
            if (error) throw error;
        } catch (error) {
            console.error("[AUTH] Resend signup error:", error);
            throw error;
        }
    };

    const checkEmailExists = async (email: string): Promise<EmailCheckResult> => {
        void email;
        // Supabase doesn't expose a direct "does this email exist" check
        // Return 'exists' to let the login flow handle errors naturally
        return 'exists';
    };

    const sendResetCode = async (email: string): Promise<void> => {
        try {
            console.log("[AUTH] Sending password reset email");
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
            });
            if (error) throw error;
        } catch (error) {
            console.error("[AUTH] Send reset email error:", error);
            throw error;
        }
    };

    const confirmPasswordReset = async (email: string, code: string, newPassword: string): Promise<void> => {
        void email;
        void code;
        try {
            console.log("[AUTH] Updating password");
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw error;
        } catch (error) {
            console.error("[AUTH] Confirm password reset error:", error);
            throw error;
        }
    };

    const continueAsGuest = () => {
        console.log("[AUTH] Continuing as guest");
        if (typeof window !== 'undefined') {
            localStorage.setItem('arcod_guest_session', 'true');
        }
        setUser({
            uid: 'guest', email: null, getIdToken: async () => "",
            displayName: "Guest", photoURL: null, isGuest: true,
        });
        fetchGuestRateLimit();
    };

    const refreshGuestRateLimit = async () => {
        if (isGuest) await fetchGuestRateLimit();
    };

    const logout = async () => {
        try {
            if (typeof window !== 'undefined') {
                localStorage.removeItem('arcod_guest_session');
            }
            setGuestRateLimit(null);
            if (!isGuest) {
                await supabase.auth.signOut();
            }
            setUser(null);
        } catch (error) {
            console.error("[AUTH] Logout error:", error);
        }
    };

    return (
        <AuthContext.Provider value={{
            user, loading, isGuest, guestRateLimit,
            signInWithGoogle, signInWithEmail, signUpWithEmail,
            completeNewPassword, checkEmailExists, sendResetCode,
            confirmPasswordReset, confirmSignUpWithCode,
            resendSignUpCode: resendSignUpCodeFn,
            continueAsGuest, refreshGuestRateLimit, logout,
        }}>
            {children}
        </AuthContext.Provider>
    );
};
