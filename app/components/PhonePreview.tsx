import { useEditor } from "../editor/context";
import { SectionPreview } from "../sections/render";

/**
 * A phone-shaped frame that renders the draft exactly as configured, in order. It reads the
 * local draft, so every keystroke shows up immediately without any network request.
 *
 * @returns The preview.
 */
export function PhonePreview() {
  const { state } = useEditor();
  const { sections } = state.draft;

  return (
    <div className="mx-auto flex h-[640px] w-full max-w-[340px] flex-col overflow-hidden rounded-[2.5rem] border-[10px] border-slate-900 bg-white shadow-2xl lg:h-[720px] lg:max-w-[370px]">
      {/* Static phone chrome; it is not part of the configuration. */}
      <div aria-hidden="true" className="flex shrink-0 items-center justify-between px-6 pt-2 pb-1 text-[11px] font-semibold text-slate-900">
        <span>9:41</span>
        <span className="h-5 w-20 rounded-full bg-slate-900" />
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-slate-900" />
          <span className="h-2.5 w-5 rounded-sm border border-slate-900" />
        </span>
      </div>
      <div aria-hidden="true" className="shrink-0 border-b border-slate-100 py-2 text-center text-sm font-semibold tracking-wide text-slate-900">
        Your Store
      </div>

      <section aria-label="Home screen preview" className="flex-1 space-y-5 overflow-y-auto overscroll-contain py-4">
        {sections.length === 0 ? (
          <p className="px-6 pt-16 text-center text-sm text-slate-400">Your home screen is empty. Add a section to see it here.</p>
        ) : (
          sections.map((section) => <SectionPreview key={section.id} section={section} />)
        )}
      </section>
    </div>
  );
}
