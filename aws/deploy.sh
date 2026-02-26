#!/bin/bash

# Qobuz-DL AWS Backend Deployment

set -e

echo "========================================"
echo "  Qobuz-DL AWS Backend Deployment"
echo "========================================"
echo ""

# Check for AWS CLI
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI not found. Install it first:"
    echo "  https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Check for SAM CLI
if ! command -v sam &> /dev/null; then
    echo "Error: AWS SAM CLI not found. Install it first:"
    echo "  https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    exit 1
fi

# Check AWS credentials
echo "Checking AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "Error: AWS credentials not configured. Run: aws configure"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account: $ACCOUNT_ID"
echo ""

# Navigate to aws directory
cd "$(dirname "$0")"

# Install dependencies and build
echo "Installing and building Lambda functions..."
cd functions
npm install
npm run build
cd ..

# Build the SAM application
echo ""
echo "Building SAM application..."
sam build

# Check if this is first deployment
if [ ! -f "samconfig.toml" ] || ! grep -q "parameter_overrides" samconfig.toml 2>/dev/null; then
    echo ""
    echo "First deployment detected. You'll need to provide:"
    echo "  - Firebase Project ID (for auth token verification)"
    echo "  - Qobuz API credentials"
    echo ""
    
    read -p "Enter Firebase Project ID: " FIREBASE_PROJECT_ID
    read -p "Enter Qobuz App ID: " QOBUZ_APP_ID
    read -s -p "Enter Qobuz Secret: " QOBUZ_SECRET
    echo ""
    read -p "Enter Qobuz Auth Tokens (JSON array): " QOBUZ_AUTH_TOKENS
    
    echo ""
    echo "Deploying with SAM..."
    sam deploy --guided \
        --parameter-overrides \
        FirebaseProjectId="$FIREBASE_PROJECT_ID" \
        QobuzAppId="$QOBUZ_APP_ID" \
        QobuzSecret="$QOBUZ_SECRET" \
        QobuzAuthTokens="$QOBUZ_AUTH_TOKENS"
else
    echo ""
    echo "Deploying with existing configuration..."
    sam deploy "$@"
fi

# Get outputs
echo ""
echo "========================================"
echo "  Deployment Complete"
echo "========================================"
echo ""

# Fetch stack outputs
STACK_NAME=$(grep "stack_name" samconfig.toml 2>/dev/null | cut -d'"' -f2 || echo "qobuz-dl-backend")

API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
    --output text 2>/dev/null || echo "N/A")

CLOUDFRONT_DOMAIN=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDomain`].OutputValue' \
    --output text 2>/dev/null || echo "N/A")

S3_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`S3Bucket`].OutputValue' \
    --output text 2>/dev/null || echo "N/A")

echo "Add these to your .env file:"
echo ""
echo "NEXT_PUBLIC_AWS_API_URL=$API_URL"
echo "NEXT_PUBLIC_AWS_CLOUDFRONT_DOMAIN=$CLOUDFRONT_DOMAIN"
echo ""
echo "S3 Bucket: $S3_BUCKET"
echo ""
echo "Done."
