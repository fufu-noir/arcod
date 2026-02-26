"use client";
import SearchView from './search-view';
import LoginView from '@/components/login-view';
import { useAuth } from '@/components/auth-provider';
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function Home() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex h-[50vh] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <AnimatePresence mode="wait">
            {!user ? (
                <motion.div
                    key="login"
                    className="w-full h-full flex items-center justify-center"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.05 }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                >
                    <LoginView />
                </motion.div>
            ) : (
                <motion.div
                    key="search"
                    className="w-full"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                >
                    <SearchView />
                </motion.div>
            )}
        </AnimatePresence>
    );
}
