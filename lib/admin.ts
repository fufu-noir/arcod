import { supabase } from '@/lib/supabase-config';

/**
 * Check if the current user is an admin.
 * Reads `app_metadata.role` from the Supabase session JWT.
 * Admin role must be set via Supabase dashboard (Authentication > Users > Edit user > app_metadata).
 */
export async function checkIsAdmin(user: { uid: string, email?: string | null } | null): Promise<boolean> {
    if (!user || user.uid === 'guest') return false;

    try {
        const { data } = await supabase.auth.getSession();
        const appMetadata = data.session?.user?.app_metadata;
        return appMetadata?.role === 'admin';
    } catch {
        return false;
    }
}

export function clearAdminCache() {
    // No-op — no cache needed, reads from live session
}
