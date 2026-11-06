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
  icons: {
    icon: [
      {
        url: "/favicon-32x32.png?v=2",
        sizes: "32x32",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-dark-32x32.png?v=2",
        sizes: "32x32",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/favicon-16x16.png?v=2",
        sizes: "16x16",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-dark-16x16.png?v=2",
        sizes: "16x16",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
      { url: "/icon.svg?v=2", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: [
      {
        url: "/apple-touch-icon.png?v=2",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#f7f7ee",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable} ${mono.variable} bg-black`}>
      <body className="antialiased">
        {/* Page frame: black bars top + bottom that scroll with the page
            (nothing is fixed); body black shows through the margin as
            the surround, full-bleed on the sides. overflow: clip (NOT
            hidden) clips the curvy corners without turning the wrapper
            into a scroll container, so sticky/fixed descendants keep
            working. Plain in print. */}
        <div className="mx-0 my-6 overflow-clip rounded-[28px] bg-cream print:m-0 print:rounded-none print:overflow-visible">
          {children}
        </div>
      </body>
    </html>
  );
}
