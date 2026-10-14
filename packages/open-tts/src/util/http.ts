export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let corsFreeFetch: FetchLike | undefined;

/**
 * Registers a fetch implementation that is not subject to browser CORS rules,
 * e.g. Obsidian's requestUrl. Used for self-hosted servers that don't send CORS headers.
 */
export function setCorsFreeFetch(impl: FetchLike | undefined): void {
  corsFreeFetch = impl;
}

/** Fetch that bypasses CORS when the host app provides a way to, else plain fetch */
export function fetchWithoutCors(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return (corsFreeFetch ?? fetch)(url, init);
}
