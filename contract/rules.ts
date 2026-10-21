/** `#rgb` or `#rrggbb`. Alpha (`#rrggbbaa`) is unsupported because the native color input cannot edit it. */
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Printable ASCII with no spaces: what a correctly encoded URL looks like. */
const ENCODED_URL_PATTERN = /^[\x21-\x7e]+$/;

export type UrlProtocol = "https:" | "http:";

/**
 * Checks whether a string is a hex color the editor and preview can render.
 *
 * @param value - Raw user input.
 * @returns True for `#rgb` / `#rrggbb` in either case.
 */
export function isHexColor(value: string): boolean {
  // Anchored pattern, so "red" or "xx#ffffff" can never slip through.
  return HEX_COLOR_PATTERN.test(value);
}

/**
 * Checks whether a string is an absolute web URL that is safe to use as an image source or
 * link target. `new URL()` alone is not a safety check: it accepts `javascript:` and `data:`.
 *
 * @param value - Raw user input.
 * @param protocols - Allow-list of protocols, e.g. `["https:"]`.
 * @returns True only for `scheme://host/...` URLs on an allowed protocol.
 */
export function isAllowedUrl(value: string, protocols: readonly UrlProtocol[]): boolean {
  // Reject whitespace, control characters and raw Unicode up front; browsers would otherwise
  // "fix" them silently and the stored value would not be the URL that gets requested.
  if (!ENCODED_URL_PATTERN.test(value)) {
    return false;
  }

  // Require the explicit "scheme://" form. "https:example.com" parses as absolute on its own,
  // but a browser resolves it relative to the current page when it is used as an href.
  const schemePrefix = /^([a-z][a-z0-9+.-]*:)\/\//i.exec(value);
  if (!schemePrefix) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not parseable at all.
    return false;
  }

  // Allow-list protocols instead of deny-listing the dangerous ones.
  if (!protocols.some((protocol) => protocol === url.protocol)) {
    return false;
  }

  // A host is required, and embedded credentials (https://user:pass@host) would be shown to
  // every shopper who opens the app, so they are rejected.
  return url.hostname.length > 0 && url.username === "" && url.password === "";
}
