import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { data, isRouteErrorResponse, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import { LIMITS } from "../../contract/limits";
import { EditorScreen } from "../components/EditorScreen";
import { EditorProvider } from "../editor/context";
import type { SaveResponse } from "../editor/save-protocol";
import type { EditorInit } from "../editor/state";
import { getConfigurationClient } from "../server/configuration-client.server";
import { loadHomeScreen, saveHomeScreen } from "../server/home-screen.server";
import { readJsonBody } from "../server/request-body.server";
import type { Route } from "./+types/editor";

/** Room for the `{ baseRevision, document }` envelope around a maximum-size document. */
const MAX_SAVE_REQUEST_BYTES = LIMITS.maxDocumentBytes + 1024;

/**
 * Page metadata.
 *
 * @returns Title and description tags.
 */
export function meta(): Route.MetaDescriptors {
  // Static: the editor has a single page.
  return [{ title: "Home screen editor" }, { name: "description", content: "Edit and preview a mobile app home screen." }];
}

/**
 * Server-only. Loads the saved home screen (or the defaults if nothing is saved yet) through
 * the private configuration service. The service URL and API key never leave the server;
 * the browser receives only the configuration itself.
 *
 * @returns The saved configuration or a default draft.
 * @throws A 503 response when the service is unavailable, rendered by {@link ErrorBoundary}.
 */
export async function loader() {
  const result = await loadHomeScreen(getConfigurationClient());
  // An outage must not look like "nothing saved yet": defaults saved over real data would be data loss.
  if (result.status === "unavailable") {
    throw data("The configuration service is unavailable.", { status: 503 });
  }
  return result;
}

/**
 * Server-only. Persists a save posted by the editor: bounded body read, validation with the
 * shared schema, then create or compare-and-set update on the private service.
 *
 * @param args - Route action arguments.
 * @returns A {@link SaveResponse} with a matching HTTP status. Expected failures are returned, not thrown.
 */
export async function action({ request }: Route.ActionArgs) {
  const body = await readJsonBody(request, MAX_SAVE_REQUEST_BYTES);
  if (!body.ok) {
    const code = body.status === 413 ? "too_large" : "bad_request";
    return data<SaveResponse>({ ok: false, error: { code, message: body.message } }, { status: body.status });
  }

  const outcome = await saveHomeScreen(getConfigurationClient(), body.value);
  if (!outcome.ok) {
    return data<SaveResponse>({ ok: false, error: outcome.error }, { status: outcome.status });
  }
  return data<SaveResponse>({ ok: true, configuration: outcome.configuration });
}

/**
 * Browser-side wrapper around the server action, still calling it (no direct service access).
 * React Router throws when the app server cannot be reached at all, and a thrown action
 * error would replace the editor with the error page, losing the draft. This turns that
 * into an ordinary "unavailable" result instead.
 *
 * @param args - Client action arguments.
 * @returns The server action's result, or an "unavailable" failure.
 */
export async function clientAction({ serverAction }: Route.ClientActionArgs): Promise<SaveResponse> {
  try {
    return await serverAction();
  } catch {
    // Network down, server restarting, or a proxy error page: all retryable, none lose edits.
    return {
      ok: false,
      error: { code: "unavailable", message: "Could not reach the server. Your changes are still here; check your connection and try again." },
    };
  }
}

/**
 * Skips the automatic loader re-run after a save. The action already returns the saved
 * configuration, and fresh loader data would arrive while the user may still be typing.
 *
 * @param args - Revalidation arguments.
 * @returns False after form submissions, React Router's default otherwise.
 */
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  // Explicit revalidations ("load latest", "try again") have no form method and still run.
  return formMethod ? false : defaultShouldRevalidate;
}

/**
 * Converts loader data into the editor's initial state.
 *
 * @param loaderData - What {@link loader} returned.
 * @returns The opening draft and saved snapshot.
 */
function toEditorInit(loaderData: Route.ComponentProps["loaderData"]): EditorInit {
  // Draft and saved data start as the same object, so the editor opens with no unsaved changes.
  if (loaderData.status === "saved") {
    const { revision, updatedAt, data: screen } = loaderData.configuration;
    return { draft: screen, saved: { revision, updatedAt, data: screen } };
  }
  return { draft: loaderData.draft, saved: null };
}

/**
 * The editor page.
 *
 * @param props - Route component props.
 * @returns The editor.
 */
export default function EditorRoute({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  // Bumping the key remounts the provider, starting a new session from fresh loader data.
  const [session, setSession] = useState(0);
  const reloadRequested = useRef(false);
  const init = useMemo(() => toEditorInit(loaderData), [loaderData]);

  useEffect(() => {
    // React Router commits revalidated data in a transition, after revalidate() has resolved.
    // Remounting from the promise would race it and restart from the stale data, so the new
    // session starts here, once the fresh loader data is actually rendered.
    if (reloadRequested.current) {
      reloadRequested.current = false;
      setSession((value) => value + 1);
    }
  }, [loaderData]);

  const reloadLatest = useCallback(() => {
    // Other revalidations (e.g. dev hot reload) leave the flag unset and never discard edits.
    reloadRequested.current = true;
    void revalidator.revalidate();
  }, [revalidator]);

  return (
    <EditorProvider key={session} init={init}>
      <EditorScreen onReloadLatest={reloadLatest} />
    </EditorProvider>
  );
}

/**
 * Shown when the initial load fails. Says plainly what happened and offers a retry, instead
 * of showing an empty or default editor that could be saved over real data.
 *
 * @param props - The thrown error.
 * @returns The error page.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const revalidator = useRevalidator();
  const unavailable = isRouteErrorResponse(error) && error.status === 503;
  const retrying = revalidator.state === "loading";

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-3 px-6">
      <h1 className="text-xl font-semibold text-slate-900">{unavailable ? "Could not load your home screen" : "Something went wrong"}</h1>
      <p className="text-slate-600">
        {unavailable
          ? "The configuration service is not responding. Nothing was changed, and your saved home screen is safe."
          : "The editor could not be loaded. Nothing was changed."}
      </p>
      {import.meta.env.DEV && error instanceof Error && <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{error.message}</pre>}
      <div>
        <button
          type="button"
          // Re-runs the loader; on success React Router swaps this page for the editor.
          onClick={() => void revalidator.revalidate()}
          disabled={retrying}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:bg-indigo-300"
        >
          {retrying ? "Retrying…" : "Try again"}
        </button>
      </div>
    </main>
  );
}
