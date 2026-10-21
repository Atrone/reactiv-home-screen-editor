import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { createInitialState, editorReducer, hasUnsavedChanges, type EditorAction, type EditorInit, type EditorState } from "./state";
import { validateDraft, type DraftValidation } from "./validation";

export type EditorContextValue = {
  state: EditorState;
  /** Derived from the draft on every change, with the same schema the server uses. */
  validation: DraftValidation;
  unsaved: boolean;
};

const EditorStateContext = createContext<EditorContextValue | null>(null);
// Dispatch lives in its own context: it never changes, so components that only dispatch
// (buttons, inputs) do not need to subscribe to state changes they do not render.
const EditorDispatchContext = createContext<Dispatch<EditorAction> | null>(null);

/**
 * Owns the editor's state for one editing session. Remounting the provider (via `key`)
 * starts a fresh session, which is how "load the latest version" discards local edits.
 *
 * @param props - The initial draft/saved snapshot and the editor UI.
 * @returns The provider tree.
 */
export function EditorProvider({ init, children }: { init: EditorInit; children: ReactNode }) {
  // `init` is only read on mount; later loader revalidations do not overwrite a live draft.
  const [state, dispatch] = useReducer(editorReducer, init, createInitialState);
  const validation = useMemo(() => validateDraft(state.draft), [state.draft]);
  const unsaved = useMemo(() => hasUnsavedChanges(state), [state]);
  const value = useMemo(() => ({ state, validation, unsaved }), [state, validation, unsaved]);

  return (
    <EditorDispatchContext.Provider value={dispatch}>
      <EditorStateContext.Provider value={value}>{children}</EditorStateContext.Provider>
    </EditorDispatchContext.Provider>
  );
}

/**
 * Reads the editor state, validation and unsaved flag.
 *
 * @returns The editor context value.
 * @throws Error when used outside {@link EditorProvider}.
 */
export function useEditor(): EditorContextValue {
  const value = useContext(EditorStateContext);
  // A missing provider is a wiring bug; fail loudly instead of rendering empty UI.
  if (!value) {
    throw new Error("useEditor must be used inside <EditorProvider>");
  }
  return value;
}

/**
 * Returns the stable dispatch function for editor actions.
 *
 * @returns The reducer's dispatch.
 * @throws Error when used outside {@link EditorProvider}.
 */
export function useEditorDispatch(): Dispatch<EditorAction> {
  const dispatch = useContext(EditorDispatchContext);
  // Same wiring check as useEditor.
  if (!dispatch) {
    throw new Error("useEditorDispatch must be used inside <EditorProvider>");
  }
  return dispatch;
}
