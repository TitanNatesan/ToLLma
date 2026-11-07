import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Pager-position contract for MessageView.tsx. A live pager test is
// impractical here: seeding a multi-generation conversation needs the full
// chat API + mock-LLM egress (covered live by
// e2e/conversation-intelligence.spec.ts "regeneration preserves every
// response and navigates between them"), and rendering MessageView needs heavy
// store/router mocking. Instead assert the structural contract statically:
// the pager keeps its testids (so the existing e2e refs still resolve) and
// sits BELOW the message content (after <Sources/>), next to the actions.
const messageView = readFileSync(join(__dirname, "..", "MessageView.tsx"), "utf8");

describe("generation pager position contract", () => {
  it("keeps the pager testids the e2e specs rely on", () => {
    expect(messageView).toContain("generation-nav-");
    expect(messageView).toContain('data-testid="generation-prev"');
    expect(messageView).toContain('data-testid="generation-next"');
    expect(messageView).toContain('data-testid="generation-page"');
  });

  it("renders the pager below the content, after <Sources/>", () => {
    const sourcesIdx = messageView.indexOf("<Sources");
    const pagerIdx = messageView.indexOf("generation-nav-");
    expect(sourcesIdx).toBeGreaterThan(-1);
    expect(pagerIdx).toBeGreaterThan(-1);
    expect(pagerIdx).toBeGreaterThan(sourcesIdx);
  });
});
