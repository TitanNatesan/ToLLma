"use client";

import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Dependency-free carousel primitive matching the AI Elements `Carousel`
 * surface used by InlineCitation (`setApi`, `scrollPrev/Next`,
 * `selectedScrollSnap`, `scrollSnapList`, `on/off`).
 */
export interface CarouselApi {
  scrollPrev: () => void;
  scrollNext: () => void;
  selectedScrollSnap: () => number;
  scrollSnapList: () => number[];
  on: (event: "select", handler: () => void) => void;
  off: (event: "select", handler: () => void) => void;
}

interface CarouselContextValue {
  index: number;
  count: number;
  setCount: (next: number) => void;
  scrollPrev: () => void;
  scrollNext: () => void;
}

const CarouselContext = createContext<CarouselContextValue | null>(null);

export const useCarousel = (): CarouselContextValue => {
  const context = useContext(CarouselContext);
  if (!context) {
    throw new Error("Carousel components must be used within <Carousel>");
  }
  return context;
};

export interface CarouselProps extends ComponentProps<"div"> {
  setApi?: (api: CarouselApi) => void;
}

export function Carousel({ className, children, setApi, ...props }: CarouselProps) {
  const [index, setIndex] = useState(0);
  const [count, setCountState] = useState(0);
  const listenersRef = useRef(new Set<() => void>());
  const indexRef = useRef(0);
  const countRef = useRef(0);

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) listener();
  }, []);

  const scrollTo = useCallback(
    (next: number) => {
      const total = countRef.current;
      if (total <= 0) return;
      const bounded = ((next % total) + total) % total;
      indexRef.current = bounded;
      setIndex(bounded);
      notify();
    },
    [notify],
  );

  const scrollPrev = useCallback(() => scrollTo(indexRef.current - 1), [scrollTo]);
  const scrollNext = useCallback(() => scrollTo(indexRef.current + 1), [scrollTo]);

  const setCount = useCallback((next: number) => {
    countRef.current = next;
    setCountState(next);
  }, []);

  const api = useMemo<CarouselApi>(
    () => ({
      scrollPrev,
      scrollNext,
      selectedScrollSnap: () => indexRef.current,
      scrollSnapList: () => Array.from({ length: countRef.current }, (_, i) => i),
      on: (_event, handler) => {
        listenersRef.current.add(handler);
      },
      off: (_event, handler) => {
        listenersRef.current.delete(handler);
      },
    }),
    [scrollPrev, scrollNext],
  );

  useEffect(() => {
    setApi?.(api);
  }, [api, setApi]);

  const contextValue = useMemo<CarouselContextValue>(
    () => ({ index, count, setCount, scrollPrev, scrollNext }),
    [index, count, setCount, scrollPrev, scrollNext],
  );

  return (
    <CarouselContext.Provider value={contextValue}>
      <div className={cn("relative", className)} {...props}>
        {children}
      </div>
    </CarouselContext.Provider>
  );
}

export function CarouselContent({ className, children, ...props }: ComponentProps<"div">) {
  const { index, setCount } = useCarousel();
  const items = useMemo(() => Children.toArray(children), [children]);

  useEffect(() => {
    setCount(items.length);
  }, [items.length, setCount]);

  return (
    <div className={cn("overflow-hidden", className)} {...props}>
      <div
        className="flex transition-transform duration-200 ease-out"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {items}
      </div>
    </div>
  );
}

export function CarouselItem({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("w-full shrink-0", className)} {...props}>
      {children}
    </div>
  );
}
