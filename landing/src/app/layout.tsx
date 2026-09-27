import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ToLLma — One Gateway For All Your AI Models & Agents",
  description:
    "The Open Source AI Gateway for Models and Agents. One OpenAI-compatible endpoint for every model, agent, and knowledge base. Apache 2.0 licensed.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
