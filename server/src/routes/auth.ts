import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

interface CheckEmailBody {
    email?: string;
}

interface SupabaseAdminUser {
    id: string;
    email?: string;
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
}

interface SupabaseAdminUsersResponse {
    users?: SupabaseAdminUser[];
}

function createSupabaseServiceToken(): string {
    const jwtSecret = config.supabase.jwtSecret || process.env.SUPABASE_JWT_SECRET;

    if (!jwtSecret) {
        throw new Error('SUPABASE_JWT_SECRET is not configured');
    }

    return jwt.sign(
        { role: 'service_role' },
        jwtSecret,
        {
            algorithm: 'HS256',
            expiresIn: '5m',
            issuer: 'supabase',
            audience: 'authenticated',
            subject: 'service_role',
        }
    );
}

async function findSupabaseUserByEmail(email: string): Promise<SupabaseAdminUser | null> {
    const supabaseUrl = config.supabase.url || process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
        throw new Error('Supabase admin configuration is incomplete');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const url = `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(normalizedEmail)}&per_page=1`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${createSupabaseServiceToken()}`,
            apikey: anonKey,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Supabase admin request failed with status ${response.status}`);
    }

    const data = await response.json() as SupabaseAdminUsersResponse;
    const users = data.users || [];
    return users.find((u) => (u.email || '').trim().toLowerCase() === normalizedEmail) ?? null;
}

function isConfirmedUser(user: SupabaseAdminUser): boolean {
    return !!(user.email_confirmed_at || user.confirmed_at);
}

function isMigratedUser(user: SupabaseAdminUser): boolean {
    const appMetadata = user.app_metadata || {};
    const userMetadata = user.user_metadata || {};

    return Boolean(
        appMetadata.firebase_id ||
        appMetadata.firebase_uid ||
        appMetadata.migrated_from_firebase ||
        userMetadata.firebase_id ||
        userMetadata.firebase_uid ||
        userMetadata.migrated_from_firebase
    );
}

export async function authRoutes(fastify: FastifyInstance) {
    fastify.post('/auth/check-migrated', async (req: FastifyRequest<{ Body: CheckEmailBody }>, reply: FastifyReply) => {
        const email = req.body?.email?.trim().toLowerCase();

        if (!email || !email.includes('@')) {
            return reply.code(400).send({
                error: 'A valid email is required',
            });
        }

        try {
            const user = await findSupabaseUserByEmail(email);

            if (!user) {
                return reply.send({
                    userExists: false,
                    isMigratedUser: false,
                    isConfirmed: false,
                });
            }

            return reply.send({
                userExists: true,
                isMigratedUser: isMigratedUser(user),
                isConfirmed: isConfirmedUser(user),
            });
        } catch (error) {
            fastify.log.error(error, '[Auth] Failed to check Supabase user state');
            return reply.code(500).send({
                error: 'Failed to check email status',
            });
        }
    });

    fastify.post('/auth/remove-firebase-id', async (_req: FastifyRequest, reply: FastifyReply) => {
        return reply.send({ success: true });
    });
}
