FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS base-runner
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 8080
CMD ["node", "server.js"]

# docker build --target audio-worker .
# Keep the ordinary web image light; Python and model weights live only here.
FROM base-runner AS audio-worker
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libsndfile1 && rm -rf /var/lib/apt/lists/*
COPY services/separator/requirements.txt /tmp/separator-requirements.txt
RUN python3 -m venv /opt/separator && /opt/separator/bin/pip install --no-cache-dir torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu && /opt/separator/bin/pip install --no-cache-dir -r /tmp/separator-requirements.txt
ENV PYTHON_PATH=/opt/separator/bin/python SEPARATION_ENGINE=demucs DEMUCS_MODEL=htdemucs_6s DEMUCS_DEVICE=cpu TORCH_HOME=/opt/demucs-models DEMUCS_THREADS=2
RUN /opt/separator/bin/python -c "from demucs.pretrained import get_model; get_model('htdemucs'); get_model('htdemucs_6s')" && chmod -R a+rX /opt/demucs-models
USER node

FROM base-runner AS runner
