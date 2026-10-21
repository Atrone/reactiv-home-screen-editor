import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  configurationIdSchema,
  parseRevisionETag,
  revisionETag,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiIssue,
  type Configuration,
} from "../contract/api";
import {
  CURRENT_SCHEMA_VERSION,
  parseConfigurationDocument,
  toJsonPointer,
  toValidationIssues,
  type ConfigurationDocument,
} from "../contract/home-screen";
import { LIMITS } from "../contract/limits";
import type { ConfigurationRepository, StoredConfiguration } from "./repository";

export type ServiceOptions = {
  repository: ConfigurationRepository;
  /** Shared secret callers must present as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  now?: () => Date;
  generateId?: () => string;
  /** Print one line per request (method, path, status, duration). Never includes headers or bodies. */
  logRequests?: boolean;
  logError?: (message: string, details: Record<string, unknown>) => void;
};

/**
 * Builds the private configuration service. Returned as a plain Hono app so tests can call
 * `app.request()` in-process and `main.ts` can bind it to a port.
 *
 * @param options - Storage, API key and injectable clock/id generator.
 * @returns The Hono application.
 */
export function createConfigurationService(options: ServiceOptions): Hono {
  const { repository } = options;
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? randomUUID;
  const logError = options.logError ?? ((message, details) => console.error(message, details));

  const app = new Hono();

  // Optional access log; useful in dev to watch the app server call this service.
  if (options.logRequests) {
    app.use(logger());
  }

  // Unauthenticated liveness probe. It exposes no data.
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Authentication runs before anything reads the body or touches storage.
  app.use(
    "/v1/*",
    bearerAuth({
      token: options.apiKey,
      realm: "configuration-service",
      noAuthenticationHeader: { message: errorBody("UNAUTHORIZED", "Missing Authorization: Bearer <api key> header") },
      invalidAuthenticationHeader: { message: errorBody("BAD_REQUEST", "Malformed Authorization header") },
      invalidToken: { message: errorBody("UNAUTHORIZED", "Invalid API key") },
    }),
  );

  // Oversized bodies are rejected before they are parsed.
  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: LIMITS.maxDocumentBytes,
      onError: (c) => sendError(c, 413, "PAYLOAD_TOO_LARGE", `Request bodies are limited to ${LIMITS.maxDocumentBytes} bytes`),
    }),
  );

  app.get("/v1/configurations/:id", async (c) => {
    // An id that fails the format check cannot exist, so it is simply "not found".
    const id = c.req.param("id");
    const stored = configurationIdSchema.safeParse(id).success ? await repository.get(id) : null;
    if (!stored) {
      return sendError(c, 404, "NOT_FOUND", "Configuration not found");
    }
    return sendConfiguration(c, 200, toConfiguration(stored));
  });

  app.post("/v1/configurations", async (c) => {
    const body = await readJsonObject(c);
    if (body instanceof Response) {
      return body;
    }

    // The caller may propose an id (the editor uses a fixed one); otherwise the service generates it.
    const { id: proposedId, ...documentInput } = body;
    let id = generateId();
    if (proposedId !== undefined) {
      const parsedId = configurationIdSchema.safeParse(proposedId);
      if (!parsedId.success) {
        const issues = toValidationIssues(parsedId.error).map((issue) => ({ path: toJsonPointer(["id", ...issue.path]), message: issue.message }));
        return sendError(c, 422, "VALIDATION_FAILED", "The proposed id is invalid", issues);
      }
      id = parsedId.data;
    }

    const parsed = parseConfigurationDocument(documentInput);
    if (!parsed.success) {
      return sendDocumentError(c, parsed);
    }

    const created = await repository.create({ id, ...toWrite(parsed.document), updatedAt: now().toISOString() });
    if (!created) {
      return sendError(c, 409, "ALREADY_EXISTS", `A configuration with id "${id}" already exists`);
    }
    c.header("Location", `/v1/configurations/${id}`);
    return sendConfiguration(c, 201, toConfiguration(created));
  });

  app.put("/v1/configurations/:id", async (c) => {
    // Updates must say which revision they are based on, so a stale client cannot silently
    // overwrite a newer save (lost update). 428 when the header is missing entirely.
    const ifMatch = c.req.header("If-Match");
    if (ifMatch === undefined) {
      return sendError(c, 428, "PRECONDITION_REQUIRED", 'Send If-Match: "<revision>" with the revision you last read');
    }
    const expectedRevision = parseRevisionETag(ifMatch);
    if (expectedRevision === null) {
      return sendError(c, 400, "BAD_REQUEST", 'If-Match must be a single revision ETag, for example "3"');
    }

    const body = await readJsonObject(c);
    if (body instanceof Response) {
      return body;
    }
    const parsed = parseConfigurationDocument(body);
    if (!parsed.success) {
      return sendDocumentError(c, parsed);
    }

    // PUT never creates: a mistyped id must not quietly start a second configuration.
    const id = c.req.param("id");
    if (!configurationIdSchema.safeParse(id).success) {
      return sendError(c, 404, "NOT_FOUND", "Configuration not found");
    }
    const result = await repository.update({ id, ...toWrite(parsed.document), expectedRevision, updatedAt: now().toISOString() });
    switch (result.status) {
      case "updated":
        return sendConfiguration(c, 200, toConfiguration(result.configuration));
      case "not_found":
        return sendError(c, 404, "NOT_FOUND", "Configuration not found");
      case "revision_mismatch":
        return sendError(
          c,
          412,
          "REVISION_MISMATCH",
          `The configuration changed after revision ${expectedRevision}; the current revision is ${result.currentRevision}`,
        );
    }
  });

  app.notFound((c) => sendError(c, 404, "NOT_FOUND", "Unknown endpoint"));

  app.onError((error, c) => {
    // bearerAuth throws HTTPException with a ready-made 400/401 response. Pass it through;
    // otherwise every authentication failure would surface as a 500.
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    // Log enough to debug without echoing request bodies or headers (which carry the key).
    logError("Unhandled configuration service error", { method: c.req.method, path: c.req.path, error: String(error) });
    return sendError(c, 500, "INTERNAL_ERROR", "Unexpected error");
  });

  return app;
}

/**
 * Builds the standard error envelope.
 *
 * @param code - Machine-readable error code clients branch on.
 * @param message - Human-readable explanation, safe to show to a developer.
 * @param issues - Field-level problems for validation errors.
 * @returns The error body.
 */
function errorBody(code: ApiErrorCode, message: string, issues?: ApiIssue[]): ApiErrorBody {
  // Omit `issues` entirely rather than sending an empty array for non-validation errors.
  return { error: issues ? { code, message, issues } : { code, message } };
}

/**
 * Sends an error response in the standard envelope.
 *
 * @param c - Hono context.
 * @param status - HTTP status.
 * @param code - Error code.
 * @param message - Explanation.
 * @param issues - Optional field-level issues.
 * @returns The response.
 */
function sendError(c: Context, status: ContentfulStatusCode, code: ApiErrorCode, message: string, issues?: ApiIssue[]): Response {
  // Every error goes through here, so the shape cannot drift between routes.
  return c.json(errorBody(code, message, issues), status);
}

/**
 * Maps a failed document parse to 422, distinguishing "newer format" from "invalid fields".
 *
 * @param c - Hono context.
 * @param result - Failed parse result.
 * @returns The response.
 */
function sendDocumentError(c: Context, result: { reason: "invalid" | "unsupported_version"; message: string; issues: { path: (string | number)[]; message: string }[] }): Response {
  // Issue paths become JSON Pointers into the request body.
  const issues = result.issues.map((issue) => ({ path: toJsonPointer(issue.path), message: issue.message }));
  const code: ApiErrorCode = result.reason === "unsupported_version" ? "UNSUPPORTED_SCHEMA_VERSION" : "VALIDATION_FAILED";
  return sendError(c, 422, code, result.message, issues);
}

/**
 * Sends a configuration with its revision as the ETag. Responses are never cached: the
 * editor must always see the latest revision.
 *
 * @param c - Hono context.
 * @param status - 200 or 201.
 * @param configuration - The resource.
 * @returns The response.
 */
function sendConfiguration(c: Context, status: 200 | 201, configuration: Configuration): Response {
  // The ETag is what a client echoes back in If-Match on its next update.
  c.header("ETag", revisionETag(configuration.revision));
  c.header("Cache-Control", "no-store");
  return c.json(configuration, status);
}

/**
 * Reads the request body as a JSON object, answering 415/400/422 for the common client mistakes.
 *
 * @param c - Hono context.
 * @returns The parsed object, or an error response to return as-is.
 */
async function readJsonObject(c: Context): Promise<Record<string, unknown> | Response> {
  // Only JSON is accepted.
  const contentType = c.req.header("Content-Type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return sendError(c, 415, "UNSUPPORTED_MEDIA_TYPE", "Send Content-Type: application/json");
  }

  // Malformed JSON is a 400; well-formed JSON with the wrong shape is a 422.
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return sendError(c, 400, "BAD_REQUEST", "Request body is not valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return sendError(c, 422, "VALIDATION_FAILED", "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/**
 * Picks the storable fields out of a validated document.
 *
 * @param document - A current-version document.
 * @returns Schema version and payload.
 */
function toWrite(document: ConfigurationDocument): { schemaVersion: number; data: unknown } {
  // Only validated data reaches storage; the raw request body never does.
  return { schemaVersion: document.schemaVersion, data: document.data };
}

/**
 * Converts a stored row into the API resource, validating it on the way out. A row that no
 * longer validates is a server bug, so it becomes a 500 rather than reaching a client.
 *
 * @param stored - Row from the repository.
 * @returns The configuration resource.
 */
function toConfiguration(stored: StoredConfiguration): Configuration {
  // Older stored versions would be upgraded here by the same pipeline imports use.
  const parsed = parseConfigurationDocument({ schemaVersion: stored.schemaVersion, data: stored.data });
  if (!parsed.success) {
    throw new Error(`Stored configuration ${stored.id} failed validation: ${parsed.message}`);
  }
  return {
    id: stored.id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
    data: parsed.document.data,
  };
}
