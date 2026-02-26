/**
 * API Route: Guest Rate Limit
 * Proxies to AWS Lambda V2 API to get guest download rate limit status
 */
import { NextRequest, NextResponse } from 'next/server';

const AWS_API_URL = process.env.NEXT_PUBLIC_AWS_API_URL || process.env.AWS_API_URL || '';

export async function GET(request: NextRequest) {
    try {
        // Get client IP from headers
        const forwardedFor = request.headers.get('x-forwarded-for');
        const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';

        // Forward to AWS V2 API with the IP header
        const response = await fetch(`${AWS_API_URL}/v2/guest/rate-limit`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': ip
            }
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
