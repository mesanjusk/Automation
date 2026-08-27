# The browser worker: long-running Node process + real Chromium. This is
# what you deploy to Render (or any always-on container host) — never to
# Vercel serverless functions.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy AS base
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
RUN npm ci --workspaces --include-workspace-root

COPY . .
# Type-check gate only (build script is `tsc --noEmit`) — fail the image
# build on a type error rather than shipping a broken image. The actual
# runtime below runs via tsx, not this step's (nonexistent) output: the
# workspace packages are consumed as raw TypeScript source (see each
# package.json's "main": "./src/index.ts"), and Node's own ESM loader can
# neither execute .ts files nor resolve extensionless relative imports —
# tsx (esbuild) handles both transparently, exactly like `npm run dev:worker`.
RUN npm run build --workspace=apps/worker

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true
EXPOSE 4000
CMD ["npx", "tsx", "apps/worker/src/index.ts"]
