# The browser worker: long-running Node process + real Chromium. This is
# what you deploy to Render (or any always-on container host) — never to
# Vercel serverless functions.
FROM mcr.microsoft.com/playwright:v1.48.2-jammy AS base
WORKDIR /repo

COPY package.json package-lock.json* ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/test-site/package.json apps/test-site/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/security/package.json packages/security/package.json
COPY packages/browser/package.json packages/browser/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/automation-engine/package.json packages/automation-engine/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN npm install --workspaces --include-workspace-root

COPY . .
RUN npm run build --workspace=apps/worker

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true
EXPOSE 4000
CMD ["node", "apps/worker/dist/index.js"]
