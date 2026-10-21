import { useState, type ReactNode } from "react";
import { downloadTextFile, useLeavePageWarning } from "../editor/browser";
import { useEditor, useEditorDispatch } from "../editor/context";
import { exportFileName, readImportFile, serializeForExport } from "../editor/import-export";
import type { SaveError } from "../editor/save-protocol";
import { useSaveDraft } from "../editor/use-save";
import { PhonePreview } from "./PhonePreview";
import { SectionList } from "./SectionList";
import { Toolbar } from "./Toolbar";

type Notice = { tone: "error" | "success"; title: string; message: string; details?: string[] };

type EditorScreenProps = {
  /** Discards local edits and reloads the saved configuration from the server. */
  onReloadLatest: () => void;
};

/**
 * The editor page: toolbar, feedback banners, the section list and the live preview. On
 * narrow screens the list and the preview become two views with a toggle, so the preview is
 * never pushed far below the field being edited.
 *
 * @param props - Callback for "load the latest version" after a save conflict.
 * @returns The page body.
 */
export function EditorScreen({ onReloadLatest }: EditorScreenProps) {
  const { state, unsaved } = useEditor();
  const dispatch = useEditorDispatch();
  const save = useSaveDraft();
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [notice, setNotice] = useState<Notice | null>(null);
  useLeavePageWarning(unsaved);

  /**
   * Downloads the current draft (including unsaved edits) as a JSON file.
   */
  const exportDraft = () => {
    // Export is purely client-side; it never touches the server or its credentials.
    downloadTextFile(exportFileName(new Date()), serializeForExport(state.draft));
  };

  /**
   * Validates a chosen file and, only if it is entirely valid, replaces the draft with it.
   *
   * @param file - The selected file.
   */
  const importFile = async (file: File) => {
    const result = await readImportFile(file);
    // A rejected file leaves the draft exactly as it was.
    if (!result.ok) {
      setNotice({ tone: "error", title: `Could not import ${file.name}`, message: result.message, details: result.details });
      return;
    }
    dispatch({ type: "draftReplaced", draft: result.document.data });
    setNotice({ tone: "success", title: `Imported ${file.name}`, message: "Review the preview, then Save to keep it. Nothing has been saved yet." });
  };

  return (
    <div className="min-h-dvh bg-slate-100">
      <Toolbar onSave={save} onExport={exportDraft} onImport={importFile}>
        {state.save.status === "failed" && (
          <SaveErrorBanner
            error={state.save.error}
            onRetry={save}
            onExport={exportDraft}
            onReloadLatest={onReloadLatest}
            onDismiss={() => dispatch({ type: "saveErrorDismissed" })}
          />
        )}
        {notice && (
          <Banner tone={notice.tone} title={notice.title} onDismiss={() => setNotice(null)}>
            <p>{notice.message}</p>
            {notice.details && notice.details.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {notice.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </Banner>
        )}
      </Toolbar>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-200 p-1 md:hidden" aria-label="Choose view">
          {(["edit", "preview"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className="rounded-md py-1.5 text-sm font-medium text-slate-600 aria-pressed:bg-white aria-pressed:text-slate-900 aria-pressed:shadow-sm"
            >
              {option === "edit" ? "Edit" : "Preview"}
            </button>
          ))}
        </div>

        <main className="grid gap-6 py-6 md:grid-cols-[minmax(0,1fr)_340px] lg:grid-cols-[minmax(0,1fr)_370px] lg:gap-10">
          <div className={view === "edit" ? "min-w-0" : "min-w-0 max-md:hidden"}>
            <SectionList />
          </div>
          <div className={view === "preview" ? "" : "max-md:hidden"}>
            <div className="md:sticky md:top-24">
              <PhonePreview />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

type SaveErrorBannerProps = {
  error: SaveError;
  onRetry: () => void;
  onExport: () => void;
  onReloadLatest: () => void;
  onDismiss: () => void;
};

/**
 * Explains a failed save and offers the recovery that fits it. The draft is untouched in every case.
 *
 * @param props - The error and the recovery actions.
 * @returns The banner.
 */
function SaveErrorBanner({ error, onRetry, onExport, onReloadLatest, onDismiss }: SaveErrorBannerProps) {
  const action = "rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-800 transition hover:bg-red-100";
  return (
    <Banner tone="error" title={error.code === "conflict" ? "Someone else saved first" : "Your changes were not saved"} onDismiss={onDismiss}>
      <p>{error.message}</p>
      {error.issues && error.issues.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {error.issues.map((issue) => (
            <li key={`${issue.path} ${issue.message}`}>
              <code className="text-xs">{issue.path}</code>: {issue.message}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {error.code === "conflict" ? (
          <>
            <button type="button" onClick={onExport} className={action}>
              Export my version
            </button>
            <button type="button" onClick={onReloadLatest} className={action}>
              Discard my changes and load the latest
            </button>
          </>
        ) : (
          error.code === "unavailable" && (
            <button type="button" onClick={onRetry} className={action}>
              Try again
            </button>
          )
        )}
      </div>
    </Banner>
  );
}

type BannerProps = { tone: "error" | "success"; title: string; onDismiss: () => void; children: ReactNode };

/**
 * Dismissible feedback message. Errors are announced immediately (role="alert"), success politely.
 *
 * @param props - Tone, title, content and dismiss handler.
 * @returns The banner.
 */
function Banner({ tone, title, onDismiss, children }: BannerProps) {
  // Color and live-region politeness both follow the tone.
  const toneClass = tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <div className="mt-0.5">{children}</div>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="self-start rounded-md px-1.5 text-lg leading-none opacity-60 hover:opacity-100">
        ×
      </button>
    </div>
  );
}
