import { Card } from "@/components/ui";

export default function SettingsPage() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card className="max-w-xl">
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="font-medium">API URL (browser):</dt>
            <dd>{process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">App:</dt>
            <dd>{process.env.NEXT_PUBLIC_APP_NAME ?? "ToLLms"}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-zinc-500">
          Provider credentials are encrypted server-side and never shown in full. Chat preferences
          persist locally in your browser.
        </p>
      </Card>
    </main>
  );
}
