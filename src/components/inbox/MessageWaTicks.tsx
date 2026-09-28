import { Check, CheckCheck } from "lucide-react";
import type { WaMessageStatus } from "@/lib/message-wa-status";
import { cn } from "@/lib/utils";

export function MessageWaTicks({
  status,
  className,
}: {
  status?: WaMessageStatus | null;
  className?: string;
}) {
  const s = status ?? "sent";
  if (s === "failed") {
    return <span className={cn("text-[10px] text-destructive/90", className)}>!</span>;
  }
  if (s === "read") {
    return <CheckCheck className={cn("h-3.5 w-3.5 text-sky-300", className)} aria-label="Lida" />;
  }
  if (s === "delivered") {
    return (
      <CheckCheck className={cn("h-3.5 w-3.5 opacity-70", className)} aria-label="Entregue" />
    );
  }
  return <Check className={cn("h-3.5 w-3.5 opacity-70", className)} aria-label="Enviada" />;
}
