/**
 * API Route: Generate Signed Download URL
 * Proxies to AWS Lambda V2 API — POST /v2/downloads/{jobId}/url
 */
import { NextRequest, NextResponse } from 'next/server';

const AWS_API_URL = process.env.NEXT_PUBLIC_AWS_API_URL || process.env.AWS_API_URL || '';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    try {
        const { jobId } = await params;

        // Forward auth header
        const authHeader = request.headers.get('Authorization') || '';
        const downloadToken = request.headers.get('X-Download-Token') || request.headers.get('x-download-token') || '';

        // Forward to AWS V2 API
        const response = await fetch(`${AWS_API_URL}/v2/downloads/${jobId}/url`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
                ...(downloadToken ? { 'X-Download-Token': downloadToken } : {})
            },
            body: '{}',
        });

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                data,
                { status: response.status }
            );
        }

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Generate signed URL proxy error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
