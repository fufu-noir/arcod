import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Arcod',
        short_name: 'Arcod',
        description: 'A professional music downloading experience',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#3b82f6',
        orientation: 'portrait',
        icons: [
            {
                src: '/logo/arcod_logo.svg',
                sizes: '512x512',
                type: 'image/svg+xml'
            }
        ]
    };
}
