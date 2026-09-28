import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { LeadTag } from "@/lib/lead-tags";
import {
  TAG_FILTER_NONE,
  tagFilterSummary,
  toggleTagFilter,
} from "@/lib/tag-filter";
import { cn } from "@/lib/utils";

export function TagFiltersControl({
  catalog,
  value,
  onChange,
  className,
}: {
  catalog: LeadTag[];
  value: string[];
  onChange: (tagFilters: string[]) => void;
  className?: string;
}) {
  const active = value.length > 0;
  const summary = tagFilterSummary(value, catalog);

  const set = (tagId: string, checked: boolean) => {
    if (tagId === TAG_FILTER_NONE) {
      onChange(checked ? [TAG_FILTER_NONE] : []);
      return;
    }
    onChange(toggleTagFilter(value, tagId));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-8 justify-between font-normal text-xs",
            className ?? "w-[160px]",
            active && "border-primary/50",
          )}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1 max-h-64 overflow-y-auto">
          <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer">
            <Checkbox
              checked={!value.length}
              onCheckedChange={(c) => c === true && onChange([])}
            />
            Todas as tags
          </label>
          <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer">
            <Checkbox
              checked={value.includes(TAG_FILTER_NONE)}
              onCheckedChange={(c) => set(TAG_FILTER_NONE, c === true)}
            />
            Sem tags
          </label>
          {catalog.length > 0 && <div className="my-1 border-t border-border" />}
          {catalog.map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer"
            >
              <Checkbox
                checked={value.includes(t.id)}
                disabled={value.includes(TAG_FILTER_NONE)}
                onCheckedChange={(c) => set(t.id, c === true)}
              />
              <span className="truncate">{t.name}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** @deprecated use TagFiltersControl */
export function TagFilterSelect({
  catalog,
  value,
  onChange,
  className,
}: {
  catalog: LeadTag[];
  value: string[];
  onChange: (tagFilters: string[]) => void;
  className?: string;
}) {
  return <TagFiltersControl catalog={catalog} value={value} onChange={onChange} className={className} />;
}
