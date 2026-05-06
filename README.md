# ARCOD

a self-hosted web app that lets you download music from Qobuz in hi-res quality (up to 24-bit/192kHz FLAC). you paste a link or search for an artist/album/track, pick a format, and it handles the rest — downloading, tagging, lyrics, cover art, and packaging into a zip or individual files.

this is the full stack: Next.js frontend, Fastify backend, SQLite database, Cloudflare R2 for temporary file storage, and an optional home worker for offloading heavy downloads from your VPS.

---

> **disclaimer**
> this project is provided for educational and personal use only. i am not responsible for how anyone uses it. downloading copyrighted content without authorization may violate the law in your country. use at your own risk.

---

## what you need

- a VPS or server (debian/ubuntu recommended, 2GB+ RAM)
- Node.js 20+
- a Qobuz account (to get API credentials)
- a Cloudflare account with R2 enabled (for temporary file hosting)
- a Supabase project (for user auth)
- an AWS account (for the Lambda proxy — used to avoid IP bans from Qobuz)

optional:
- a second machine at home as a "worker" to handle downloads instead of your VPS (saves bandwidth)
- a domain name with nginx/caddy in front

---

## project structure

```
app/              next.js frontend (pages, api routes)
components/       react components
lib/              client-side logic (providers, download service)
server/           fastify backend (api, database, download processor)
home-worker/      optional worker that runs on a home machine
```

---

## setup

### 1. clone and install

```bash
git clone <repo-url>
cd ARCOD-Qobuz-DL

# frontend
npm install

# backend
cd server
npm install
cd ..

# worker (optional)
cd home-worker
npm install
cd ..
```

### 2. get your credentials

**Qobuz app ID and secret**

you need the internal app_id and secret that Qobuz uses. there are tools out there to extract them from the Qobuz web player (look for "qobuz app id secret" on github). you also need at least one auth token — log into play.qobuz.com, open devtools, and grab the token from localStorage or network requests.

**Cloudflare R2**

go to the Cloudflare dashboard, enable R2, create a bucket (e.g. `arcod-downloads`), and generate an API token with read/write access. you'll need:
- account ID
- access key ID
- secret access key
- a public URL (set up a custom domain on the bucket, or use the default R2.dev URL)

**Supabase**

create a project on supabase.com. you need:
- project URL
- JWT secret (found in Settings > API > JWT Secret)

this handles user signup/login. if you want to run without auth, you'll need to modify the code.

**AWS Lambda proxy**

the backend routes all Qobuz API requests through an AWS Lambda function. this is because Qobuz blocks datacenter IPs aggressively (akamai). the Lambda acts as a transparent proxy using residential-looking AWS IPs.

to set this up:
1. create a simple Lambda function that forwards HTTP requests (GET with query params) to `https://www.qobuz.com/api.json/0.2`
2. put it behind an API Gateway (HTTP API, not REST)
3. note the invoke URL — that's your `LAMBDA_PROXY_URL`

**important:** AWS Lambda has a default concurrency limit of 10 per region. if multiple users download at the same time, you'll hit throttling. go to Service Quotas > Lambda > Concurrent executions and request an increase (1000 is a good target for us-east-1).

### 3. configure environment

**server/.env**

```env
PORT=3000

# cloudflare r2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET=arcod-downloads
R2_PUBLIC_URL=https://dl.yourdomain.com

# supabase
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_JWT_SECRET=your_jwt_secret

# qobuz
QOBUZ_APP_ID=your_app_id
QOBUZ_SECRET=your_secret
QOBUZ_AUTH_TOKENS=["token1","token2"]

# lambda proxy
LAMBDA_PROXY_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com

# worker (generate a random 64-char hex string)
WORKER_API_KEY=your_random_api_key

# database
DB_PATH=./data/arcod.db
```

**frontend .env.local**

```env
NEXT_PUBLIC_AWS_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

**home-worker/env.txt** (optional, only if using a separate worker machine)

```env
SERVER_URL=https://api.yourdomain.com
WORKER_API_KEY=same_key_as_server
WORKER_ID=home-worker-1

QOBUZ_APP_ID=your_app_id
QOBUZ_SECRET=your_secret
QOBUZ_AUTH_TOKENS=["token1","token2"]

LAMBDA_PROXY_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com

R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET=arcod-downloads
R2_PUBLIC_URL=https://dl.yourdomain.com

POLL_INTERVAL_MS=3000
CLAIM_COUNT=4
TRACK_CONCURRENCY=4
```

### 4. build and run

**backend**

```bash
cd server
npm run build
node dist/index.js
```

or with pm2:

```bash
pm2 start dist/index.js --name arcod-server
```

**frontend**

```bash
npm run build
# standalone output is in .next/standalone/
node .next/standalone/server.js
```

or with pm2:

```bash
pm2 start .next/standalone/server.js --name arcod-frontend
```

**worker** (optional)

```bash
cd home-worker
npm run build
node dist/index.js
```

the worker will poll the server for pending jobs and process them locally. useful if your VPS has limited bandwidth or CPU but you have a beefy machine at home.

### 5. reverse proxy

put nginx or caddy in front of both services:
- frontend on port 3002 (or whatever you set)
- backend on port 3000

example nginx:

```nginx
server {
    server_name yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}

server {
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

---

## how it works

1. user searches for music or pastes a Qobuz/playlist URL
2. frontend calls the backend, which queries Qobuz through the Lambda proxy
3. a download job is created in the SQLite database
4. either the VPS processor or the home worker picks up the job
5. tracks are downloaded, tagged with metadata + lyrics + cover art
6. the result is uploaded to R2 as a temporary file (auto-deleted after 30 min for guests, 24h for authenticated users)
7. user gets a download link

---

## admin panel

go to `/admin` (you need to be logged in with an admin email — set this in the Supabase dashboard or hardcode it in `server/src/auth/supabase.ts`).

from there you can:
- see active/failed/completed jobs
- cancel jobs in bulk
- block or rate-limit IPs
- toggle maintenance mode
- configure download routing (VPS only / worker only / hybrid)

---

## tips

- if downloads fail with "No download URL", it usually means the Qobuz token expired. grab a fresh one from the web player.
- if you see "Please enable R2 through the Cloudflare Dashboard", double-check your R2 account ID — make sure it matches the account where R2 is actually enabled.
- multiple auth tokens help with rate limiting. the system rotates between them automatically.
- the worker's `CLAIM_COUNT` controls how many parallel downloads it handles. set it based on your machine's RAM and bandwidth (4 is safe, 20 is fine with 64GB RAM).
- you can run multiple workers on different machines with different WORKER_IDs.

---

## license

MIT
