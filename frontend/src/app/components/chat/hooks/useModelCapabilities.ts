"use client";

import { useMemo } from "react";
import type { AIModel } from "@/types";
import { getModelCapabilities, type ModelCapabilities } from "../capabilities";

export function useModelCapabilities(
  models: AIModel[],
  modelId: string | null,
): { model: AIModel | undefined; caps: ModelCapabilities } {
  const model = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);
  const caps = useMemo(() => getModelCapabilities(model), [model]);
  return { model, caps };
}
