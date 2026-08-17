"use client";

import { useTheme } from "next-themes";
import { signOut } from "next-auth/react";
import { Moon, Sun, LogOut } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { MobileNav } from "@/components/mobile-nav";

export function Topbar({ userName }: { userName?: string | null }) {
  const { theme, setTheme } = useTheme();
  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-4">
      <MobileNav />
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <Sun className="h-4 w-4 dark:hidden" />
          <Moon className="hidden h-4 w-4 dark:block" />
        </Button>
        {userName && <span className="text-sm text-muted-foreground">{userName}</span>}
        <Button variant="ghost" size="icon" onClick={() => signOut({ callbackUrl: "/login" })}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
