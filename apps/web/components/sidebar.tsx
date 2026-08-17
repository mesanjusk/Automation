"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Workflow,
  ListChecks,
  ClipboardList,
  UserSquare2,
  Radio,
  CalendarClock,
  KeyRound,
  ScrollText,
  ImageIcon,
  FolderOpen,
  Webhook,
  Code2,
  Settings,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/automations", label: "Automations", icon: ListChecks },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/profiles", label: "Browser Profiles", icon: UserSquare2 },
  { href: "/sessions", label: "Live Sessions", icon: Radio },
  { href: "/schedules", label: "Schedules", icon: CalendarClock },
  { href: "/credentials", label: "Credentials", icon: KeyRound },
  { href: "/logs", label: "Execution Logs", icon: ScrollText },
  { href: "/screenshots", label: "Screenshots", icon: ImageIcon },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/api", label: "API", icon: Code2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Bot className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold">Automation OS</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
