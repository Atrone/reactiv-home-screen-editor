import { homeScreenSchema, type HomeScreen } from "../../contract/home-screen";

/** Messages for one section, keyed by field: `title`, `url`, `images`, `images.<imageId>.url`, ... */
export type FieldErrors = Readonly<Record<string, string>>;

export type DraftValidation = {
  isValid: boolean;
  issueCount: number;
  /** Field errors per section id. Keyed by id, not position, so they follow a section when it moves. */
  sectionErrors: Readonly<Record<string, FieldErrors>>;
  /** Problems with the screen as a whole, e.g. too many sections. */
  screenErrors: readonly string[];
};

const NO_FIELD_ERRORS: FieldErrors = {};

/**
 * Validates the draft with the same schema the app server and the configuration service use,
 * and maps every issue onto the field that caused it.
 *
 * @param draft - Current draft (may hold raw, invalid input).
 * @returns Validation summary and field-level errors.
 */
export function validateDraft(draft: HomeScreen): DraftValidation {
  const result = homeScreenSchema.safeParse(draft);
  if (result.success) {
    return { isValid: true, issueCount: 0, sectionErrors: {}, screenErrors: [] };
  }

  const sectionErrors: Record<string, Record<string, string>> = {};
  const screenErrors: string[] = [];
  for (const issue of result.error.issues) {
    const [root, sectionIndex, ...rest] = issue.path;
    const section = root === "sections" && typeof sectionIndex === "number" ? draft.sections[sectionIndex] : undefined;
    // Issues on the list itself (e.g. the section limit) are not tied to one section.
    if (!section) {
      screenErrors.push(issue.message);
      continue;
    }
    const errors = (sectionErrors[section.id] ??= {});
    const key = fieldKey(section, rest);
    // Keep the first message per field; one clear message beats a stack of them.
    errors[key] ??= issue.message;
  }
  return { isValid: false, issueCount: result.error.issues.length, sectionErrors, screenErrors };
}

/**
 * Returns the errors for one section (an empty object when it has none).
 *
 * @param validation - Result of {@link validateDraft}.
 * @param sectionId - Section id.
 * @returns Field errors for that section.
 */
export function errorsForSection(validation: DraftValidation, sectionId: string): FieldErrors {
  // A shared empty object keeps the "no errors" case allocation-free.
  return validation.sectionErrors[sectionId] ?? NO_FIELD_ERRORS;
}

/**
 * Turns the path below a section into a stable field key. Image positions are replaced by
 * image ids so an error stays on its image even if earlier images are removed.
 *
 * @param section - The section the issue belongs to.
 * @param path - Path segments after `sections/<index>`.
 * @returns Field key, e.g. `titleColor` or `images.hero-1.url`; "" for the section itself.
 */
function fieldKey(section: HomeScreen["sections"][number], path: readonly PropertyKey[]): string {
  // Drop the `settings` wrapper: field names are unique within a section type.
  const segments = path[0] === "settings" ? path.slice(1) : path;
  if (section.type === "carousel" && segments[0] === "images" && typeof segments[1] === "number") {
    const image = section.settings.images[segments[1]];
    return ["images", image?.id ?? String(segments[1]), ...segments.slice(2).map(String)].join(".");
  }
  return segments.map(String).join(".");
}
