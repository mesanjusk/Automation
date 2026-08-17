import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ChangePasswordForm } from "@/components/change-password-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  const systemInfo = [
    { label: "AI provider", value: "Gemini" },
    { label: "AI model", value: process.env.GEMINI_MODEL || "gemini-2.0-flash" },
    { label: "Max AI actions per run", value: process.env.MAX_AI_ACTIONS || "100" },
    { label: "File storage provider", value: process.env.STORAGE_PROVIDER || "local" },
    { label: "API base URL", value: process.env.API_BASE_URL || "http://localhost:3000" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Account and platform configuration.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="text-sm">
            <p className="font-medium">{session?.user?.name}</p>
            <p className="text-muted-foreground">{session?.user?.email}</p>
          </div>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {systemInfo.map((item) => (
              <div key={item.label} className="flex flex-col gap-0.5 rounded-md border border-border p-3">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="font-mono text-xs">{item.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            These are set via environment variables on the web and worker deployments — see .env.example.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
