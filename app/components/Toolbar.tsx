import type { ChangeEvent, ReactNode } from "react";
import { useEditor } from "../editor/context";
import type { EditorState } from "../editor/state";
import { DownloadIcon, UploadIcon } from "./icons";

type ToolbarProps = {
  onSave: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  /** Feedback banners, shown inside the sticky header so they stay visible while scrolling. */
  children?: ReactNode;
};

type Status = { text: string; tone: string };

/**
 * Describes the save state in a few words, for the status pill.
 *
 * @param state - Editor state.
 * @param unsaved - Whether the draft differs from the saved version.
 * @returns Status text and its color classes.
 */
function describeStatus(state: EditorState, unsaved: boolean): Status {
  // Order matters: an in-flight or failed save is more important than "unsaved".
  if (state.save.status === "saving") {
    return { text: "Saving…", tone: "bg-slate-100 text-slate-700" };
  }
  if (state.save.status === "failed") {
    return { text: "Not saved", tone: "bg-red-100 text-red-700" };
  }
  if (unsaved) {
    return { text: "Unsaved changes", tone: "bg-amber-100 text-amber-800" };
  }
  if (!state.saved) {
    return { text: "Not saved yet", tone: "bg-slate-100 text-slate-700" };
  }
  return { text: "All changes saved", tone: "bg-emerald-100 text-emerald-800" };
}

/**
 * Sticky header with the save status, the Import, Export and Save actions, and any feedback banners.
 *
 * @param props - Action handlers and banners.
 * @returns The header.
 */
export function Toolbar({ onSave, onExport, onImport, children }: ToolbarProps) {
  const { state, validation, unsaved } = useEditor();
  const status = describeStatus(state, unsaved);
  const saving = state.save.status === "saving";
  // Before the first save the defaults themselves can be saved, so "no changes" does not disable Save.
  const canSave = !saving && validation.isValid && (unsaved || state.saved === null);
  const issueText = `Fix ${validation.issueCount} ${validation.issueCount === 1 ? "field" : "fields"} to save or export`;
  const secondaryButton =
    "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50";

  /**
   * Hands the chosen file to the import handler and resets the input.
   *
   * @param event - File input change event.
   */
  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    event.target.value = "";
    if (file) {
      onImport(file);
    }
  };

  return (
    <header aria-label="Editor toolbar" className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        {/* Full row on phones so the actions wrap below instead of squeezing the title to nothing. */}
        <div className="flex min-w-0 basis-full items-center gap-3 sm:flex-1 sm:basis-auto">
          <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">Home screen editor</h1>
          <span id="save-status" role="status" className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.tone}`}>
            {status.text}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!validation.isValid && <span className="text-xs font-medium text-red-600">{issueText}</span>}
          <label className={`${secondaryButton} relative cursor-pointer focus-within:ring-2 focus-within:ring-indigo-500`}>
            <UploadIcon />
            Import
            <input type="file" accept="application/json,.json" aria-label="Import a configuration file" onChange={pickFile} className="sr-only" />
          </label>
          <button
            type="button"
            onClick={onExport}
            disabled={!validation.isValid}
            title={validation.isValid ? "Download the current draft as JSON" : issueText}
            className={`${secondaryButton} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <DownloadIcon />
            Export
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            // Screen readers announce the button together with the current save state.
            aria-describedby="save-status"
            className="inline-flex min-w-20 items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {/* `empty:hidden` collapses the padding when there is nothing to report. */}
      <div className="mx-auto max-w-6xl space-y-2 px-4 pb-3 empty:hidden sm:px-6">{children}</div>
    </header>
  );
}
