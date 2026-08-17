"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label } from "@/components/ui/primitives";
import { changePassword } from "@/lib/actions/settings";

export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="flex max-w-sm flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await changePassword(formData);
          setMessage({ ok: result.ok, text: result.message });
          if (result.ok) (e.target as HTMLFormElement).reset();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" name="newPassword" type="password" required minLength={8} />
      </div>
      {message && <p className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}>{message.text}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Update password"}
      </Button>
    </form>
  );
}
