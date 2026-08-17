export { default } from "next-auth/middleware";

// Protects every dashboard page while leaving /login, the public v1 API
// (which uses its own API-key auth), NextAuth's own routes, and static
// assets untouched.
export const config = {
  matcher: [
    "/((?!api|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
