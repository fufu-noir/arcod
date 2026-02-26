import { CognitoJwtVerifier } from "aws-jwt-verify";

// Verify environment variables are present to avoid runtime crashes
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;

if (!USER_POOL_ID || !CLIENT_ID) {
    console.warn("Cognito env vars missing. Authentication will fail.");
}

const verifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID || "",
    tokenUse: "id",
    clientId: CLIENT_ID || "",
});

export interface AuthUser {
    uid: string;
    email: string;
    firebase_id?: string;
}

export async function authenticateRequest(authHeader: string): Promise<AuthUser | null> {
    if (!authHeader) return null;

    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

    try {
        const payload = await verifier.verify(token);
        return {
            uid: payload.sub,
            email: payload.email as string,
            firebase_id: payload["custom:firebase_id"] as string
        };
    } catch (err) {
        console.error("Token verification failed:", err);
        return null; // Invalid token
    }
}
