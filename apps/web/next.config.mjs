/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // These workspace packages ship untranspiled TypeScript (with .js-suffixed
  // relative imports, per Node ESM convention) — transpilePackages makes
  // Next's webpack build process them instead of treating them as opaque
  // external modules, which is what resolves those .js imports to .ts files.
  transpilePackages: ["@bos/shared", "@bos/database", "@bos/security", "@bos/queue", "@bos/storage", "@bos/ai"],
  experimental: {
    // Keep Node-native/server-only packages out of the webpack graph entirely
    // and let Node require() them at run time.
    //
    // bullmq + ioredis are here on purpose: the dashboard only reaches the
    // queue on the Render path (see lib/dispatch.ts), but webpack still parsed
    // bullmq while bundling that route and warned about its OPTIONAL
    // @valkey/valkey-glide backend, which this project does not use. Marking
    // them external removes the warning without installing a dependency
    // nothing here needs.
    serverComponentsExternalPackages: ["mongoose", "bullmq", "ioredis"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // The public v1 API is meant to be called server-to-server (e.g. from
        // a CRM backend) but also allows browser-based integrations.
        source: "/api/v1/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, X-API-Key" },
        ],
      },
    ];
  },
};

export default nextConfig;
