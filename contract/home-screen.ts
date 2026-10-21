import { z } from "zod";
import { LIMITS } from "./limits";
import { isAllowedUrl, isHexColor } from "./rules";

/** Version of the persisted/exported document format. Unrelated to the `/v1` HTTP path or to a configuration's `revision`. */
export const CURRENT_SCHEMA_VERSION = 1;

export const ASPECT_RATIOS = ["portrait", "landscape", "square"] as const;

const entityId = z
  .string()
  .min(1, "Required")
  .max(LIMITS.maxIdLength, `Use at most ${LIMITS.maxIdLength} characters`)
  .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, '-' or '_'");

const hexColor = z.string().refine(isHexColor, "Use a hex color like #1a2b3c or #abc");

const imageUrl = z
  .string()
  .max(LIMITS.maxUrlLength, `Use at most ${LIMITS.maxUrlLength} characters`)
  .refine((value) => isAllowedUrl(value, ["https:"]), "Use a full image URL starting with https://");

const linkUrl = z
  .string()
  .max(LIMITS.maxUrlLength, `Use at most ${LIMITS.maxUrlLength} characters`)
  .refine((value) => isAllowedUrl(value, ["https:", "http:"]), "Use a full link starting with https:// or http://");

export const carouselImageSchema = z.strictObject({
  id: entityId,
  url: imageUrl,
  alt: z.string().max(LIMITS.maxAltTextLength, `Use at most ${LIMITS.maxAltTextLength} characters`),
});

export const carouselSettingsSchema = z.strictObject({
  aspectRatio: z.enum(ASPECT_RATIOS),
  images: z
    .array(carouselImageSchema)
    .max(LIMITS.maxImagesPerCarousel, `A carousel can hold at most ${LIMITS.maxImagesPerCarousel} images`),
});

export const textSettingsSchema = z.strictObject({
  title: z.string().max(LIMITS.maxTitleLength, `Use at most ${LIMITS.maxTitleLength} characters`),
  description: z.string().max(LIMITS.maxDescriptionLength, `Use at most ${LIMITS.maxDescriptionLength} characters`),
  titleColor: hexColor,
  descriptionColor: hexColor,
});

export const ctaSettingsSchema = z.strictObject({
  label: z
    .string()
    .max(LIMITS.maxCtaLabelLength, `Use at most ${LIMITS.maxCtaLabelLength} characters`)
    .refine((value) => value.trim().length > 0, "A button needs a label"),
  url: linkUrl,
  buttonColor: hexColor,
  labelColor: hexColor,
});

export const sectionSchema = z.discriminatedUnion(
  "type",
  [
    z.strictObject({ id: entityId, type: z.literal("carousel"), settings: carouselSettingsSchema }),
    z.strictObject({ id: entityId, type: z.literal("text"), settings: textSettingsSchema }),
    z.strictObject({ id: entityId, type: z.literal("cta"), settings: ctaSettingsSchema }),
  ],
  { error: (issue) => (issue.code === "invalid_union" ? "Unknown section type (expected carousel, text or cta)" : undefined) },
);

/** The configuration payload: an ordered list of sections. Array order is screen order. */
export const homeScreenSchema = z
  .strictObject({
    sections: z.array(sectionSchema).max(LIMITS.maxSections, `A home screen can hold at most ${LIMITS.maxSections} sections`),
  })
  .superRefine(reportDuplicateIds);

/** The portable document: what is exported to a file and what the service accepts on create/update. */
export const configurationDocumentSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  data: homeScreenSchema,
});

export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type CarouselImage = z.infer<typeof carouselImageSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type SectionType = Section["type"];
export type SectionOfType<T extends SectionType> = Extract<Section, { type: T }>;
export type SettingsOf<T extends SectionType> = SectionOfType<T>["settings"];
export type HomeScreen = z.infer<typeof homeScreenSchema>;
export type ConfigurationDocument = z.infer<typeof configurationDocumentSchema>;

export type ValidationIssue = { path: (string | number)[]; message: string };

export type DocumentParseResult =
  | { success: true; document: ConfigurationDocument }
  | { success: false; reason: "invalid" | "unsupported_version"; message: string; issues: ValidationIssue[] };

type Migration = (document: Record<string, unknown>) => Record<string, unknown>;

/**
 * Upgrades a document from version N (the key) to N + 1. Empty because version 1 is the only
 * format that has ever been written; a v2 would add `1: upgradeV1ToV2` here.
 */
const MIGRATIONS: Partial<Record<number, Migration>> = {};

/**
 * Parses an untrusted value (an imported file, a request body, a stored row) into a
 * current-version document. Every boundary uses this one function, so the rules cannot drift.
 *
 * @param input - Any JSON value.
 * @returns The validated document, or a reason, a summary message and field-level issues.
 */
export function parseConfigurationDocument(input: unknown): DocumentParseResult {
  // Read the version on its own first, so a file from a newer editor gets one clear message
  // instead of a list of field errors for a format we do not understand.
  const header = z.looseObject({ schemaVersion: z.number().int().positive() }).safeParse(input);
  if (!header.success) {
    return invalid("This is not a home screen configuration: schemaVersion is missing or not a positive whole number.", header.error);
  }

  const version = header.data.schemaVersion;
  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      success: false,
      reason: "unsupported_version",
      message: `This configuration uses schema version ${version}; this editor supports up to version ${CURRENT_SCHEMA_VERSION}.`,
      issues: [{ path: ["schemaVersion"], message: `Unsupported schema version ${version}` }],
    };
  }

  // Upgrade older documents one version at a time, then validate against the current schema.
  let document: Record<string, unknown> = header.data;
  for (let from = version; from < CURRENT_SCHEMA_VERSION; from += 1) {
    const migrate = MIGRATIONS[from];
    if (!migrate) {
      return {
        success: false,
        reason: "unsupported_version",
        message: `There is no upgrade path from schema version ${from}.`,
        issues: [{ path: ["schemaVersion"], message: `Unsupported schema version ${from}` }],
      };
    }
    document = migrate(document);
  }

  const parsed = configurationDocumentSchema.safeParse(document);
  if (!parsed.success) {
    const count = parsed.error.issues.length;
    return invalid(`The configuration has ${count} invalid ${count === 1 ? "field" : "fields"}.`, parsed.error);
  }
  return { success: true, document: parsed.data };
}

/**
 * Converts Zod issues into the plain issue shape used across the API and the UI.
 *
 * @param error - A Zod error.
 * @returns Issues with string/number paths.
 */
export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  // Symbol keys cannot appear in parsed JSON, but the Zod type allows them, so stringify defensively.
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
    message: issue.message,
  }));
}

/**
 * Formats an issue path as an RFC 6901 JSON Pointer, e.g. `/data/sections/2/settings/url`.
 *
 * @param path - Path segments.
 * @returns The JSON Pointer string ("" for the document root).
 */
export function toJsonPointer(path: readonly (string | number)[]): string {
  // "~" and "/" are the two characters JSON Pointer requires escaping.
  return path.map((segment) => `/${String(segment).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

/**
 * Builds a failed parse result from a Zod error.
 *
 * @param message - Summary shown to the user.
 * @param error - The underlying Zod error.
 * @returns A failed {@link DocumentParseResult}.
 */
function invalid(message: string, error: z.ZodError): DocumentParseResult {
  // Keep the summary and the per-field issues together so callers can show either.
  return { success: false, reason: "invalid", message, issues: toValidationIssues(error) };
}

/**
 * Rejects duplicate section ids, and duplicate image ids within a carousel. Ids are generated
 * in the browser, so the server cannot assume they are unique; duplicates would break
 * React keys and make id-based edits hit the wrong section.
 *
 * @param screen - The parsed home screen.
 * @param context - Zod refinement context used to report issues.
 */
function reportDuplicateIds(screen: { sections: Section[] }, context: z.RefinementCtx): void {
  const sectionIds = new Set<string>();
  screen.sections.forEach((section, sectionIndex) => {
    // Section ids must be unique across the whole screen.
    if (sectionIds.has(section.id)) {
      context.addIssue({ code: "custom", path: ["sections", sectionIndex, "id"], message: `Duplicate section id "${section.id}"` });
    }
    sectionIds.add(section.id);

    // Image ids only need to be unique among siblings, which is where React uses them as keys.
    if (section.type === "carousel") {
      const imageIds = new Set<string>();
      section.settings.images.forEach((image, imageIndex) => {
        if (imageIds.has(image.id)) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex, "settings", "images", imageIndex, "id"],
            message: `Duplicate image id "${image.id}"`,
          });
        }
        imageIds.add(image.id);
      });
    }
  });
}
