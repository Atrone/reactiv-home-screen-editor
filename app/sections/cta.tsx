import type { SectionOfType, SettingsOf } from "../../contract/home-screen";
import { LIMITS } from "../../contract/limits";
import { isAllowedUrl } from "../../contract/rules";
import { ColorField, TextField } from "../components/fields";
import { useEditorDispatch } from "../editor/context";
import type { FieldErrors } from "../editor/validation";
import { safeColor } from "./colors";

/**
 * Form for a call-to-action button: label, link and the two colors.
 *
 * @param props - The section and its field errors.
 * @returns The form fields.
 */
export function CtaFields({ section, errors }: { section: SectionOfType<"cta">; errors: FieldErrors }) {
  const dispatch = useEditorDispatch();
  const { settings } = section;

  /**
   * Dispatches a partial update of this section's settings.
   *
   * @param patch - Changed fields.
   */
  const update = (patch: Partial<SettingsOf<"cta">>) => {
    // Merged in the reducer against the latest state.
    dispatch({ type: "settingsChanged", sectionId: section.id, sectionType: "cta", patch });
  };

  return (
    <div className="space-y-4">
      <TextField id={`${section.id}-label`} label="Button label" value={settings.label} onChange={(label) => update({ label })} error={errors.label} limit={LIMITS.maxCtaLabelLength} />
      <TextField
        id={`${section.id}-url`}
        label="Link"
        type="url"
        value={settings.url}
        onChange={(url) => update({ url })}
        error={errors.url}
        placeholder="https://"
        hint="Opens in the shopper's browser. Must start with https:// or http://."
        trimOnBlur
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField id={`${section.id}-button-color`} label="Button color" value={settings.buttonColor} onChange={(buttonColor) => update({ buttonColor })} error={errors.buttonColor} />
        <ColorField id={`${section.id}-label-color`} label="Label color" value={settings.labelColor} onChange={(labelColor) => update({ labelColor })} error={errors.labelColor} />
      </div>
    </div>
  );
}

/**
 * Renders the button as it would appear in the app. In the editor it opens its link in a new
 * tab, so clicking it can never navigate away from (and discard) an editing session. An
 * invalid link renders as a plain, non-clickable button.
 *
 * @param props - CTA settings.
 * @returns The preview block.
 */
export function CtaPreview({ settings }: { settings: SettingsOf<"cta"> }) {
  // Only validated http(s) URLs become an href; `javascript:` and friends never do.
  const href = isAllowedUrl(settings.url, ["https:", "http:"]) ? settings.url : undefined;
  const style = { backgroundColor: safeColor(settings.buttonColor, "#111827"), color: safeColor(settings.labelColor, "#ffffff") };
  const className = "block w-full rounded-full px-5 py-3 text-center text-sm font-semibold break-words shadow-sm";
  const label = settings.label.trim() ? settings.label : <span className="opacity-60">Button label</span>;

  return (
    <div className="px-4">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title={`Opens ${href} in a new tab`} className={`${className} transition hover:brightness-110`} style={style}>
          {label}
        </a>
      ) : (
        <span aria-disabled="true" title="Fix the link to make this button clickable" className={`${className} cursor-not-allowed`} style={style}>
          {label}
        </span>
      )}
    </div>
  );
}
