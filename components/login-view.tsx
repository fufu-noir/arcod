"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-provider";
import { PrivacyPolicyContent } from "@/components/legal/privacy-policy-content";
import { TermsContent } from "@/components/legal/terms-content";
import { FaGoogle } from "@react-icons/all-files/fa/FaGoogle";
import { Mail, Lock, ArrowLeft, ArrowRight, Send, User } from "lucide-react";
import ArcodLogo from "./arcod-logo";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { checkUserStatus, removeFirebaseId } from "@/lib/migration-helpers";

type AuthStep = 'choose' | 'email-input' | 'migrated-code' | 'password-input' | 'signup' | 'confirm-signup';
type ConfirmationSource = 'signup' | 'existing';
type SignupSource = 'email' | 'password';
const LEGAL_ACCEPTANCE_ERROR = "Please accept the Terms of Use and Privacy Policy to continue.";

const LoginView = () => {
    const { signInWithGoogle, signInWithEmail, signUpWithEmail, sendResetCode, confirmPasswordReset, confirmSignUpWithCode, resendSignUpCode, continueAsGuest } = useAuth();
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
    const [termsOpen, setTermsOpen] = useState(false);
    const [privacyOpen, setPrivacyOpen] = useState(false);

    const [step, setStep] = useState<AuthStep>('choose');
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [resetCode, setResetCode] = useState("");
    const [signupCode, setSignupCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmNewPassword, setConfirmNewPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [codeSent, setCodeSent] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [confirmationSource, setConfirmationSource] = useState<ConfirmationSource>('signup');
    const [signupSource, setSignupSource] = useState<SignupSource>('email');
    const hasAcceptedLegalDocuments = acceptedTerms && acceptedPrivacy;

    useEffect(() => {
        if (cooldown > 0) {
            const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [cooldown]);

    useEffect(() => {
        if (hasAcceptedLegalDocuments && error === LEGAL_ACCEPTANCE_ERROR) {
            setError(null);
        }
    }, [error, hasAcceptedLegalDocuments]);

    const requireLegalAcceptance = () => {
        if (!hasAcceptedLegalDocuments) {
            setError(LEGAL_ACCEPTANCE_ERROR);
            return false;
        }
        return true;
    };

    const handleGoogleSignIn = () => {
        if (!requireLegalAcceptance()) return;
        signInWithGoogle();
    };

    const handleGuestContinue = () => {
        if (!requireLegalAcceptance()) return;
        continueAsGuest();
    };

    const handleEmailContinue = async () => {
        if (!requireLegalAcceptance()) return;
        if (!email.trim() || !email.includes('@')) {
            setError("Please enter a valid email");
            return;
        }
        setError(null);
        setIsLoading(true);

        try {
            const { userExists, isMigratedUser, isConfirmed } = await checkUserStatus(email);
            if (!userExists) {
                setSignupSource('email');
                setConfirmationSource('signup');
                setStep('signup');
            } else if (isMigratedUser) {
                setStep('migrated-code');
            } else if (!isConfirmed) {
                setConfirmationSource('existing');
                setSignupCode("");
                setCodeSent(false);
                setCooldown(0);
                setNewPassword("");
                setConfirmNewPassword("");
                setStep('confirm-signup');
            } else {
                setStep('password-input');
            }
        } catch {
            setStep('password-input');
        } finally {
            setIsLoading(false);
        }
    };

    const goToSignup = () => {
        setError(null);
        setPassword("");
        setResetCode("");
        setSignupCode("");
        setCodeSent(false);
        setCooldown(0);
        setNewPassword("");
        setConfirmNewPassword("");
        setSignupSource('password');
        setConfirmationSource('signup');
        setStep('signup');
    };

    const handleSendCode = async () => {
        if (!requireLegalAcceptance()) return;
        if (cooldown > 0) return;
        setIsLoading(true);
        try {
            await sendResetCode(email);
            setCodeSent(true);
            setCooldown(60);
            setError(null);
        } catch (err: any) {
            setError(err.message || "Failed to send code");
        } finally {
            setIsLoading(false);
        }
    };

    const handleMigratedSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!requireLegalAcceptance()) return;
        if (!resetCode || resetCode.length < 6) {
            setError("Enter the 6-digit code");
            return;
        }
        if (newPassword !== confirmNewPassword) {
            setError("Passwords do not match");
            return;
        }
        if (newPassword.length < 8) {
            setError("Password must be at least 8 characters");
            return;
        }

        setError(null);
        setIsLoading(true);

        try {
            await confirmPasswordReset(email, resetCode, newPassword);
            await removeFirebaseId(email);
            await signInWithEmail(email, newPassword);
        } catch (err: any) {
            setError(err.message || "Failed to reset password");
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!requireLegalAcceptance()) return;
        if (!password) {
            setError("Enter your password");
            return;
        }
        setError(null);
        setIsLoading(true);

        try {
            const result = await signInWithEmail(email, password);
            if (result.requiresNewPassword) {
                await sendResetCode(email);
                setStep('migrated-code');
                setCodeSent(true);
                setCooldown(60);
            }
        } catch (err: any) {
            const code = err?.code || err?.name;
            const message = String(err?.message || '').toLowerCase();

            if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
                setConfirmationSource('existing');
                setSignupCode("");
                setStep('confirm-signup');
            } else if (
                code === 'NotAuthorizedException' ||
                code === 'invalid_credentials' ||
                message.includes('invalid login credentials')
            ) {
                setError("Incorrect email or password");
            } else if (code === 'UserNotFoundException') {
                setSignupSource('password');
                setConfirmationSource('signup');
                setPassword("");
                setStep('signup');
            } else {
                setError(err.message || "An error occurred");
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!requireLegalAcceptance()) return;
        if (newPassword !== confirmNewPassword) {
            setError("Passwords do not match");
            return;
        }
        if (newPassword.length < 8) {
            setError("Password must be at least 8 characters");
            return;
        }
        setError(null);
        setIsLoading(true);

        try {
            await signUpWithEmail(email, newPassword);
            setConfirmationSource('signup');
            setStep('confirm-signup');
        } catch (err: any) {
            setError(err.message || "Failed to create account");
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!requireLegalAcceptance()) return;
        if (!signupCode || signupCode.length < 6) {
            setError("Enter the 6-digit code");
            return;
        }
        setError(null);
        setIsLoading(true);

        try {
            await confirmSignUpWithCode(email, signupCode);

            if (confirmationSource === 'signup' && newPassword) {
                await signInWithEmail(email, newPassword);
            } else {
                setSignupCode("");
                setStep('password-input');
            }
        } catch (err: any) {
            setError(err.message || "Failed to confirm signup");
        } finally {
            setIsLoading(false);
        }
    };

    const goBack = () => {
        setError(null);
        setCodeSent(false);
        if (step === 'email-input') {
            setStep('choose');
            setEmail("");
        } else if (step === 'signup') {
            setStep(signupSource === 'password' ? 'password-input' : 'email-input');
            setNewPassword("");
            setConfirmNewPassword("");
        } else if (step === 'password-input' || step === 'migrated-code') {
            setStep('email-input');
            setPassword("");
            setResetCode("");
            setNewPassword("");
            setConfirmNewPassword("");
        } else if (step === 'confirm-signup') {
            setStep(confirmationSource === 'signup' ? 'signup' : 'email-input');
            setSignupCode("");
        }
    };

    const renderStep = () => {
        switch (step) {
            case 'choose':
                return (
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold text-center">Welcome to ARCOD</h2>
                        <p className="text-sm text-muted-foreground text-center">Choose how you want to sign in</p>
                        <div className="space-y-3 pt-4">
                            <Button onClick={() => setStep('email-input')} size="lg" className="w-full gap-3 text-lg" disabled={!hasAcceptedLegalDocuments}>
                                <Mail className="w-5 h-5" /> Continue with Email
                            </Button>
                            <Button onClick={handleGoogleSignIn} variant="outline" size="lg" className="w-full gap-3 text-lg" disabled={!hasAcceptedLegalDocuments}>
                                <FaGoogle className="w-5 h-5" /> Continue with Google
                            </Button>

                            {/* Separator */}
                            <div className="relative py-2">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-border/50" />
                                </div>
                                <div className="relative flex justify-center text-xs">
                                    <span className="bg-card px-2 text-muted-foreground">or</span>
                                </div>
                            </div>

                            {/* Guest Mode Button */}
                            <Button
                                onClick={handleGuestContinue}
                                variant="ghost"
                                size="lg"
                                className="w-full gap-3 text-base border border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
                                disabled={!hasAcceptedLegalDocuments}
                            >
                                <User className="w-5 h-5" />
                                <span className="flex flex-col items-start">
                                    <span>Continue as Guest</span>
                                    <span className="text-[10px] text-muted-foreground font-normal">No account needed</span>
                                </span>
                            </Button>
                        </div>
                    </div>
                );

            case 'email-input':
                return (
                    <div className="space-y-4">
                        <button onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                            <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        <h2 className="text-xl font-semibold">Enter your email</h2>
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                                <Input id="email" type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10" onKeyDown={(e) => e.key === 'Enter' && handleEmailContinue()} autoFocus />
                            </div>
                        </div>
                        {error && <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>}
                        <Button onClick={handleEmailContinue} size="lg" className="w-full gap-2" disabled={isLoading || !hasAcceptedLegalDocuments}>
                            {isLoading ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
                        </Button>
                    </div>
                );

            case 'migrated-code':
                return (
                    <form onSubmit={handleMigratedSubmit} className="space-y-4">
                        <button type="button" onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                            <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        <h2 className="text-xl font-semibold">Reset Your Password</h2>
                        <p className="text-sm text-muted-foreground">Your account was migrated. Set a new password to continue.</p>

                        <div className="space-y-2">
                            <div className="flex gap-2">
                                <Input id="code" placeholder="123456" value={resetCode} onChange={(e) => setResetCode(e.target.value)} maxLength={6} className="flex-1" />
                                <Button type="button" onClick={handleSendCode} disabled={cooldown > 0 || isLoading || !hasAcceptedLegalDocuments} variant="outline" className="gap-2">
                                    <Send className="w-4 h-4" /> {cooldown > 0 ? `${cooldown}s` : 'Send Code'}
                                </Button>
                            </div>
                            {codeSent && <p className="text-xs text-green-500">Code sent to {email}</p>}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="newPassword">New Password</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                                <Input id="newPassword" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="pl-10" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="confirmNewPassword">Confirm Password</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                                <Input id="confirmNewPassword" type="password" placeholder="••••••••" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} className="pl-10" />
                            </div>
                        </div>

                        {error && <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>}
                        <Button type="submit" size="lg" className="w-full" disabled={isLoading || !codeSent || !hasAcceptedLegalDocuments}>
                            {isLoading ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : "Set Password & Sign In"}
                        </Button>
                    </form>
                );

            case 'password-input':
                return (
                    <form onSubmit={handlePasswordSubmit} className="space-y-4">
                        <button type="button" onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                            <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        <h2 className="text-xl font-semibold">Enter your password</h2>
                        <p className="text-sm text-muted-foreground">{email}</p>
                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-10" autoFocus />
                            </div>
                        </div>
                        {error && <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>}
                        <Button type="submit" size="lg" className="w-full" disabled={isLoading || !hasAcceptedLegalDocuments}>
                            {isLoading ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : "Sign In"}
                        </Button>
                        <button
                            type="button"
                            onClick={goToSignup}
                            className="w-full text-sm text-primary font-semibold hover:underline"
                        >
                            No account yet? Create one
                        </button>
                    </form>
                );

            case 'signup':
                return (
                    <form onSubmit={handleSignUp} className="space-y-4">
                        <button type="button" onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                            <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        <h2 className="text-xl font-semibold">Create an account</h2>
                        <p className="text-sm text-muted-foreground">{email}</p>
                        <div className="space-y-2">
                            <Label htmlFor="signupPassword">Password</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                                <Input id="signupPassword" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="pl-10" required autoFocus />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="signupConfirm">Confirm Password</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
                                <Input id="signupConfirm" type="password" placeholder="••••••••" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} className="pl-10" required />
                            </div>
                        </div>
                        {error && <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>}
                        <Button type="submit" size="lg" className="w-full" disabled={isLoading || !hasAcceptedLegalDocuments}>
                            {isLoading ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : "Create Account"}
                        </Button>
                    </form>
                );

            case 'confirm-signup':
                return (
                    <form onSubmit={handleConfirmSignUp} className="space-y-4">
                        <button type="button" onClick={goBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                            <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        <h2 className="text-xl font-semibold">{confirmationSource === 'signup' ? 'Verify your email' : 'Confirm your email'}</h2>
                        <p className="text-sm text-muted-foreground">
                            {confirmationSource === 'signup'
                                ? `We sent a code to ${email}`
                                : `This account exists but the email has not been confirmed yet. Enter the code sent to ${email}, or resend it.`}
                        </p>
                        <div className="space-y-2">
                            <Label htmlFor="signupCode">Verification Code</Label>
                            <div className="flex gap-2">
                                <Input id="signupCode" type="text" placeholder="123456" value={signupCode} onChange={(e) => setSignupCode(e.target.value)} maxLength={6} autoFocus className="flex-1" />
                                <Button type="button" variant="outline" disabled={cooldown > 0 || isLoading || !hasAcceptedLegalDocuments} onClick={async () => {
                                    if (!requireLegalAcceptance()) return;
                                    setIsLoading(true);
                                    try {
                                        await resendSignUpCode(email);
                                        setCooldown(60);
                                    } catch (err: any) {
                                        setError(err.message || "Failed to resend code");
                                    } finally {
                                        setIsLoading(false);
                                    }
                                }} className="gap-2">
                                    <Send className="w-4 h-4" /> {cooldown > 0 ? `${cooldown}s` : 'Resend'}
                                </Button>
                            </div>
                        </div>
                        {error && <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>}
                        <Button type="submit" size="lg" className="w-full" disabled={isLoading || !hasAcceptedLegalDocuments}>
                            {isLoading ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : "Verify & Sign In"}
                        </Button>
                    </form>
                );
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 px-4">
            <ArcodLogo size={140} />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card/80 backdrop-blur-xl border border-border/50 rounded-2xl p-8 shadow-2xl max-w-md w-full">
                <AnimatePresence mode="wait">
                    <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                        {renderStep()}
                    </motion.div>
                </AnimatePresence>
                <div className="space-y-3 pt-6 mt-6 border-t border-border/50">
                    <div className="flex items-start space-x-3">
                        <Checkbox id="terms" checked={acceptedTerms} onCheckedChange={(c) => setAcceptedTerms(c === true)} className="mt-1" />
                        <div className="space-y-1">
                            <label htmlFor="terms" className="block cursor-pointer text-sm text-muted-foreground">
                                I have read and accept the Terms of Use.
                            </label>
                            <button type="button" onClick={() => setTermsOpen(true)} className="text-sm font-semibold text-primary underline">
                                Read the Terms of Use
                            </button>
                        </div>
                    </div>
                    <div className="flex items-start space-x-3">
                        <Checkbox id="privacy" checked={acceptedPrivacy} onCheckedChange={(c) => setAcceptedPrivacy(c === true)} className="mt-1" />
                        <div className="space-y-1">
                            <label htmlFor="privacy" className="block cursor-pointer text-sm text-muted-foreground">
                                I have read and accept the Privacy Policy.
                            </label>
                            <button type="button" onClick={() => setPrivacyOpen(true)} className="text-sm font-semibold text-primary underline">
                                Read the Privacy Policy
                            </button>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground/80">
                        Both checkboxes are required to continue with sign in, sign up, or guest access.
                    </p>
                </div>
            </motion.div>
            <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh]">
                    <DialogHeader><DialogTitle>Terms of Use & Disclaimer</DialogTitle></DialogHeader>
                    <ScrollArea className="h-[60vh] pr-4">
                        <div className="text-sm">
                            <TermsContent />
                        </div>
                    </ScrollArea>
                </DialogContent>
            </Dialog>
            <Dialog open={privacyOpen} onOpenChange={setPrivacyOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh]">
                    <DialogHeader><DialogTitle>Privacy Policy</DialogTitle></DialogHeader>
                    <ScrollArea className="h-[60vh] pr-4">
                        <div className="text-sm">
                            <PrivacyPolicyContent />
                        </div>
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default LoginView;
