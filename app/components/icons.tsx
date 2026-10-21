import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/**
 * Shared wrapper for 20x20 stroke icons. Icons are decorative: the buttons that use them
 * carry their own accessible names.
 *
 * @param props - SVG props plus the path content.
 * @returns The SVG element.
 */
function Icon({ children, ...props }: IconProps) {
  // aria-hidden keeps screen readers from announcing meaningless path data.
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width={18} height={18} {...props}>
      {children}
    </svg>
  );
}

/**
 * Upward arrow, used for "move up".
 *
 * @param props - SVG props.
 * @returns The icon.
 */
export function ArrowUpIcon(props: IconProps) {
  // Shaft plus arrowhead.
  return <Icon {...props}><path d="M10 16V4M5 9l5-5 5 5" /></Icon>;
}

/**
 * Downward arrow, used for "move down".
 *
 * @param props - SVG props.
 * @returns The icon.
 */
export function ArrowDownIcon(props: IconProps) {
  // Shaft plus arrowhead.
  return <Icon {...props}><path d="M10 4v12M5 11l5 5 5-5" /></Icon>;
}

/**
 * Trash can, used for "remove".
 *
 * @param props - SVG props.
 * @returns The icon.
 */
export function TrashIcon(props: IconProps) {
  // Lid, can and two inner lines.
  return <Icon {...props}><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10M9 9v4M11 9v4" /></Icon>;
}

/**
 * Chevron that rotates to show expanded/collapsed state.
 *
 * @param props - SVG props.
 * @returns The icon.
 */
export function ChevronIcon(props: IconProps) {
  // Points down; callers rotate it for the collapsed state.
  return <Icon {...props}><path d="M5 8l5 5 5-5" /></Icon>;
}

/**
 * Left chevron for carousel navigation.
 *
 * @param props - SVG props.
 * @returns The icon.
 */
export function ChevronLeftIcon(props: IconProps) {
  // Single stroke.
  return <Icon {...props}><path d="M12 5l-5 5 5 5" /></Icon>;
}

/**
 * Right chevron for carousel navigation.
 *
 * @param props - SVG props.
 * @returns The icon.
 */
export function ChevronRightIcon(props: IconProps) {
  // Single stroke.
  return <Icon {...props}><path d="M8 5l5 5-5 5" /></Icon>;
}

/**
 * Plus sign for "add" actions.
 *
 * @param props - SVG props.
 * @returns The icon.
 */
export function PlusIcon(props: IconProps) {
  // Two crossing strokes.
  return <Icon {...props}><path d="M10 4v12M4 10h12" /></Icon>;
}

/**
 * Tray with an upward arrow, for importing a file.
 *
 * @param props - SVG props.
 * @returns The icon.
 */
export function UploadIcon(props: IconProps) {
  // Arrow leaving a tray.
  return <Icon {...props}><path d="M10 13V3M6 7l4-4 4 4M4 13v3h12v-3" /></Icon>;
}

/**
 * Tray with a downward arrow, for exporting a file.
 *
 * @param props - SVG props.
 * @returns The icon.
 */
export function DownloadIcon(props: IconProps) {
  // Arrow entering a tray.
  return <Icon {...props}><path d="M10 3v10M6 9l4 4 4-4M4 13v3h12v-3" /></Icon>;
}
