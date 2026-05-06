/**
 * API Route: Poll Vote
 * Proxies to AWS Lambda poll vote endpoint with authentication
 */
import { NextRequest, NextResponse } from 'next/server';

const AWS_API_URL = process.env.NEXT_PUBLIC_AWS_API_URL || process.env.AWS_API_URL || '';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');

        if (!authHeader) {
            return NextResponse.json(
                { error: 'Authentication required' },
                { status: 401 }
            );
        }

        const response = await fetch(`${AWS_API_URL}/v2/poll/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                { error: data.error || 'Failed to vote' },
                { status: response.status }
            );
        }

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Poll vote proxy error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
