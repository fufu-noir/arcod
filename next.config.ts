import type { NextConfig } from 'next';

const cloudfrontDomain = process.env.NEXT_PUBLIC_AWS_CLOUDFRONT_DOMAIN || '';

const nextConfig: NextConfig = {
    output: 'standalone',
    poweredByHeader: false,
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    },
    images: {
        unoptimized: true,
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'static.qobuz.com',
                port: '',
                pathname: '**',
                search: ''
            },
            {
                protocol: 'https',
                hostname: 'cdn-images.dzcdn.net',
                port: '',
                pathname: '**',
                search: ''
            },
            {
                protocol: 'https',
                hostname: 'e-cdns-images.dzcdn.net',
                port: '',
                pathname: '**',
                search: ''
            },
            // CloudFront domain for download covers (set via env)
            ...(cloudfrontDomain ? [{
                protocol: 'https' as const,
                hostname: cloudfrontDomain,
                port: '',
                pathname: '**',
                search: ''
            }] : [])
        ]
    }
};

export default nextConfig;
