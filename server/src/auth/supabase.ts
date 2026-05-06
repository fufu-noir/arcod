/**
 * Supabase Auth — JWT verification via JWKS
 * Admin role is read from app_metadata.role in the JWT (set via Supabase dashboard)
 */
import { importJWK, jwtVerify } from 'jose';
import { config } from '../config.js';

export interface AuthUser {
    uid: string;
    email: string;
    groups?: string[];
}

// Cache the signing key
let cachedKey: any = null;
let keyFetchedAt = 0;
const KEY_CACHE_MS = 60 * 60 * 1000; // 1 hour

interface JWKKey {
    alg: string;
    kid: string;
    kty: string;
    [key: string]: unknown;
}

async function getSigningKey(): Promise<any> {
    const now = Date.now();
    if (cachedKey && (now - keyFetchedAt) < KEY_CACHE_MS) {
        return cachedKey;
    }

    const supabaseUrl = config.supabase?.url || process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl) {
        console.warn('SUPABASE_URL not configured');
        return null;
    }

    try {
        const headers: Record<string, string> = {};
        if (anonKey) headers['apikey'] = anonKey;

        const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, { headers });
        const jwks = (await res.json()) as { keys: JWKKey[] };

        if (!jwks.keys || jwks.keys.length === 0) {
            console.error('No keys in JWKS response');
            return null;
        }

        // Use the first (current) key
        const jwk = jwks.keys[0];
        cachedKey = await importJWK(jwk, jwk.alg);
        keyFetchedAt = now;
        console.log(`JWKS key loaded: ${jwk.kid} (${jwk.alg})`);
        return cachedKey;
    } catch (err) {
        console.error('Failed to fetch JWKS:', err);
        return null;
    }
}

export async function authenticateRequest(authHeader: string): Promise<AuthUser | null> {
    if (!authHeader) return null;

    const key = await getSigningKey();
    if (!key) return null;

    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

    try {
        const supabaseUrl = config.supabase?.url || process.env.SUPABASE_URL || '';
        const { payload } = await jwtVerify(token, key, {
            issuer: `${supabaseUrl}/auth/v1`,
        });

        const email = (payload.email as string) || '';
        const groups: string[] = [];

        // Read admin role from Supabase app_metadata (set via dashboard)
        const appMetadata = payload.app_metadata as Record<string, unknown> | undefined;
        if (appMetadata?.role === 'admin') {
            groups.push('Admins');
        }

        return {
            uid: payload.sub || '',
            email,
            groups,
        };
    } catch (err) {
        console.error('Token verification failed:', err);
        return null;
    }
}

export function isAdmin(user: AuthUser): boolean {
    return Array.isArray(user.groups) && user.groups.includes('Admins');
}
