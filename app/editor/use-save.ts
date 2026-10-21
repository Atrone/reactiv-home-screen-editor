import { useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { CURRENT_SCHEMA_VERSION } from "../../contract/home-screen";
import { useEditor, useEditorDispatch } from "./context";
import type { SaveRequest, SaveResponse } from "./save-protocol";

/**
 * Saves the draft through the editor route's server action (never to the configuration
 * service directly) and feeds the response back into the reducer exactly once.
 *
 * @returns A function that starts a save of the current draft.
 */
export function useSaveDraft(): () => void {
  const fetcher = useFetcher<SaveResponse>();
  const { state } = useEditor();
  const dispatch = useEditorDispatch();
  const handled = useRef<SaveResponse | undefined>(undefined);

  useEffect(() => {
    // Act once the request has settled, and only on a response we have not applied yet
    // (effects can run twice in development, and re-renders keep the same fetcher.data).
    if (fetcher.state !== "idle" || fetcher.data === undefined || fetcher.data === handled.current) {
      return;
    }
    handled.current = fetcher.data;
    dispatch(
      fetcher.data.ok
        ? { type: "saveSucceeded", configuration: fetcher.data.configuration }
        : { type: "saveFailed", error: fetcher.data.error },
    );
  }, [fetcher.state, fetcher.data, dispatch]);

  return useCallback(() => {
    // The reducer records which draft object was submitted, for reconciliation later.
    dispatch({ type: "saveStarted" });
    // The base revision tells the server which version these edits started from.
    const request: SaveRequest = {
      baseRevision: state.saved?.revision ?? null,
      document: { schemaVersion: CURRENT_SCHEMA_VERSION, data: state.draft },
    };
    void fetcher.submit(request, { method: "post", encType: "application/json" });
  }, [dispatch, fetcher, state.draft, state.saved]);
}
