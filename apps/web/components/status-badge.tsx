import { Badge } from "@/components/ui/primitives";

const VARIANTS: Record<string, "default" | "success" | "warning" | "destructive" | "outline"> = {
  QUEUED: "outline",
  STARTING: "default",
  RUNNING: "default",
  WAITING_FOR_HUMAN: "warning",
  RETRYING: "warning",
  COMPLETED: "success",
  FAILED: "destructive",
  CANCELLED: "outline",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANTS[status] ?? "default"}>{status.replaceAll("_", " ")}</Badge>;
}
