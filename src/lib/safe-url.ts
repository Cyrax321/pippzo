// Returns the URL only if it is a plain http(s) link, else undefined. Use for
// any href built from third-party / provider-sourced data (inbox permalinks,
// competitor URLs) so a javascript:/data: URL can never become a clickable
// link that executes on click.
export function safeHttpUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
