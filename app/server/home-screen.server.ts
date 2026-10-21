import type { Configuration } from "../../contract/api";
import { parseConfigurationDocument, toJsonPointer, type HomeScreen } from "../../contract/home-screen";
import { LIMITS } from "../../contract/limits";
import { createDefaultHomeScreen } from "../editor/default-home-screen";
import { saveRequestSchema, type SaveError } from "../editor/save-protocol";
import type { ConfigurationClient } from "./configuration-client.server";

/**
 * The configuration this page edits. In a multi-merchant product the id would come from the
 * signed-in merchant's app record; with one demo app it is fixed here, on the server, and is
 * never read from the request.
 */
export const HOME_SCREEN_CONFIGURATION_ID = "home";

export type HomeScreenLoad =
  | { status: "saved"; configuration: Configuration }
  | { status: "new"; draft: HomeScreen }
  | { status: "unavailable" };

export type SaveOutcome = { ok: true; configuration: Configuration } | { ok: false; status: number; error: SaveError };

const UNAVAILABLE_MESSAGE = "The configuration service is unavailable. Your changes are still here; try saving again in a moment.";
const CONFLICT_MESSAGE =
  "This home screen was saved somewhere else after you opened it. Your changes are still here: export them if you want to keep them, then reload to get the latest version.";

/**
 * Loads the home screen for the editor's initial render.
 *
 * "Nothing saved yet" (404) and "service down" are deliberately different outcomes: if an
 * outage fell back to the defaults, the next Save would overwrite real data with them.
 *
 * @param client - Configuration service client.
 * @returns The saved configuration, a default draft, or "unavailable".
 */
export async function loadHomeScreen(client: ConfigurationClient): Promise<HomeScreenLoad> {
  const result = await client.get(HOME_SCREEN_CONFIGURATION_ID);
  if (result.ok) {
    return { status: "saved", configuration: result.configuration };
  }
  // Only a definite 404 means "start from the defaults". Loading never creates anything;
  // the first explicit Save does.
  if (result.error.kind === "not_found") {
    return { status: "new", draft: createDefaultHomeScreen() };
  }
  return { status: "unavailable" };
}

/**
 * Handles a save posted by the browser: validates it with the same schema the service uses,
 * then creates (first save) or conditionally updates the configuration.
 *
 * @param client - Configuration service client.
 * @param body - Parsed JSON body from the browser (untrusted).
 * @returns The saved configuration, or an HTTP status and a browser-safe error.
 */
export async function saveHomeScreen(client: ConfigurationClient, body: unknown): Promise<SaveOutcome> {
  // 1. Request envelope.
  const request = saveRequestSchema.safeParse(body);
  if (!request.success) {
    return { ok: false, status: 400, error: { code: "bad_request", message: "The save request was malformed." } };
  }

  // 2. Re-validate the document. The browser already did, but the browser is not trusted, and
  //    invalid input should be stopped here rather than forwarded to the private network.
  const parsed = parseConfigurationDocument(request.data.document);
  if (!parsed.success) {
    const issues = parsed.issues.map((issue) => ({ path: toJsonPointer(issue.path), message: issue.message }));
    return { ok: false, status: 422, error: { code: "invalid", message: parsed.message, issues } };
  }

  // 3. First save creates the configuration; later saves are compare-and-set on the revision
  //    the editor started from.
  const { baseRevision } = request.data;
  const result =
    baseRevision === null
      ? await client.create(HOME_SCREEN_CONFIGURATION_ID, parsed.document)
      : await client.update(HOME_SCREEN_CONFIGURATION_ID, parsed.document, baseRevision);
  if (result.ok) {
    return { ok: true, configuration: result.configuration };
  }

  // 4. Translate service failures into messages the editor can show. Upstream details stay in
  //    the server log.
  switch (result.error.kind) {
    case "conflict":
    case "not_found":
      return { ok: false, status: 409, error: { code: "conflict", message: CONFLICT_MESSAGE } };
    case "rejected":
      if (result.error.status === 413) {
        return { ok: false, status: 413, error: { code: "too_large", message: `This home screen is larger than the ${LIMITS.maxDocumentBytes / 1024 / 1024} MB limit.` } };
      }
      return { ok: false, status: 422, error: { code: "invalid", message: result.error.message, issues: result.error.issues } };
    case "unavailable":
      return { ok: false, status: 503, error: { code: "unavailable", message: UNAVAILABLE_MESSAGE } };
  }
}
