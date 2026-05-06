import { isIP } from 'node:net';
import { NextRequest } from 'next/server';

function normalizeIpToken(value?: string | null): string | null {
    if (!value) return null;

    const trimmed = value.trim().replace(/^"|"$/g, '');
    if (!trimmed) return null;

    if (isIP(trimmed)) return trimmed;

    const bracketMatch = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (bracketMatch && isIP(bracketMatch[1])) {
        return bracketMatch[1];
    }

    const ipv4WithPortMatch = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
    if (ipv4WithPortMatch && isIP(ipv4WithPortMatch[1])) {
        return ipv4WithPortMatch[1];
    }

    return null;
}

function parseForwardedFor(headerValue?: string | null): string[] {
    if (!headerValue) return [];

    return headerValue
        .split(',')
        .map(part => normalizeIpToken(part))
        .filter((value): value is string => Boolean(value));
}

export function getTrustedClientIp(request: NextRequest): string | null {
    const directHeaders = [
        request.headers.get('cf-connecting-ip'),
        request.headers.get('true-client-ip'),
        request.headers.get('x-real-ip'),
    ];

    for (const headerValue of directHeaders) {
        const ip = normalizeIpToken(headerValue);
        if (ip) return ip;
    }

    const forwardedIps = parseForwardedFor(request.headers.get('x-forwarded-for'));
    if (forwardedIps.length > 0) {
        // Reverse proxies append their observed client IP to the chain.
        return forwardedIps[forwardedIps.length - 1];
    }

    return null;
}
