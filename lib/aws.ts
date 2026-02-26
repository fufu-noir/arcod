/**
 * AWS Configuration and Client Utilities
 * This file provides the AWS API URLs and helpers for the frontend
 */

// AWS API Gateway URL - set this after deploying with SAM
export const AWS_API_URL = process.env.NEXT_PUBLIC_AWS_API_URL || '';

// CloudFront domain for downloads
export const AWS_CLOUDFRONT_DOMAIN = process.env.NEXT_PUBLIC_AWS_CLOUDFRONT_DOMAIN || '';

// Check if AWS is configured
export function isAWSConfigured(): boolean {
    return !!AWS_API_URL;
}

// AWS API Endpoints
export const AWS_ENDPOINTS = {
    createJob: `${AWS_API_URL}/jobs`,
    getJob: (jobId: string) => `${AWS_API_URL}/jobs/${jobId}`,
    listJobs: `${AWS_API_URL}/jobs`,
    cancelJob: (jobId: string) => `${AWS_API_URL}/jobs/${jobId}/cancel`,
    getAlbumInfo: (albumId: string) => `${AWS_API_URL}/albums/${albumId}`,
    cleanup: `${AWS_API_URL}/cleanup`,
    admin: {
        blockedIPs: `${AWS_API_URL}/admin/blocked-ips`,
        rateLimits: `${AWS_API_URL}/admin/rate-limits`
    }
};

// Legacy Firebase URLs (for fallback)
export const FIREBASE_ENDPOINTS = {
    createJob: process.env.NEXT_PUBLIC_CREATE_JOB_URL || 'https://createjob-gmwkluqykq-ew.a.run.app',
    getJob: process.env.NEXT_PUBLIC_GET_JOB_URL || 'https://getjob-gmwkluqykq-ew.a.run.app'
};

/**
 * Get the appropriate endpoint based on configuration
 * Prefers AWS if configured, falls back to Firebase
 */
export function getEndpoint(type: 'createJob' | 'getJob'): string {
    if (isAWSConfigured()) {
        return type === 'createJob' ? AWS_ENDPOINTS.createJob : AWS_ENDPOINTS.listJobs;
    }
    return FIREBASE_ENDPOINTS[type];
}

/**
 * Get the job URL for polling
 */
export function getJobUrl(jobId: string): string {
    if (isAWSConfigured()) {
        return AWS_ENDPOINTS.getJob(jobId);
    }
    return `${FIREBASE_ENDPOINTS.getJob}/${jobId}`;
}
