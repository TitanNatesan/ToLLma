import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Share-creation warning + public read-only contracts. Rendering either
// surface needs store/router mocking, so assert the structural contract
// statically — the same pattern as messageViewPager.test.ts.
const shareDialog = readFileSync(
  join(__dirname, "..", "..", "..", "..", "components", "ui", "ShareDialog.tsx"),
  "utf8",
);
const publicDir = join(__dirname, "..");
const publicPage = readFileSync(join(publicDir, "page.tsx"), "utf8");
const publicView = readFileSync(join(publicDir, "components", "PublicConversationView.tsx"), "utf8");

const WARNING =
  "This link will expose your entire conversation, including all branches, edited requests, regenerated responses, and previous versions. Anyone with this link may view this history. Make sure you have not shared sensitive information.";

describe("share-creation warning", () => {
  it("shows the exact exposure warning before minting", () => {
    expect(shareDialog).toContain(WARNING);
  });

  it("gates minting behind confirm; cancel aborts without mutating", () => {
    expect(shareDialog).toContain('data-testid="share-confirm"');
    expect(shareDialog).toContain('data-testid="share-confirm-mint"');
    expect(shareDialog).toContain('data-testid="share-confirm-cancel"');
    // One mint call site, inside the confirm step — the create button only
    // opens the confirmation.
    expect(shareDialog.match(/\bshare\.mutate\(/g)).toHaveLength(1);
    const createIdx = shareDialog.indexOf('data-testid="share-create"');
    const mintIdx = shareDialog.search(/\bshare\.mutate\(/);
    const confirmIdx = shareDialog.indexOf('data-testid="share-confirm"');
    expect(createIdx).toBeGreaterThan(-1);
    expect(mintIdx).toBeGreaterThan(confirmIdx);
  });
});

describe("public page read-only hardening", () => {
  it("never reaches mutation or generation hooks from the public route", () => {
    for (const source of [publicPage, publicView]) {
      expect(source).not.toContain("useIntelligenceMutations");
      expect(source).not.toContain("selectConversationBranch");
      expect(source).not.toContain("regenerateMessage");
      expect(source).not.toContain("editMessage");
      expect(source).not.toContain("createBranch");
      expect(source).not.toContain("streamChat");
      expect(source).not.toContain("onRegenerate");
      expect(source).not.toContain("MessageHistoryDialog");
      expect(source).not.toContain("Textarea");
    }
    expect(publicView).not.toContain("Retry");
    expect(publicView).not.toContain("composer");
  });

  it("reuses the hook-free graph, never the private endpoint-bound wrapper", () => {
    expect(publicView).toContain("ConversationFlowGraph");
    expect(publicView).not.toMatch(/<ConversationFlow[ />]/);
    expect(publicPage).toContain("PublicConversationView");
    expect(publicPage).not.toContain("useIntelligenceMutations");
  });

  it("derives the visible path locally with the owner's leaf as default", () => {
    expect(publicView).toContain("useState");
    expect(publicView).toContain("pathToLeaf");
    expect(publicView).toContain("active_leaf_id");
    expect(publicView).toContain("setSelectedLeafId");
  });

  it("keeps failed/cancelled nodes visible with safe text and no retry", () => {
    expect(publicView).toContain("public-failed-");
    expect(publicView).toContain("public-stopped-");
    expect(publicView).toContain("Generation failed");
  });

  it("binds request/response version pagers to local selection state", () => {
    expect(publicView).toContain("public-request-prev");
    expect(publicView).toContain("public-request-next");
    expect(publicView).toContain("public-generation-prev");
    expect(publicView).toContain("public-generation-next");
    expect(publicView).toContain("siblingIdsFor");
  });
});
