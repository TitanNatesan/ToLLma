import { describe, expect, it } from "vitest";
import { diffLines, splitHighlight } from "../diff";

describe("diffLines", () => {
  it("marks unchanged, added and removed lines", () => {
    const diff = diffLines("alpha\nbeta", "alpha\ngamma");
    expect(diff.map((line) => line.type)).toEqual(["same", "remove", "add"]);
    expect(diff[1].text).toBe("beta");
    expect(diff[2].text).toBe("gamma");
  });

  it("treats identical content as all-same", () => {
    const diff = diffLines("one\ntwo", "one\ntwo");
    expect(diff.every((line) => line.type === "same")).toBe(true);
  });

  it("handles pure additions", () => {
    const diff = diffLines("", "new line");
    expect(diff.some((line) => line.type === "add")).toBe(true);
  });
});

describe("splitHighlight", () => {
  it("splits ts_headline markers without innerHTML", () => {
    const parts = splitHighlight("before <mark>match</mark> after");
    expect(parts).toEqual([
      { text: "before ", highlight: false },
      { text: "match", highlight: true },
      { text: " after", highlight: false },
    ]);
  });

  it("returns plain text when there are no markers", () => {
    expect(splitHighlight("plain")).toEqual([{ text: "plain", highlight: false }]);
  });
});
