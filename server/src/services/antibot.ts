/**
 * anti-bot & rate limiting
 */
import { config } from '../config.js';
import {
    isIPBlocked as dbIsIPBlocked,
    blockIP,
    countUserDownloadsSince,
    countActiveJobsForUser,
    getGuestCount,
    incrementGuestCount,
    getIPTotalCount,
    incrementIPTotalCount,
} from '../db/client.js';
import type { FastifyRequest } from 'fastify';

// ======================== Bot Detection ========================

const BLOCKED_USER_AGENTS = [
    'java', 'python', 'curl', 'wget', 'httpie', 'postman',
    'scrapy', 'httpclient', 'go-http', 'node-fetch', 'axios',
    'bot', 'spider', 'crawl', 'scraper', 'phantomjs', 'headless',
    'selenium', 'puppeteer', 'playwright', 'mechanize', 'libwww',
    'apache-httpclient', 'okhttp', 'request/', 'http_request',
    'python-requests', 'python-urllib', 'aiohttp', 'grequests',
    'fuzz', 'nikto', 'sqlmap', 'nmap', 'masscan', 'dirbuster',
    'gobuster', 'wfuzz', 'burp', 'zap', 'nuclei'
];

const SUSPICIOUS_PATTERNS = [/^$/, /^\s+$/, /^Mozilla\/[45]\.0\s*$/];

export function isBotUserAgent(userAgent: string): { isBot: boolean; reason: string } {
    if (!userAgent || userAgent.trim() === '') return { isBot: true, reason: 'Empty user-agent' };
    const ua = userAgent.toLowerCase();

    for (const blocked of BLOCKED_USER_AGENTS) {
        if (ua.includes(blocked)) return { isBot: true, reason: `Blocked keyword: ${blocked}` };
    }
    for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(userAgent)) return { isBot: true, reason: 'Suspicious pattern' };
    }

    const hasBrowserIdent = ua.includes('chrome') || ua.includes('firefox') ||
        ua.includes('safari') || ua.includes('edge') || ua.includes('opera') || ua.includes('mobile');
    if (!hasBrowserIdent && ua.includes('mozilla')) {
        return { isBot: true, reason: 'Mozilla without browser ident' };
    }

    return { isBot: false, reason: '' };
}

// ======================== IP Extraction ========================

export function getClientIP(req: FastifyRequest): string {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
        const first = xff.split(',')[0]?.trim();
        if (first) return first;
    }

    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string') return realIp.trim();

    return req.ip || 'unknown';
}

// ======================== Rate Limit Helpers ========================

function getCurrentHourKey(): string {
    return new Date().toISOString().slice(0, 13);
}

interface RateLimitResult {
    allowed: boolean;
    reason: string;
    hourlyCount: number;
    dailyCount: number;
    hourlyLimit: number;
    dailyLimit: number;
    retryAfterSeconds?: number;
}

export function checkIPRateLimit(clientIp: string): RateLimitResult {
    const hourKey = getCurrentHourKey();
    const guestCount = getGuestCount(clientIp, hourKey);
    const authCount = getIPTotalCount(clientIp, hourKey);
    const totalCount = guestCount + authCount;

    if (totalCount >= config.ipHourlyLimit) {
        const minutesUntilReset = 60 - new Date().getMinutes();

        if (totalCount >= config.autobanHourlyThreshold) {
            blockIP(clientIp, `IP hourly abuse: ${totalCount} downloads`, { blockedBy: 'antibot-system' });
        }

        return {
            allowed: false,
            reason: `Too many downloads from your network (${config.ipHourlyLimit}/hour). Try again in ${minutesUntilReset} minute(s).`,
            hourlyCount: totalCount,
            dailyCount: totalCount,
            hourlyLimit: config.ipHourlyLimit,
            dailyLimit: 150,
            retryAfterSeconds: minutesUntilReset * 60,
        };
    }

    return { allowed: true, reason: '', hourlyCount: totalCount, dailyCount: totalCount, hourlyLimit: config.ipHourlyLimit, dailyLimit: 150 };
}

export function checkAuthUserRateLimit(userId: string, userEmail: string, clientIp: string): RateLimitResult {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const fiveMinAgo = new Date(now.getTime() - config.rapidWindowMs).toISOString();

    const hourlyCount = countUserDownloadsSince(userId, oneHourAgo);
    const dailyCount = countUserDownloadsSince(userId, oneDayAgo);
    const rapidCount = countUserDownloadsSince(userId, fiveMinAgo);

    // Rapid fire autoban
    if (rapidCount >= config.autobanRapidThreshold) {
        blockIP(clientIp, `Rapid fire: ${rapidCount} in 5 min (user: ${userEmail})`, { blockedBy: 'antibot-system' });
        return {
            allowed: false,
            reason: 'Too many downloads too quickly. Temporarily blocked for 15 minutes.',
            hourlyCount, dailyCount,
            hourlyLimit: config.authUserHourlyLimit, dailyLimit: config.authUserDailyLimit,
            retryAfterSeconds: 900,
        };
    }

    if (hourlyCount >= config.autobanHourlyThreshold) {
        blockIP(clientIp, `Hourly abuse: ${hourlyCount} in 1hr (user: ${userEmail})`, { blockedBy: 'antibot-system' });
        return {
            allowed: false, reason: `Hourly abuse limit exceeded. Temporarily blocked.`,
            hourlyCount, dailyCount,
            hourlyLimit: config.authUserHourlyLimit, dailyLimit: config.authUserDailyLimit,
            retryAfterSeconds: 900,
        };
    }

    if (hourlyCount >= config.authUserHourlyLimit) {
        return {
            allowed: false, reason: `Download limit reached (${config.authUserHourlyLimit}/hour).`,
            hourlyCount, dailyCount,
            hourlyLimit: config.authUserHourlyLimit, dailyLimit: config.authUserDailyLimit,
            retryAfterSeconds: (60 - now.getMinutes()) * 60,
        };
    }

    if (dailyCount >= config.authUserDailyLimit) {
        return {
            allowed: false, reason: `Daily limit reached (${config.authUserDailyLimit}/day).`,
            hourlyCount, dailyCount,
            hourlyLimit: config.authUserHourlyLimit, dailyLimit: config.authUserDailyLimit,
            retryAfterSeconds: 3600,
        };
    }

    return { allowed: true, reason: '', hourlyCount, dailyCount, hourlyLimit: config.authUserHourlyLimit, dailyLimit: config.authUserDailyLimit };
}

// ======================== Guest Rate Limit ========================

export function getGuestRateLimitStatus(ip: string) {
    const hourKey = getCurrentHourKey();
    const count = getGuestCount(ip, hourKey);
    const remaining = Math.max(0, config.guestHourlyLimit - count);
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);

    return {
        ip,
        downloadsThisHour: count,
        limit: config.guestHourlyLimit,
        remaining,
        resetsAt: nextHour.toISOString(),
        isLimited: count >= config.guestHourlyLimit,
    };
}

export function incrementGuest(ip: string): { count: number; isLimited: boolean } {
    const hourKey = getCurrentHourKey();
    const count = incrementGuestCount(ip, hourKey);
    return { count, isLimited: count > config.guestHourlyLimit };
}

// ======================== Full Security Check ========================

export interface SecurityCheckResult {
    allowed: boolean;
    statusCode: number;
    error?: string;
    message?: string;
    retryAfterSeconds?: number;
    rateLimit?: {
        hourlyLimit: number;
        hourlyRemaining: number;
        dailyLimit: number;
        dailyRemaining: number;
    };
}

export function runSecurityChecks(
    req: FastifyRequest,
    userId: string,
    userEmail: string,
    isGuest: boolean
): SecurityCheckResult {
    const clientIp = getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';

    // 1. Check IP block (manual admin bans only)
    const blockStatus = dbIsIPBlocked(clientIp);
    if (blockStatus.blocked) {
        const msg = blockStatus.permanent
            ? 'Your IP has been permanently blocked.'
            : blockStatus.expiresAt
                ? `Too many requests. Blocked until ${new Date(blockStatus.expiresAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`
                : 'Access denied.';
        return { allowed: false, statusCode: 403, error: 'Access denied', message: msg };
    }

    // 2. Bot check
    const botCheck = isBotUserAgent(userAgent);
    if (botCheck.isBot) {
        blockIP(clientIp, `Bot detected: ${botCheck.reason}`, { blockedBy: 'antibot-system' });
        return { allowed: false, statusCode: 403, error: 'Access denied' };
    }

    // No rate limiting — only the 30 GB library quota per user is enforced (checked elsewhere)
    return { allowed: true, statusCode: 200 };
}
