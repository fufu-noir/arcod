import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler = async (event: any) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const { email } = JSON.parse(event.body || '{}');

        if (!email) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Email is required' })
            };
        }

        const getUserCommand = new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: email
        });

        const userResponse = await client.send(getUserCommand);

        const firebaseIdAttr = userResponse.UserAttributes?.find(
            attr => attr.Name === 'custom:firebase_id'
        );

        const isMigratedUser = !!firebaseIdAttr?.Value;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                userExists: true,
                isMigratedUser,
                email
            })
        };

    } catch (error: any) {
        if (error.name === 'UserNotFoundException') {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    userExists: false,
                    isMigratedUser: false
                })
            };
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
