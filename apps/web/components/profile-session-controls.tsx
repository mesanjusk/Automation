"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { exportSession, importSession, deleteProfile } from "@/lib/actions/profiles";

export function ProfileSessionControls({ profileId, hasSession }: { profileId: string; hasSession: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleExport() {
    setError(null);
    startTransition(async () => {
      try {
        const json = await exportSession(profileId);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `profile-${profileId}-session.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  async function handleImportFile(file: File) {
    setError(null);
    const text = await file.text();
    startTransition(async () => {
      try {
        await importSession(profileId, text);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" disabled={!hasSession || pending} onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
        />
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => { await deleteProfile(profileId); router.refresh(); })}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
