import { useEffect, useRef, useState } from "react";
import type { Section, SectionType } from "../../contract/home-screen";
import { LIMITS } from "../../contract/limits";
import { useEditor, useEditorDispatch } from "../editor/context";
import { errorsForSection, type FieldErrors } from "../editor/validation";
import { createSection, SECTION_DEFINITIONS, SECTION_TYPES, summarizeSection } from "../sections/registry";
import { SectionFields } from "../sections/render";
import { ConfirmButton } from "./ConfirmButton";
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon, PlusIcon, TrashIcon } from "./icons";

/**
 * The ordered list of section cards plus the "Add section" buttons.
 *
 * @returns The editor panel.
 */
export function SectionList() {
  const { state, validation } = useEditor();
  const dispatch = useEditorDispatch();
  // Remembered so the new card can scroll itself into view once it has rendered.
  const [addedId, setAddedId] = useState<string | null>(null);
  const { sections } = state.draft;
  const full = sections.length >= LIMITS.maxSections;

  /**
   * Appends a new section of the given type.
   *
   * @param type - Section type to add.
   */
  const add = (type: SectionType) => {
    // Ids are generated here, outside the reducer, which keeps the reducer pure.
    const section = createSection(type);
    dispatch({ type: "sectionAdded", section });
    setAddedId(section.id);
  };

  return (
    <div className="space-y-4">
      {validation.screenErrors.map((message) => (
        <p key={message} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
      ))}

      {sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="font-medium text-slate-700">This home screen has no sections yet.</p>
          <p className="mt-1 text-sm text-slate-500">Add a carousel, a text block or a button to get started.</p>
        </div>
      ) : (
        <ol className="space-y-3">
          {sections.map((section, index) => (
            <li key={section.id}>
              <SectionCard
                section={section}
                index={index}
                total={sections.length}
                errors={errorsForSection(validation, section.id)}
                justAdded={section.id === addedId}
              />
            </li>
          ))}
        </ol>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Add section</p>
        <div className="grid grid-cols-3 gap-2">
          {SECTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              disabled={full}
              onClick={() => add(type)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PlusIcon width={16} height={16} />
              {SECTION_DEFINITIONS[type].label}
            </button>
          ))}
        </div>
        {full && <p className="mt-2 text-xs text-slate-500">A home screen can hold up to {LIMITS.maxSections} sections.</p>}
      </div>
    </div>
  );
}

type SectionCardProps = { section: Section; index: number; total: number; errors: FieldErrors; justAdded: boolean };

/**
 * One collapsible section card: summary header with move/remove controls, and the type's form.
 *
 * @param props - The section, its position, its field errors and whether it was just added.
 * @returns The card.
 */
function SectionCard({ section, index, total, errors, justAdded }: SectionCardProps) {
  const dispatch = useEditorDispatch();
  const [expanded, setExpanded] = useState(true);
  const cardRef = useRef<HTMLElement>(null);
  const definition = SECTION_DEFINITIONS[section.type];
  const summary = summarizeSection(section);
  const errorCount = Object.keys(errors).length;
  const bodyId = `${section.id}-body`;
  const buttonClass = "rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30";

  useEffect(() => {
    // Bring a newly added card into view; "nearest" avoids jumping when it is already visible.
    if (justAdded) {
      cardRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
  }, [justAdded]);

  return (
    <article
      ref={cardRef}
      aria-label={`Section ${index + 1} of ${total}: ${definition.label}`}
      className={`rounded-xl border bg-white shadow-sm ${errorCount > 0 ? "border-red-300" : "border-slate-200"}`}
    >
      <header className="flex items-center gap-1 p-2 pl-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left"
        >
          <ChevronIcon className={`shrink-0 text-slate-400 transition ${expanded ? "" : "-rotate-90"}`} />
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{definition.label}</span>
          <span className="truncate text-sm text-slate-800">{summary}</span>
          {errorCount > 0 && <span className="shrink-0 text-xs font-medium text-red-600">{errorCount === 1 ? "1 issue" : `${errorCount} issues`}</span>}
        </button>
        <button
          type="button"
          aria-label="Move up"
          title="Move up"
          disabled={index === 0}
          onClick={() => dispatch({ type: "sectionMoved", sectionId: section.id, toIndex: index - 1 })}
          className={buttonClass}
        >
          <ArrowUpIcon />
        </button>
        <button
          type="button"
          aria-label="Move down"
          title="Move down"
          disabled={index === total - 1}
          onClick={() => dispatch({ type: "sectionMoved", sectionId: section.id, toIndex: index + 1 })}
          className={buttonClass}
        >
          <ArrowDownIcon />
        </button>
        <ConfirmButton
          label="Remove section"
          confirmLabel="Confirm remove section"
          onConfirm={() => dispatch({ type: "sectionRemoved", sectionId: section.id })}
          className="rounded-md p-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
        >
          <TrashIcon />
        </ConfirmButton>
      </header>
      {expanded && (
        <div id={bodyId} className="border-t border-slate-100 p-4">
          <SectionFields section={section} errors={errors} />
        </div>
      )}
    </article>
  );
}
