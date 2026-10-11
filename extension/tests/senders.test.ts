import { describe, expect, it } from "vitest";
import { fromExtensionPage } from "../src/engine/senders";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${ID}/`;

describe("fromExtensionPage (M3: stats and Forget all)", () => {
  it("accepts the popup, also when it is open in a tab", () => {
    expect(fromExtensionPage({ id: ID, url: `${ORIGIN}popup.html` }, ID, ORIGIN)).toBe(true);
    expect(fromExtensionPage({ id: ID, url: `${ORIGIN}popup.html`, tab: { id: 3 } } as never, ID, ORIGIN)).toBe(true);
  });

  it("refuses the extension's own content script on a web page, another extension, and a sender without a page", () => {
    expect(fromExtensionPage({ id: ID, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, ID, ORIGIN)).toBe(false);
    expect(fromExtensionPage({ id: "other", url: "chrome-extension://other/popup.html" }, ID, ORIGIN)).toBe(false);
    expect(fromExtensionPage({ id: ID }, ID, ORIGIN)).toBe(false);
  });
});
