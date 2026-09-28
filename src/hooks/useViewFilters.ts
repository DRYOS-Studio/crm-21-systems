import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_VIEW_FILTERS,
  loadViewFilters,
  saveViewFilters,
  type ViewFilters,
} from "@/lib/view-filters";

export function useViewFilters(userId: string | undefined) {
  const [filters, setFilters] = useState<ViewFilters>(() =>
    userId ? loadViewFilters(userId) : DEFAULT_VIEW_FILTERS,
  );

  useEffect(() => {
    if (!userId) {
      setFilters(DEFAULT_VIEW_FILTERS);
      return;
    }
    setFilters(loadViewFilters(userId));
  }, [userId]);

  const update = useCallback(
    (patch: Partial<ViewFilters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        if (userId) saveViewFilters(userId, next);
        return next;
      });
    },
    [userId],
  );

  return { filters, update };
}
