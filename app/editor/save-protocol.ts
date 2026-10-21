import { z } from "zod";
import type { ApiIssue, Configuration } from "../../contract/api";
import type { ConfigurationDocument } from "../../contract/home-screen";

/**
 * Body the browser posts to the editor route's action. There is no configuration id in it:
 * the server decides which configuration this page edits, so a tampered request cannot
 * redirect a save to someone else's id. `baseRevision` is null until the first save.
 */
export const saveRequestSchema = z.strictObject({
  baseRevision: z.number().int().positive().nullable(),
  document: z.unknown(),
});

export type SaveRequest = { baseRevision: number | null; document: ConfigurationDocument };

export type SaveErrorCode = "bad_request" | "invalid" | "conflict" | "too_large" | "unavailable";

export type SaveError = { code: SaveErrorCode; message: string; issues?: ApiIssue[] };

/** What the action returns to the browser. Never contains service URLs, keys or raw upstream errors. */
export type SaveResponse = { ok: true; configuration: Configuration } | { ok: false; error: SaveError };
