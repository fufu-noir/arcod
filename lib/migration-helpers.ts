import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

export type UserCheckResult = {
    userExists: boolean;
    isMigratedUser: boolean;
};

export async function checkUserStatus(email: string): Promise<UserCheckResult> {
    try {
        const response = await axios.post(`${API_URL}/auth/check-migrated`, { email });
        return {
            userExists: response.data.userExists || false,
            isMigratedUser: response.data.isMigratedUser || false
        };
    } catch {
        return { userExists: false, isMigratedUser: false };
    }
}

export async function removeFirebaseId(email: string): Promise<void> {
    await axios.post(`${API_URL}/auth/remove-firebase-id`, { email });
}
