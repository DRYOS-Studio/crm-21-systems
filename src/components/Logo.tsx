import { Bot } from "lucide-react";

export const BRAND_NAME = "DRYOS - ProspectIA";

interface LogoProps {
  width?: number;
  height?: number;
  className?: string;
  showTitle?: boolean;
  iconSize?: number;
  /** Compact inline layout (icon + wordmark on one line). Use in headers/navbars. */
  horizontal?: boolean;
}

function Wordmark({ stacked = false }: { stacked?: boolean }) {
  if (stacked) {
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
          DRYOS
        </span>
        <span className="font-display font-bold tracking-tight leading-none text-primary text-5xl">
          ProspectIA
        </span>
      </div>
    );
  }

  return (
    <span className="font-display tracking-tight leading-none text-lg sm:text-xl">
      <span className="font-medium text-muted-foreground">DRYOS</span>
      <span className="mx-1.5 font-medium text-muted-foreground">-</span>
      <span className="font-bold text-primary">ProspectIA</span>
    </span>
  );
}

export const Logo = ({
  iconSize = 96,
  className = "",
  showTitle = true,
  width,
  height,
  horizontal = false,
}: LogoProps) => {
  const size = width ?? height ?? iconSize;

  if (horizontal) {
    return (
      <div className={`flex items-center gap-2 ${className}`} aria-label={BRAND_NAME}>
        <Bot size={size} className="text-primary shrink-0" strokeWidth={1.75} />
        {showTitle && <Wordmark />}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-4 ${className}`} aria-label={BRAND_NAME}>
      <Bot size={size} className="text-primary" strokeWidth={1.75} />
      {showTitle && <Wordmark stacked />}
    </div>
  );
};
