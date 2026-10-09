// Search links: ?q=... in the address opens the page on that search, so a found moment can be shared.

export const MAX_QUERY = 200; // the search box's maxlength

export function queryFromUrl(href: string): string | null {
  const q = new URL(href).searchParams.get("q")?.trim().slice(0, MAX_QUERY);
  return q ? q : null;
}

export function urlWithQuery(href: string, query: string | null): string {
  const url = new URL(href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  return url.toString();
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

// A link that names an example answers at once from the stored vector, without the model download.
export function matchExample<T extends { query: string }>(examples: T[], query: string): T | undefined {
  const wanted = squash(query);
  return examples.find((ex) => squash(ex.query) === wanted);
}
