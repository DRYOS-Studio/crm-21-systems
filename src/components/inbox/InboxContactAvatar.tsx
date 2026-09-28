import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { inboxInitials } from "@/lib/inbox";
import { usableAvatarUrl } from "@/lib/contact-avatar";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  avatarUrl?: string | null;
  waiting?: boolean;
  size?: "sm" | "md";
  className?: string;
};

export function InboxContactAvatar({ title, avatarUrl, waiting, size = "sm", className }: Props) {
  const src = usableAvatarUrl(avatarUrl);
  const dim = size === "md" ? "h-10 w-10" : "h-9 w-9";
  const text = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <Avatar
      className={cn(
        dim,
        "mt-0.5 shrink-0",
        className,
      )}
    >
      {src ? <AvatarImage src={src} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback
        className={cn(
          text,
          "font-semibold",
          waiting ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {inboxInitials(title)}
      </AvatarFallback>
    </Avatar>
  );
}
