import { describe, expect, it } from "vitest";
import { createElement, Fragment } from "react";

import { filterSelectOptions, parseSelectOptions, type ParsedSelectOption } from "../select";

const OPTIONS: ParsedSelectOption[] = [
  { value: "deterministic", label: "deterministic" },
  { value: "laya", label: "laya" },
  { value: "openai_moderation", label: "openal moderation" },
  { value: "jev", label: "jev" },
  { value: "llm", label: "llm" },
];

describe("filterSelectOptions", () => {
  it("returns everything on empty query", () => {
    expect(filterSelectOptions(OPTIONS, "")).toHaveLength(5);
    expect(filterSelectOptions(OPTIONS, "   ")).toHaveLength(5);
  });

  it("matches labels case-insensitively", () => {
    expect(filterSelectOptions(OPTIONS, "LAY").map((o) => o.value)).toEqual(["laya"]);
  });

  it("matches values too", () => {
    expect(filterSelectOptions(OPTIONS, "openai_mod").map((o) => o.value)).toEqual([
      "openai_moderation",
    ]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterSelectOptions(OPTIONS, "zzz")).toEqual([]);
  });
});

describe("parseSelectOptions", () => {
  it("flattens option children including fragments", () => {
    const children = [
      createElement("option", { key: "a", value: "laya" }, "laya"),
      createElement(
        Fragment,
        { key: "f" },
        createElement("option", { value: "llm" }, "llm"),
      ),
    ];
    expect(parseSelectOptions(children)).toEqual([
      { value: "laya", label: "laya", disabled: undefined, testId: undefined },
      { value: "llm", label: "llm", disabled: undefined, testId: undefined },
    ]);
    expect(parseSelectOptions(null)).toEqual([]);
  });
});
