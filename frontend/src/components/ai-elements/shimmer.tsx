"use client";

import { motion, type MotionProps } from "framer-motion";
import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";

// Static map keeps component identity stable across renders.
const MOTION_TAGS = {
  div: motion.div,
  p: motion.p,
  span: motion.span,
} as const;

export type ShimmerTag = keyof typeof MOTION_TAGS;

export interface TextShimmerProps {
  children: string;
  as?: ShimmerTag;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const MotionComponent = MOTION_TAGS[Component];

  const dynamicSpread = useMemo(() => (children?.length ?? 0) * spread, [children, spread]);

  return (
    <MotionComponent
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,transparent_calc(50%-var(--spread)),var(--color-zinc-900),transparent_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        "dark:[--bg:linear-gradient(90deg,transparent_calc(50%-var(--spread)),var(--color-zinc-100),transparent_calc(50%+var(--spread)))]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-zinc-500), var(--color-zinc-500))",
        } as React.CSSProperties
      }
      transition={{ duration, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);
