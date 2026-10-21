import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, homeScreenSchema, type ConfigurationDocument } from "./home-screen";

/**
 * HTTP contract of the private configuration service (`/v1`).
 *
 *   GET  /v1/configurations/:id   -> 200 Configuration | 404
 *   POST /v1/configurations       -> 201 Configuration (+ Location) | 409 | 422
 *   PUT  /v1/configurations/:id   -> 200 Configuration | 404 | 412 | 428 | 422   (requires If-Match)
 *
 * Every route requires `Authorization: Bearer <CONFIG_SERVICE_API_KEY>`. Successful responses
 * carry `ETag: "<revision>"`; errors use {@link ApiErrorBody}.
 */

/** Ids appear in URL paths, so they are restricted to lowercase slugs (UUIDs fit). */
export const configurationIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "Use 1-63 lowercase letters, numbers or '-', starting with a letter or number");

/**
 * The stored resource. `revision` increments on every update and is the concurrency token;
 * `schemaVersion` describes the shape of `data`. The service owns `id` (unless the caller
 * proposes one on create), `revision` and `updatedAt`.
 */
export const configurationSchema = z.object({
  id: configurationIdSchema,
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  data: homeScreenSchema,
});

export type Configuration = z.infer<typeof configurationSchema>;

/** POST /v1/configurations. `id` is optional: omit it and the service generates a UUID. */
export type CreateConfigurationBody = ConfigurationDocument & { id?: string };

/** PUT /v1/configurations/:id, sent with `If-Match: "<revision>"`. */
export type UpdateConfigurationBody = ConfigurationDocument;

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "REVISION_MISMATCH"
  | "PRECONDITION_REQUIRED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "VALIDATION_FAILED"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INTERNAL_ERROR";

/** Issue paths are RFC 6901 JSON Pointers into the request body, e.g. `/data/sections/0/settings/url`. */
export type ApiIssue = { path: string; message: string };

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; issues?: ApiIssue[] };
};

/**
 * Parser for error bodies on the consuming side. `code` is read as a plain string so a code
 * added to the service later degrades to "unknown error" instead of failing to parse.
 */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/**
 * Formats a revision as a strong ETag.
 *
 * @param revision - Configuration revision.
 * @returns The quoted entity tag, e.g. `"3"`.
 */
export function revisionETag(revision: number): string {
  // Strong validator: one revision always serializes to exactly one JSON body.
  return `"${revision}"`;
}

/**
 * Reads the revision out of an `If-Match` header value.
 *
 * @param header - Raw header value.
 * @returns The revision, or null when the value is not a single strong revision ETag.
 */
export function parseRevisionETag(header: string): number | null {
  // Only `"<digits>"` is accepted; weak (W/) tags and lists cannot express "exactly this revision".
  const match = /^"(\d{1,15})"$/.exec(header.trim());
  return match ? Number(match[1]) : null;
}
