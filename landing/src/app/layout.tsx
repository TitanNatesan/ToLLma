import type { Metadata, Viewport } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "optional",
});

// Serif display face for Nominal-style headlines (Georgia fallback covers
// offline/static-export builds where the webfont fetch fails).
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "optional",
});

// Code/mono face for API examples (kept local via CSS stack to avoid an
// extra network font; the var is referenced by --font-mono).
const mono = {
  variable: "--font-mono-code",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://tollma.dev"),
  title: "ToLLma — One Gateway for All Your AI Models & Agents",
  description:
    "The open-source AI gateway for models and agents. One OpenAI-compatible endpoint for every provider, with API keys, usage & cost tracking, guardrails, prompt logging, and org management. Apache 2.0.",
  keywords: [
    "AI gateway",
    "LLM gateway",
    "OpenAI-compatible",
    "Anthropic",
    "Gemini",
    "Bedrock",
    "guardrails",
    "open source",
  ],
  openGraph: {
    type: "website",
    title: "ToLLma — One Gateway for All Your AI Models & Agents",
    description:
      "One OpenAI-compatible endpoint for every provider, with keys, usage & cost tracking, guardrails, and org management. Apache 2.0.",
    siteName: "ToLLma",
  },
  twitter: {
    card: "summary_large_image",
    title: "ToLLma — One Gateway for All Your AI Models & Agents",
    description:
      "The open-source AI gateway for models and agents. Apache 2.0.",
  },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#f6f6ec",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable} ${mono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
