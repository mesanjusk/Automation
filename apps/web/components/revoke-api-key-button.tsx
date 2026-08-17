"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { revokeApiKey } from "@/lib/actions/apiKeys";

export function RevokeApiKeyButton({ apiKeyId }: { apiKeyId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(async () => { await revokeApiKey(apiKeyId); router.refresh(); })}
    >
      Revoke
    </Button>
  );
}
