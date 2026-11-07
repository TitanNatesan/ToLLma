import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Request-version pager position contract for MessageView.tsx. Mirrors
// messageViewPager.test.ts: rendering MessageView needs heavy store/router
// mocking, so assert the structural contract statically — the pager keeps
// its testids (e2e refs) and sits BELOW the user content (after
// <CollapsibleUserContent/>), aligned to the end of the user bubble.
const messageView = readFileSync(join(__dirname, "..", "MessageView.tsx"), "utf8");

describe("request version pager position contract", () => {
  it("keeps the request pager testids the e2e specs rely on", () => {
    expect(messageView).toContain("request-version-nav-");
    expect(messageView).toContain('data-testid="request-prev"');
    expect(messageView).toContain('data-testid="request-next"');
    expect(messageView).toContain('data-testid="request-version-page"');
  });

  it("renders the request pager below the user content, after <CollapsibleUserContent/>", () => {
    const contentIdx = messageView.indexOf("<CollapsibleUserContent");
    const pagerIdx = messageView.indexOf("request-version-nav-");
    expect(contentIdx).toBeGreaterThan(-1);
    expect(pagerIdx).toBeGreaterThan(-1);
    expect(pagerIdx).toBeGreaterThan(contentIdx);
  });

  it("labels the request pager distinctly from the response pager", () => {
    expect(messageView).toContain("Previous request version");
    expect(messageView).toContain("Next request version");
    expect(messageView).toContain("generation-nav-");
  });
});
