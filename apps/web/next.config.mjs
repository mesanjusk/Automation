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
    // Playwright/BullMQ workers are never imported by the web app, but keep
    // the trace bundling from choking if any transitive dep pulls in Node
    // natives (mongoose's optional drivers, etc).
    serverComponentsExternalPackages: ["mongoose"],
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
