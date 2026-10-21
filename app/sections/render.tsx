import { memo } from "react";
import type { Section } from "../../contract/home-screen";
import type { FieldErrors } from "../editor/validation";
import { CarouselFields, CarouselPreview } from "./carousel";
import { CtaFields, CtaPreview } from "./cta";
import { assertNever } from "./registry";
import { TextFields, TextPreview } from "./text";

/**
 * Picks the editor form for a section. The `default` branch makes this switch exhaustive:
 * adding a section type to the contract is a compile error here until it has a form.
 *
 * @param props - The section and its field errors.
 * @returns The type-specific form.
 */
export function SectionFields({ section, errors }: { section: Section; errors: FieldErrors }) {
  // The discriminant narrows `section`, so each form receives its exact settings type.
  switch (section.type) {
    case "carousel":
      return <CarouselFields section={section} errors={errors} />;
    case "text":
      return <TextFields section={section} errors={errors} />;
    case "cta":
      return <CtaFields section={section} errors={errors} />;
    default:
      return assertNever(section);
  }
}

/**
 * Picks the preview renderer for a section. Memoized: the reducer keeps untouched sections
 * as the same objects, so editing one section re-renders only that section's preview.
 *
 * @param props - The section to render.
 * @returns The type-specific preview.
 */
export const SectionPreview = memo(function SectionPreview({ section }: { section: Section }) {
  // Exhaustive for the same reason as SectionFields.
  switch (section.type) {
    case "carousel":
      return <CarouselPreview settings={section.settings} />;
    case "text":
      return <TextPreview settings={section.settings} />;
    case "cta":
      return <CtaPreview settings={section.settings} />;
    default:
      return assertNever(section);
  }
});
