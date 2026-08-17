/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Playwright/BullMQ workers are never imported by the web app, but keep the
  // trace bundling from choking if any transitive dep pulls in Node natives.
  serverExternalPackages: ["mongoose"],
};

export default nextConfig;
