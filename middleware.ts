import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that need COOP/COEP headers for FFmpeg/SharedArrayBuffer
const PROTECTED_ROUTES = [
    '/history',
    // Add more routes here if they need FFmpeg functionality
];

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Check if this route needs security headers for FFmpeg
    const needsSecurityHeaders = PROTECTED_ROUTES.some(route =>
        pathname.startsWith(route)
    );

    const response = NextResponse.next();
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (needsSecurityHeaders) {
        // Add strict headers for FFmpeg/SharedArrayBuffer support
        response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    }

    return response;
}

// Configure which paths the middleware runs on
export const config = {
    matcher: [
        // Match all paths except static files and API routes
        '/((?!_next/static|_next/image|favicon.ico|api).*)',
    ],
};
