"use client";
import { Amplify } from 'aws-amplify';

const isBrowser = typeof window !== 'undefined';
const origin = isBrowser ? window.location.origin : 'http://localhost:3000';

const authConfig = {
    Cognito: {
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
        userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
        loginWith: {
            oauth: {
                domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN!,
                scopes: ['email', 'openid', 'profile'],
                // Add your own domains here if needed
                redirectSignIn: ['http://localhost:3000', origin],
                redirectSignOut: ['http://localhost:3000', origin],
                responseType: 'code' as const,
            }
        }
    }
};

export function configureAmplify() {
    Amplify.configure({
        Auth: authConfig
    });
}
