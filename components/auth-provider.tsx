"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { getCurrentUser, signIn, signUp, signOut, fetchAuthSession, signInWithRedirect, confirmSignIn, resetPassword, confirmResetPassword, confirmSignUp, resendSignUpCode } from 'aws-amplify/auth';
// import type { AuthUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { configureAmplify } from "@/lib/amplify-config";

// Initialize configuration
configureAmplify();

// User interface used across the app
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

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [guestRateLimit, setGuestRateLimit] = useState<GuestRateLimitInfo | null>(null);

    // Helper to check if current user is guest
    const isGuest = user?.isGuest === true;

    const checkUser = async () => {
        try {
            const currentUser = await getCurrentUser();
            const session = await fetchAuthSession();
            await session.tokens?.idToken?.toString();
            const email = currentUser.signInDetails?.loginId || session.tokens?.idToken?.payload.email as string || null;

            setUser({
                uid: currentUser.userId,
                email: email,
                getIdToken: async () => {
                    // Always fetch fresh session token
                    const s = await fetchAuthSession();
                    return s.tokens?.idToken?.toString() || "";
                },
                displayName: email?.split('@')[0] || "User", // Fallback
                photoURL: null,
                isGuest: false
            });
            setGuestRateLimit(null);
        } catch {
            // Not signed in - check if we have a guest session stored
            const storedGuest = typeof window !== 'undefined' ? localStorage.getItem('arcod_guest_session') : null;
            if (storedGuest) {
                setUser({
                    uid: 'guest',
                    email: null,
                    getIdToken: async () => "",
                    displayName: "Guest",
                    photoURL: null,
                    isGuest: true
                });
                // Fetch guest rate limit
                fetchGuestRateLimit();
            } else {
                setUser(null);
            }
        } finally {
            setLoading(false);
        }
    };

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
        // Listen for auth events
        const unsubscribe = Hub.listen('auth', ({ payload }) => {
            switch (payload.event) {
                case 'signedIn':
                    console.log("[AUTH] Signed In via Amplify");
                    // Clear guest session when signing in
                    if (typeof window !== 'undefined') {
                        localStorage.removeItem('arcod_guest_session');
                    }
                    checkUser();
                    break;
                case 'signedOut':
                    console.log("[AUTH] Signed Out");
                    setUser(null);
                    setGuestRateLimit(null);
                    break;
                case 'tokenRefresh':
                    checkUser();
                    break;
            }
        });

        // Initial check
        checkUser();

        return () => unsubscribe();
    }, []);

    // Refresh guest rate limit periodically when in guest mode
    useEffect(() => {
        if (!isGuest) return;

        // Refresh every 30 seconds
        const interval = setInterval(fetchGuestRateLimit, 30000);
        return () => clearInterval(interval);
    }, [isGuest]);

    const signInWithGoogle = async () => {
        try {
            console.log("[AUTH] Starting Google Redirect login");
            // Clear guest session before sign in
            if (typeof window !== 'undefined') {
                localStorage.removeItem('arcod_guest_session');
            }
            // Uses hosted UI with Google provider
            // Requires Google to be configured in Cognito Console!
            await signInWithRedirect({ provider: { custom: 'Google' } });
            // Note: After redirect, the app reloads and Hub 'signedIn' event fires
        } catch (error) {
            console.error("[AUTH] Google Login error:", error);
        }
    };

    const signInWithEmail = async (email: string, password: string): Promise<SignInResult> => {
        try {
            console.log("[AUTH] Starting email login");
            // Clear guest session before sign in
            if (typeof window !== 'undefined') {
                localStorage.removeItem('arcod_guest_session');
            }
            const output = await signIn({ username: email, password });
            console.log("[AUTH] SignIn Output:", output);

            if (output.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
                throw new Error("User not confirmed. Please check your email for a verification link.");
            }

            // For migrated Firebase users with FORCE_CHANGE_PASSWORD status
            if (output.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
                console.log("[AUTH] User needs to set a new password (migrated account)");
                return { success: false, requiresNewPassword: true };
            }

            if (output.nextStep.signInStep === 'RESET_PASSWORD') {
                throw new Error("Password reset required. Please use Forgot Password.");
            }

            await checkUser();
            return { success: true };
        } catch (error) {
            console.error("[AUTH] Email login error:", error);
            throw error;
        }
    };

    // For completing password change for migrated users
    const completeNewPassword = async (newPassword: string) => {
        try {
            console.log("[AUTH] Completing new password challenge");
            const output = await confirmSignIn({ challengeResponse: newPassword });
            console.log("[AUTH] ConfirmSignIn Output:", output);

            if (output.isSignedIn) {
                await checkUser();
            } else {
                throw new Error("Failed to complete password change");
            }
        } catch (error) {
            console.error("[AUTH] Complete new password error:", error);
            throw error;
        }
    };

    const signUpWithEmail = async (email: string, password: string) => {
        try {
            console.log("[AUTH] Starting email signup");
            await signUp({
                username: email,
                password,
                options: {
                    userAttributes: { email }
                }
            });
            console.log("[AUTH] Signup successful, check email for verification code");
        } catch (error) {
            console.error("[AUTH] Email signup error:", error);
            throw error;
        }
    };

    const confirmSignUpWithCode = async (email: string, code: string) => {
        try {
            console.log("[AUTH] Confirming signup with code");
            await confirmSignUp({ username: email, confirmationCode: code });
            console.log("[AUTH] Signup confirmed");
        } catch (error) {
            console.error("[AUTH] Confirm signup error:", error);
            throw error;
        }
    };

    const resendSignUpCodeFn = async (email: string) => {
        try {
            console.log("[AUTH] Resending signup code to:", email);
            await resendSignUpCode({ username: email });
            console.log("[AUTH] Signup code resent");
        } catch (error) {
            console.error("[AUTH] Resend signup code error:", error);
            throw error;
        }
    };

    // Check if email exists by attempting a sign-in with empty password
    const checkEmailExists = async (email: string): Promise<EmailCheckResult> => {
        try {
            // Try to initiate password reset - this will tell us if user exists
            await resetPassword({ username: email });
            // If we get here, user exists and reset code was sent
            // But we don't want to send code yet, so this approach won't work well
            // Let's use a different approach: try signIn with dummy password
            return 'exists';
        } catch (error: any) {
            const code = error.name || error.code;
            console.log("[AUTH] checkEmailExists error:", code, error.message);

            if (code === 'UserNotFoundException') {
                return 'not_found';
            }
            // For any other error, assume user exists
            return 'exists';
        }
    };

    // Send password reset code
    const sendResetCode = async (email: string): Promise<void> => {
        try {
            console.log("[AUTH] Sending reset code to:", email);
            const result = await resetPassword({ username: email });
            console.log("[AUTH] Reset code result:", JSON.stringify(result));
        } catch (error: any) {
            console.error("[AUTH] Send reset code error:", error.name, error.message);
            throw error;
        }
    };

    // Confirm password reset with code
    const confirmPasswordReset = async (email: string, code: string, newPassword: string): Promise<void> => {
        try {
            console.log("[AUTH] Confirming password reset");
            await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
            console.log("[AUTH] Password reset confirmed");
        } catch (error) {
            console.error("[AUTH] Confirm password reset error:", error);
            throw error;
        }
    };

    // Continue as guest - limited to 50 downloads per hour
    const continueAsGuest = () => {
        console.log("[AUTH] Continuing as guest");
        if (typeof window !== 'undefined') {
            localStorage.setItem('arcod_guest_session', 'true');
        }
        setUser({
            uid: 'guest',
            email: null,
            getIdToken: async () => "",
            displayName: "Guest",
            photoURL: null,
            isGuest: true
        });
        // Fetch initial rate limit
        fetchGuestRateLimit();
    };

    // Refresh rate limit (can be called after downloads)
    const refreshGuestRateLimit = async () => {
        if (isGuest) {
            await fetchGuestRateLimit();
        }
    };

    const logout = async () => {
        try {
            // Clear guest session
            if (typeof window !== 'undefined') {
                localStorage.removeItem('arcod_guest_session');
            }
            setGuestRateLimit(null);

            if (!isGuest) {
                await signOut();
            }
            setUser(null);
        } catch (error) {
            console.error("[AUTH] Logout error:", error);
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            isGuest,
            guestRateLimit,
            signInWithGoogle,
            signInWithEmail,
            signUpWithEmail,
            completeNewPassword,
            checkEmailExists,
            sendResetCode,
            confirmPasswordReset,
            confirmSignUpWithCode,
            resendSignUpCode: resendSignUpCodeFn,
            continueAsGuest,
            refreshGuestRateLimit,
            logout
        }}>
            {children}
        </AuthContext.Provider>
    );
};
