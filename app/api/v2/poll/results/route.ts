/**
 * API Route: Poll Results
 * Proxies to AWS Lambda poll results endpoint
 */
import { NextRequest, NextResponse } from 'next/server';

const AWS_API_URL = process.env.NEXT_PUBLIC_AWS_API_URL || process.env.AWS_API_URL || '';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const pollId = searchParams.get('pollId');

        if (!pollId) {
            return NextResponse.json(
                { error: 'pollId is required' },
                { status: 400 }
            );
        }

        // Forward auth header if present (to check user's existing vote)
        const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (authHeader) {
            headers['Authorization'] = authHeader;
        }

        const response = await fetch(`${AWS_API_URL}/v2/poll/results?pollId=${encodeURIComponent(pollId)}`, {
            method: 'GET',
            headers,
        });

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                { error: data.error || 'Failed to get results' },
                { status: response.status }
            );
        }

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Poll results proxy error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
