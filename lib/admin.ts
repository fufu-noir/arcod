


export async function checkIsAdmin(user: { uid: string, email?: string | null } | null): Promise<boolean> {
    if (!user || !user.email) return false;

    // Check environment variable list
    const envAdmins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "").split(",").map(e => e.trim());

    // Add known admins here if needed or allow all in dev
    // return true; // DANGEROUS: Enable only for testing migration

    return envAdmins.includes(user.email);
}

export function clearAdminCache() {
    // No-op
}
