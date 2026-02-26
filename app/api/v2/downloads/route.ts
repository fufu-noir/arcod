/**
 * API Route: Create Download V2
 * Proxies to AWS Lambda V2 API with authentication
 */
import { NextRequest, NextResponse } from 'next/server';

const AWS_API_URL = process.env.NEXT_PUBLIC_AWS_API_URL || process.env.AWS_API_URL || '';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // Get Authorization header from the request
        const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');

        // Get client IP for guest rate limiting
        const forwardedFor = request.headers.get('x-forwarded-for');
        const clientIp = forwardedFor?.split(',')[0]?.trim() || 'unknown';

        // Forward to AWS V2 API with auth header and IP
        const response = await fetch(`${AWS_API_URL}/v2/downloads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': clientIp,
                ...(authHeader ? { 'Authorization': authHeader } : {})
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                { error: data.error || data.message || 'Failed to create download' },
                { status: response.status }
            );
        }

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Create download error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
