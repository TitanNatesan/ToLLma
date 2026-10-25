"use client";

import { useEffect, useState } from "react";
import { Toaster as SileoToaster } from "sileo";

/** ToLLma theme is a `dark` class on <html>, not the OS preference. */
function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/**
 * Theme-specific toast defaults: explicit fill + solid text colors per theme
 * (Sileo's `theme` fill alone leaves warning/info text low-contrast), keyed by
 * theme so a mid-session toggle remounts with the right palette.
 */
export function Toaster() {
  const dark = useDarkMode();
  return (
    <SileoToaster
      key={dark ? "dark" : "light"}
      position="bottom-right"
      theme={dark ? "dark" : "light"}
      options={
        dark
          ? {
              fill: "#18181b",
              styles: {
                title: "text-zinc-50!",
                description: "text-zinc-300!",
              },
            }
          : {
              fill: "#ffffff",
              styles: {
                title: "text-zinc-900!",
                description: "text-zinc-600!",
              },
            }
      }
    />
  );
}
