/**
 * API Route: Guest Rate Limit
 * Proxies to AWS Lambda V2 API to get guest download rate limit status
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/server/client-ip';

const AWS_API_URL = process.env.NEXT_PUBLIC_AWS_API_URL || process.env.AWS_API_URL || '';

export async function GET(request: NextRequest) {
    try {
        const clientIp = getTrustedClientIp(request);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (clientIp) {
            headers['X-Forwarded-For'] = clientIp;
            headers['X-Real-IP'] = clientIp;
        }

        const response = await fetch(`${AWS_API_URL}/v2/guest/rate-limit`, {
            method: 'GET',
            headers
        });

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                { error: data.error || 'Failed to get rate limit' },
                { status: response.status }
            );
        }

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Get guest rate limit error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
