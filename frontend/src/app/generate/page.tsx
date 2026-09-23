"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Loader2, Sparkles, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useModels } from "@/hooks/useRegistry";
import {
  attachmentContentUrl,
  generateMediaImage,
  generateMediaVideo,
  uploadChatAttachment,
  type MediaGenerateResult,
  type UploadedAttachment,
} from "@/services/api";
import type { AIModel } from "@/types";

const IMAGE_ENDPOINT = "images/generations";
const VIDEO_ENDPOINT = "video/generations";

interface Option {
  key: string;
  kind: "image" | "video";
  model: AIModel;
}

function endpointsOf(model: AIModel): Set<string> {
  return new Set([...(model.supported_endpoints ?? []), model.primary_endpoint ?? ""].filter(Boolean));
}

export default function GeneratePage() {
  const { data: models = [] } = useModels();
  const options = useMemo<Option[]>(
    () =>
      models.flatMap((model) => {
        const endpoints = endpointsOf(model);
        const out: Option[] = [];
        if (endpoints.has(IMAGE_ENDPOINT)) out.push({ key: `${model.id}:image`, kind: "image", model });
        if (endpoints.has(VIDEO_ENDPOINT)) out.push({ key: `${model.id}:video`, kind: "video", model });
        return out;
      }),
    [models],
  );

  const [optionKey, setOptionKey] = useState("");
  const [prompt, setPrompt] = useState("green circle");
  const [quality, setQuality] = useState("low");
  const [seconds, setSeconds] = useState("4");
  const [reference, setReference] = useState<UploadedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MediaGenerateResult | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const selected = options.find((option) => option.key === optionKey) ?? options[0];
  const isVideo = selected?.kind === "video";

  async function handleReference(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setReference(await uploadChatAttachment(file, null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleGenerate() {
    if (!selected || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const base = {
        provider_id: selected.model.provider_id,
        model_id: selected.model.id,
        prompt: prompt.trim(),
      };
      setResult(
        isVideo
          ? await generateMediaVideo({
              ...base,
              size: "1280x720",
              seconds,
              reference_attachment_id: reference?.attachment_id ?? null,
            })
          : await generateMediaImage({ ...base, size: "1024x1024", quality }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-5 overflow-y-auto p-6" data-testid="generate-page">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          <Sparkles className="size-4 text-tollma-500" />
          Generate media
        </h1>
        <p className="text-xs text-zinc-500">
          Use any registered model that supports the images or video endpoint. Results are saved as attachments.
        </p>
      </header>

      {options.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
          No image or video models registered yet. Register a model with the <code>images/generations</code> or{" "}
          <code>video/generations</code> endpoint in Providers.
        </p>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Model
            <select
              className="h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-700"
              data-testid="media-model"
              onChange={(e) => {
                setOptionKey(e.target.value);
                setResult(null);
                setReference(null);
              }}
              value={selected?.key ?? ""}
            >
              {options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.kind === "video" ? "Video" : "Image"} · {option.model.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Prompt
            <textarea
              className="min-h-20 rounded-md border border-zinc-200 bg-transparent p-2 text-sm dark:border-zinc-700"
              data-testid="media-prompt"
              onChange={(e) => setPrompt(e.target.value)}
              value={prompt}
            />
          </label>

          {isVideo ? (
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Seconds
                <select
                  className="h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-700"
                  data-testid="media-seconds"
                  onChange={(e) => setSeconds(e.target.value)}
                  value={seconds}
                >
                  {["4", "8", "12"].map((value) => (
                    <option key={value} value={value}>
                      {value}s
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Reference image (optional, image-to-video)
                <input
                  accept="image/*"
                  className="hidden"
                  data-testid="media-reference"
                  onChange={(e) => void handleReference(e.target.files?.[0] ?? null)}
                  ref={fileRef}
                  type="file"
                />
                <Button
                  className="gap-1.5"
                  onClick={() => fileRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />}
                  {reference ? reference.filename : "Attach image"}
                </Button>
              </div>
            </div>
          ) : (
            <label className="flex w-40 flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Quality
              <select
                className="h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-700"
                data-testid="media-quality"
                onChange={(e) => setQuality(e.target.value)}
                value={quality}
              >
                {["low", "medium", "high"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex items-center gap-3">
            <Button
              className="gap-1.5"
              data-testid="media-generate"
              disabled={busy || uploading || !prompt.trim() || !selected}
              onClick={() => void handleGenerate()}
              type="button"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy ? "Generating…" : "Generate"}
            </Button>
            {busy && (
              <span className="text-xs text-zinc-500" data-testid="media-status">
                {isVideo ? "Video jobs can take a few minutes…" : "Rendering image…"}
              </span>
            )}
            {error && (
              <span className="text-xs text-red-500" data-testid="media-error" role="alert">
                {error}
              </span>
            )}
          </div>
        </div>
      )}

      {result && (
        <section
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          data-testid="media-result"
        >
          {result.attachment.kind === "video" ? (
            <video
              className="max-h-[420px] w-fit rounded-lg bg-black"
              controls
              data-testid="media-result-video"
              src={attachmentContentUrl(result.attachment.id)}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={prompt}
              className="max-h-[420px] w-fit rounded-lg"
              data-testid="media-result-img"
              src={attachmentContentUrl(result.attachment.id)}
            />
          )}
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <a
              className="inline-flex items-center gap-1 text-tollma-600 hover:text-tollma-700 dark:text-tollma-400"
              data-testid="media-download"
              download={result.attachment.filename}
              href={attachmentContentUrl(result.attachment.id)}
            >
              <Download className="size-3.5" />
              {result.attachment.filename}
            </a>
            <span>{Math.round(result.latency_ms)} ms</span>
            <span>{Math.round(result.attachment.file_size / 1024)} KB</span>
          </div>
        </section>
      )}
    </div>
  );
}
