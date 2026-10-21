/**
 * Creates a short random id for a new section or image, e.g. `text-k3j9x2m1a0q7`.
 *
 * Uses `crypto.getRandomValues` rather than `crypto.randomUUID`, because the latter only
 * exists in secure contexts and the editor may be opened over plain http on a LAN address.
 *
 * @param prefix - Readable prefix, usually the section type.
 * @returns An id matching the contract's id rule (letters, digits, '-').
 */
export function createId(prefix: string): string {
  // 8 random bytes is plenty to avoid collisions within one home screen.
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
  return `${prefix}-${suffix}`;
}
