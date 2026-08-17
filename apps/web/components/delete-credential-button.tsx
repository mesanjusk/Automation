"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { deleteCredential } from "@/lib/actions/credentials";

export function DeleteCredentialButton({ credentialId }: { credentialId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      onClick={() => startTransition(async () => { await deleteCredential(credentialId); router.refresh(); })}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
