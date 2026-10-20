"use client";

import { useEffect, useState } from "react";

/** Responsive chart height: compact ~160 below sm, default above. */
export function useChartHeight(defaultHeight = 240, compactHeight = 160): number {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return compact ? compactHeight : defaultHeight;
}
