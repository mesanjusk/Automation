import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { dbConnect } from "./db";
import { User } from "@bos/database";
import { verifyPassword } from "@bos/security";

// Kept modular (credentials provider talking to our own User model) so this
// can later be swapped for a provider that federates to the CRM's own auth
// system without touching any page or API route that calls getServerSession.
export const authOptions: AuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        await dbConnect();
        const user = await User.findOne({ email: credentials.email.toLowerCase() }).select("+passwordHash");
        if (!user) return null;
        const valid = await verifyPassword(credentials.password, user.passwordHash);
        if (!valid) return null;
        return { id: String(user._id), name: user.name, email: user.email, role: user.role } as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as unknown as { role: string }).role;
        token.id = (user as unknown as { id: string }).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as unknown as { id?: string; role?: string }).id = token.id as string;
        (session.user as unknown as { id?: string; role?: string }).role = token.role as string;
      }
      return session;
    },
  },
};
