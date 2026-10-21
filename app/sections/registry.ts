import type { AspectRatio, CarouselImage, Section, SectionOfType, SectionType } from "../../contract/home-screen";
import { createId } from "../editor/ids";

type SectionDefinition<T extends SectionType> = {
  /** Name shown on section cards and in the "Add" buttons. */
  label: string;
  /** One-line summary for a collapsed card, e.g. the title or the image count. */
  summarize: (section: SectionOfType<T>) => string;
};

/**
 * Per-type metadata. Adding a section type means adding its schema to the contract, an entry
 * here, a case in {@link createSection}, and an editor and preview component; TypeScript
 * flags each place that is still missing (this mapped type, and the exhaustive switches).
 */
export const SECTION_DEFINITIONS: { [T in SectionType]: SectionDefinition<T> } = {
  carousel: {
    label: "Carousel",
    summarize: (section) => {
      const count = section.settings.images.length;
      return `${count} ${count === 1 ? "image" : "images"} · ${ASPECT_RATIO_OPTIONS[section.settings.aspectRatio].label}`;
    },
  },
  text: {
    label: "Text",
    summarize: (section) => section.settings.title.trim() || section.settings.description.trim() || "Empty text",
  },
  cta: {
    label: "Button",
    summarize: (section) => section.settings.label.trim() || "No label",
  },
};

/**
 * Summarizes any section with its type's `summarize` function.
 *
 * @param section - Section to summarize.
 * @returns The summary text.
 */
export function summarizeSection(section: Section): string {
  // TypeScript cannot relate `SECTION_DEFINITIONS[section.type]` to `section` itself (a known
  // limitation with correlated unions), so the pairing is restored with this one cast.
  const summarize = SECTION_DEFINITIONS[section.type].summarize as (value: Section) => string;
  return summarize(section);
}

/** Display order of section types in the "Add" menu. */
export const SECTION_TYPES = ["carousel", "text", "cta"] as const satisfies readonly SectionType[];

/** Frame geometry for each carousel view. The brief names the views; these ratios are my choice. */
export const ASPECT_RATIO_OPTIONS: Record<AspectRatio, { label: string; ratio: string; css: string }> = {
  portrait: { label: "Portrait", ratio: "3:4", css: "3 / 4" },
  landscape: { label: "Landscape", ratio: "16:9", css: "16 / 9" },
  square: { label: "Square", ratio: "1:1", css: "1 / 1" },
};

/**
 * Creates a new section of the given type with a fresh id and sensible defaults. Defaults
 * are valid on their own, so adding a section never makes the draft unsavable.
 *
 * @param type - Section type.
 * @returns The new section.
 */
export function createSection(type: SectionType): Section {
  // One case per type keeps the defaults type-checked against each settings schema.
  switch (type) {
    case "carousel":
      return { id: createId("carousel"), type, settings: { aspectRatio: "landscape", images: [] } };
    case "text":
      return {
        id: createId("text"),
        type,
        settings: { title: "New heading", description: "Tell shoppers something worth knowing.", titleColor: "#111827", descriptionColor: "#4b5563" },
      };
    case "cta":
      return {
        id: createId("cta"),
        type,
        settings: { label: "Shop now", url: "https://example.com", buttonColor: "#111827", labelColor: "#ffffff" },
      };
    default:
      return assertNever(type);
  }
}

/**
 * Creates a carousel image entry with a fresh id.
 *
 * @param url - Image URL (already validated by the caller).
 * @returns The image.
 */
export function createImage(url: string): CarouselImage {
  // Alt text starts empty; the editor prompts for it next to the URL.
  return { id: createId("image"), url, alt: "" };
}

/**
 * Compile-time exhaustiveness check for switches over section types.
 *
 * @param value - A value TypeScript has narrowed to `never`.
 * @returns Never returns.
 * @throws Always, if reached at runtime with unexpected data.
 */
export function assertNever(value: never): never {
  // Reaching this means the data has a type the code does not know about.
  throw new Error(`Unhandled section type: ${JSON.stringify(value)}`);
}
