import { apiErrorBodySchema, configurationSchema, revisionETag, type ApiIssue, type Configuration } from "../../contract/api";
import type { ConfigurationDocument } from "../../contract/home-screen";
import { getAppServerEnv } from "./env.server";

/** Why a call to the configuration service did not produce a configuration. */
export type ServiceFailure =
  | { kind: "not_found" }
  /** 409 (id taken) or 412 (stale revision): someone else saved first. */
  | { kind: "conflict"; message: string }
  /** The service refused the request itself (validation, size). Should not happen after local validation. */
  | { kind: "rejected"; status: number; message: string; issues: ApiIssue[] }
  /** Network failure, timeout, 5xx, bad credentials or an unexpected response shape. */
  | { kind: "unavailable" };

export type ServiceResult = { ok: true; configuration: Configuration } | { ok: false; error: ServiceFailure };

export type ConfigurationClient = {
  get(id: string): Promise<ServiceResult>;
  create(id: string, document: ConfigurationDocument): Promise<ServiceResult>;
  update(id: string, document: ConfigurationDocument, expectedRevision: number): Promise<ServiceResult>;
};

export type ClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logError?: (message: string, details: Record<string, unknown>) => void;
};

/**
 * Creates the server-side client for the private configuration service. This is the only code
 * that holds the API key, and the only code that knows the service's URL.
 *
 * @param options - Base URL, key, and injectable fetch/timeout/logger for tests.
 * @returns A client whose methods never throw; failures come back as {@link ServiceFailure}.
 */
export function createConfigurationClient(options: ClientOptions): ConfigurationClient {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const logError = options.logError ?? ((message, details) => console.error(message, details));

  /**
   * Sends one request and normalizes every outcome into a {@link ServiceResult}.
   *
   * @param method - HTTP method.
   * @param path - Path under the service base URL.
   * @param body - Optional JSON body.
   * @param extraHeaders - Additional headers (If-Match).
   * @returns The result.
   */
  async function send(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ServiceResult> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, options.baseUrl), {
        method,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // A hung service must not hang the page render or the save button forever.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Log the method and path only; the request headers carry the key.
      logError("Configuration service unreachable", { method, path, error: String(error) });
      return { ok: false, error: { kind: "unavailable" } };
    }

    const payload: unknown = await response.json().catch(() => null);

    // Validate success bodies too: if the service and app ever disagree on the contract, fail
    // here at the boundary instead of rendering a half-understood document.
    if (response.ok) {
      const parsed = configurationSchema.safeParse(payload);
      if (parsed.success) {
        return { ok: true, configuration: parsed.data };
      }
      logError("Configuration service returned an unexpected body", { method, path, status: response.status });
      return { ok: false, error: { kind: "unavailable" } };
    }

    const apiError = apiErrorBodySchema.safeParse(payload);
    const message = apiError.success ? apiError.data.error.message : `HTTP ${response.status}`;
    switch (response.status) {
      case 404:
        return { ok: false, error: { kind: "not_found" } };
      case 409:
      case 412:
        return { ok: false, error: { kind: "conflict", message } };
      case 400:
      case 413:
      case 415:
      case 422:
        return { ok: false, error: { kind: "rejected", status: response.status, message, issues: apiError.success ? (apiError.data.error.issues ?? []) : [] } };
      case 401:
        // Our own key was refused: a deployment problem, not something the user can fix.
        logError("Configuration service rejected the app server's credentials; check CONFIG_SERVICE_API_KEY", { method, path });
        return { ok: false, error: { kind: "unavailable" } };
      default:
        logError("Configuration service error", { method, path, status: response.status, message });
        return { ok: false, error: { kind: "unavailable" } };
    }
  }

  return {
    /**
     * Loads a configuration by id.
     *
     * @param id - Configuration id.
     * @returns The result.
     */
    get(id) {
      // encodeURIComponent keeps an id from ever changing the request path.
      return send("GET", `/v1/configurations/${encodeURIComponent(id)}`);
    },

    /**
     * Creates a configuration under the given id.
     *
     * @param id - Proposed id.
     * @param document - Validated document.
     * @returns The result (conflict if the id exists).
     */
    create(id, document) {
      // The proposed id travels in the body; the service still validates it.
      return send("POST", "/v1/configurations", { id, ...document });
    },

    /**
     * Updates a configuration if it is still at `expectedRevision`.
     *
     * @param id - Configuration id.
     * @param document - Validated document.
     * @param expectedRevision - Revision the editor started from.
     * @returns The result (conflict if someone saved in between).
     */
    update(id, document, expectedRevision) {
      // If-Match makes the update a compare-and-set on the service side.
      return send("PUT", `/v1/configurations/${encodeURIComponent(id)}`, document, { "If-Match": revisionETag(expectedRevision) });
    },
  };
}

let sharedClient: ConfigurationClient | undefined;

/**
 * Returns the process-wide client configured from the environment.
 *
 * @returns The shared client.
 */
export function getConfigurationClient(): ConfigurationClient {
  // Created on first use so env validation happens at request time, not import time.
  if (!sharedClient) {
    const env = getAppServerEnv();
    sharedClient = createConfigurationClient({ baseUrl: env.configServiceUrl, apiKey: env.configServiceApiKey });
  }
  return sharedClient;
}
