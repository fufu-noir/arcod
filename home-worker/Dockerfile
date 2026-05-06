FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    flac \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY dist/ ./dist/

RUN mkdir -p /tmp/arcod-processing

CMD ["node", "dist/index.js"]
