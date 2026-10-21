import { isHexColor } from "../../contract/rules";

/**
 * Returns the color if it is a valid hex value, otherwise the fallback. The draft can hold
 * half-typed input like "#12"; the preview must never pass that (or anything else
 * unvalidated) into a style attribute.
 *
 * @param value - Draft color value.
 * @param fallback - Color to use while the value is invalid.
 * @returns A safe CSS color.
 */
export function safeColor(value: string, fallback: string): string {
  // Validated hex values are the only strings that ever reach inline styles.
  return isHexColor(value) ? value : fallback;
}

/**
 * Expands `#abc` to `#aabbcc` and lowercases, the only format `<input type="color">` accepts.
 *
 * @param value - A valid 3- or 6-digit hex color.
 * @returns The 6-digit lowercase form.
 */
export function toSixDigitHex(value: string): string {
  // Short form doubles each digit: #abc -> #aabbcc.
  const hex = value.slice(1).toLowerCase();
  return hex.length === 3 ? `#${[...hex].map((digit) => digit + digit).join("")}` : `#${hex}`;
}
