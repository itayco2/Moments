import { describe, expect, it } from "vitest";
import { matchExample, MAX_QUERY, queryFromUrl, urlWithQuery } from "../src/share";

describe("queryFromUrl", () => {
  it("reads the search from ?q=, trimmed, with + and %20 as spaces", () => {
    expect(queryFromUrl("https://m.app/?q=a+rocket%20lifting+off")).toBe("a rocket lifting off");
    expect(queryFromUrl("https://m.app/?q=%20%20astronauts%20")).toBe("astronauts");
  });

  it("returns null when there is no search or it is blank", () => {
    expect(queryFromUrl("https://m.app/")).toBeNull();
    expect(queryFromUrl("https://m.app/?q=")).toBeNull();
    expect(queryFromUrl("https://m.app/?q=+++")).toBeNull();
  });

  it("cuts a long search to what the search box accepts", () => {
    expect(queryFromUrl(`https://m.app/?q=${"a".repeat(500)}`)).toHaveLength(MAX_QUERY);
  });
});

describe("urlWithQuery", () => {
  it("puts the search in the address and keeps everything else", () => {
    const url = urlWithQuery("https://m.app/?ref=li#tool", "a hurricane seen from space");
    expect(url).toBe("https://m.app/?ref=li&q=a+hurricane+seen+from+space#tool");
    expect(queryFromUrl(url)).toBe("a hurricane seen from space");
  });

  it("replaces an older search instead of adding a second one", () => {
    expect(urlWithQuery("https://m.app/?q=old", "new")).toBe("https://m.app/?q=new");
  });

  it("removes the search when there is none to share", () => {
    expect(urlWithQuery("https://m.app/?q=old&ref=li", null)).toBe("https://m.app/?ref=li");
    expect(urlWithQuery("https://m.app/?q=old", null)).toBe("https://m.app/");
  });
});

describe("matchExample", () => {
  const examples = [{ query: "a rocket lifting off" }, { query: "astronauts on the Moon" }];

  it("finds the example a shared link names, ignoring case and spacing", () => {
    expect(matchExample(examples, "Astronauts  on the moon")).toBe(examples[1]);
  });

  it("returns undefined for words that are not an example", () => {
    expect(matchExample(examples, "a cat on a sofa")).toBeUndefined();
  });
});
