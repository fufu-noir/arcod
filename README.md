# Qobuz-DL

![Qobuz-DL](https://github.com/user-attachments/assets/45896382-1764-4339-824a-b31f32991480)

---

> **Disclaimer**
> This repository does not contain any copyrighted material or code to illegally download music. Downloads are provided by the Qobuz API and should only be initiated by the API token owner. The author is not responsible for the usage of this repository nor endorses it, nor is the author responsible for any copies, forks, re-uploads made by other users, or anything else related to Qobuz-DL. Any live demo found online of this project is not associated with the authors of this repo.

A web-based tool for downloading music from Qobuz in various codecs and formats.

## Features

- Download any song or album from Qobuz
- Re-encode to FLAC, ALAC, MP3, AAC, OPUS, WAV via FFmpeg
- Automatic metadata and cover art embedding
- Synced lyrics embedding (via external lyrics service)
- Cloud backend with per-user library and 30 GB storage
- Guest mode with rate limiting
- Tidal support (experimental)

## Requirements

- Node.js (LTS recommended)
- npm
- An AWS account (for the backend)

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/QobuzDL/Qobuz-DL.git
cd Qobuz-DL
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

You'll need:
- Qobuz App ID and Secret (see [this tool](https://github.com/QobuzDL/Qobuz-AppID-Secret-Tool))
- A valid Qobuz auth token (from `localuser.token` in localStorage on [play.qobuz.com](https://play.qobuz.com/))
- AWS backend URL (after deploying, see below)
- Cognito User Pool config

### 3. Run locally

```bash
npm run dev
```

## AWS Backend

The download processing runs on AWS Lambda. See `aws/README.md` for setup.

Quick deploy:

```bash
cd aws
npm install
npm run build
sam build && sam deploy --guided
```

## Docker

```bash
docker build -t qobuz-dl .
docker-compose up -d
```

## Project Structure

```
app/            - Next.js pages and API routes
components/     - React components
lib/            - Core logic (download service, providers, etc.)
aws/            - Lambda functions and SAM template
  functions/    - TypeScript source for all Lambda handlers
```

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b my-feature`
3. Make your changes and push
4. Open a pull request

## License

[MIT](LICENSE)
