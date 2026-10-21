import type { SectionOfType, SettingsOf } from "../../contract/home-screen";
import { LIMITS } from "../../contract/limits";
import { ColorField, TextAreaField, TextField } from "../components/fields";
import { useEditorDispatch } from "../editor/context";
import type { FieldErrors } from "../editor/validation";
import { safeColor } from "./colors";

/**
 * Form for a text section: title, description and their colors.
 *
 * @param props - The section and its field errors.
 * @returns The form fields.
 */
export function TextFields({ section, errors }: { section: SectionOfType<"text">; errors: FieldErrors }) {
  const dispatch = useEditorDispatch();
  const { settings } = section;

  /**
   * Dispatches a partial update of this section's settings.
   *
   * @param patch - Changed fields.
   */
  const update = (patch: Partial<SettingsOf<"text">>) => {
    // The reducer merges the patch into the latest state, so rapid edits never overwrite each other.
    dispatch({ type: "settingsChanged", sectionId: section.id, sectionType: "text", patch });
  };

  return (
    <div className="space-y-4">
      <TextField id={`${section.id}-title`} label="Title" value={settings.title} onChange={(title) => update({ title })} error={errors.title} limit={LIMITS.maxTitleLength} />
      <TextAreaField
        id={`${section.id}-description`}
        label="Description"
        value={settings.description}
        onChange={(description) => update({ description })}
        error={errors.description}
        limit={LIMITS.maxDescriptionLength}
        hint="Line breaks are kept. Leave empty to show only the title."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField id={`${section.id}-title-color`} label="Title color" value={settings.titleColor} onChange={(titleColor) => update({ titleColor })} error={errors.titleColor} />
        <ColorField
          id={`${section.id}-description-color`}
          label="Description color"
          value={settings.descriptionColor}
          onChange={(descriptionColor) => update({ descriptionColor })}
          error={errors.descriptionColor}
        />
      </div>
    </div>
  );
}

/**
 * Renders a text section as it would appear in the app. Text is rendered as text (React
 * escapes it), and line breaks in the description are preserved.
 *
 * @param props - Text settings.
 * @returns The preview block.
 */
export function TextPreview({ settings }: { settings: SettingsOf<"text"> }) {
  // An empty section would be invisible; show the author where it is.
  if (!settings.title.trim() && !settings.description.trim()) {
    return <div className="mx-4 rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">Empty text section</div>;
  }
  return (
    <div className="px-4">
      {settings.title && (
        <h2 className="text-xl font-bold leading-snug break-words" style={{ color: safeColor(settings.titleColor, "#111827") }}>
          {settings.title}
        </h2>
      )}
      {settings.description && (
        <p className="mt-1 text-sm leading-relaxed whitespace-pre-line break-words" style={{ color: safeColor(settings.descriptionColor, "#4b5563") }}>
          {settings.description}
        </p>
      )}
    </div>
  );
}
