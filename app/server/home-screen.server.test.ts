import { describe, expect, it, vi } from "vitest";
import type { SectionOfType } from "../../contract/home-screen";
import { createConfigurationService } from "../../service/app";
import { createSqliteRepository, openDatabase } from "../../service/repository";
import { buildFixtureDocument } from "../../test/fixtures";
import { createDefaultHomeScreen } from "../editor/default-home-screen";
import { createConfigurationClient } from "./configuration-client.server";
import { HOME_SCREEN_CONFIGURATION_ID, loadHomeScreen, saveHomeScreen } from "./home-screen.server";

const API_KEY = "test-key-0123456789abcdefghijklmnopqrstuvwxyz";
const BASE_URL = "http://config.internal:4000";

type SetupOptions = { apiKey?: string; fetch?: typeof fetch; timeoutMs?: number };

/**
 * Wires the real configuration client to the real service (auth, validation, in-memory
 * SQLite) through an injected fetch, so the app-server -> service path runs without a port.
 *
 * @param options - Override the key the client sends, the transport, or the timeout.
 * @returns The client, the service's repository, captured outgoing requests and the client's error logger.
 */
function setup(options: SetupOptions = {}) {
  const repository = createSqliteRepository(openDatabase(":memory:"));
  const service = createConfigurationService({ repository, apiKey: API_KEY, logError: vi.fn() });
  const requests: Request[] = [];

  /**
   * Transport that hands each request to the Hono app in-process and records it.
   *
   * @param input - URL or request built by the client.
   * @param init - Method, headers, body and abort signal.
   * @returns The service's response.
   */
  const inProcessFetch: typeof fetch = async (input, init) => {
    // Keep a copy so tests can assert on exactly what left the app server.
    const request = new Request(input, init);
    requests.push(request.clone());
    return service.request(request);
  };

  const logError = vi.fn();
  const client = createConfigurationClient({
    baseUrl: BASE_URL,
    apiKey: options.apiKey ?? API_KEY,
    fetch: options.fetch ?? inProcessFetch,
    timeoutMs: options.timeoutMs,
    logError,
  });
  return { client, repository, requests, logError };
}

/**
 * Returns the fixture document with the first text section's title replaced.
 *
 * @param title - New title.
 * @returns A changed copy of the fixture.
 */
function withTitle(title: string) {
  const document = buildFixtureDocument();
  // Index 1 is the "intro" text section in the fixture.
  (document.data.sections[1] as SectionOfType<"text">).settings.title = title;
  return document;
}

describe("loadHomeScreen", () => {
  it("returns the default draft when nothing is saved, without creating anything", async () => {
    const { client, repository, requests } = setup();

    const result = await loadHomeScreen(client);

    expect(result).toEqual({ status: "new", draft: createDefaultHomeScreen() });
    // Loading is read-only: the first explicit Save is what creates the configuration.
    expect(await repository.get(HOME_SCREEN_CONFIGURATION_ID)).toBeNull();
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([`GET ${BASE_URL}/v1/configurations/home`]);
    expect(requests[0]!.headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("reports an unreachable service as unavailable, never as 'nothing saved'", async () => {
    const { client, logError } = setup({ fetch: () => Promise.reject(new TypeError("fetch failed")) });

    expect(await loadHomeScreen(client)).toEqual({ status: "unavailable" });
    expect(logError).toHaveBeenCalledWith("Configuration service unreachable", expect.objectContaining({ method: "GET" }));
  });

  it("gives up on a hung service after the timeout", async () => {
    // Never answers; only the client's abort signal ends the request.
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const { client } = setup({ fetch: hang, timeoutMs: 20 });

    expect(await loadHomeScreen(client)).toEqual({ status: "unavailable" });
  });

  it("treats a refused API key as a deployment problem and never logs the key", async () => {
    const wrongKey = "wrong-key-0123456789abcdefghijklmnopqrstuv";
    const { client, logError } = setup({ apiKey: wrongKey });

    expect(await loadHomeScreen(client)).toEqual({ status: "unavailable" });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("CONFIG_SERVICE_API_KEY"), expect.any(Object));
    expect(JSON.stringify(logError.mock.calls)).not.toContain(wrongKey);
  });

  it("rejects a success response that does not match the contract", async () => {
    const drifted: typeof fetch = async () => Response.json({ id: "home", sections: [] });
    const { client } = setup({ fetch: drifted });

    expect(await loadHomeScreen(client)).toEqual({ status: "unavailable" });
  });
});

describe("saveHomeScreen", () => {
  it("creates on first save, then a reload returns exactly what was saved", async () => {
    const { client, requests } = setup();

    const saved = await saveHomeScreen(client, { baseRevision: null, document: buildFixtureDocument() });

    expect(saved).toMatchObject({ ok: true, configuration: { id: "home", revision: 1, data: buildFixtureDocument().data } });
    expect(requests.at(-1)!.method).toBe("POST");
    const reloaded = await loadHomeScreen(client);
    expect(reloaded).toEqual({ status: "saved", configuration: saved.ok && saved.configuration });
  });

  it("updates with If-Match set to the revision the editor started from", async () => {
    const { client, requests } = setup();
    await saveHomeScreen(client, { baseRevision: null, document: buildFixtureDocument() });

    const updated = await saveHomeScreen(client, { baseRevision: 1, document: withTitle("Winter") });

    expect(updated).toMatchObject({ ok: true, configuration: { revision: 2 } });
    expect(requests.at(-1)!.method).toBe("PUT");
    expect(requests.at(-1)!.headers.get("If-Match")).toBe('"1"');
  });

  it("turns a stale revision into a conflict and keeps the newer save", async () => {
    const { client } = setup();
    await saveHomeScreen(client, { baseRevision: null, document: buildFixtureDocument() });
    await saveHomeScreen(client, { baseRevision: 1, document: withTitle("Saved by tab A") });

    const stale = await saveHomeScreen(client, { baseRevision: 1, document: withTitle("Saved by tab B") });

    expect(stale).toMatchObject({ ok: false, status: 409, error: { code: "conflict" } });
    const reloaded = await loadHomeScreen(client);
    expect(reloaded.status === "saved" && (reloaded.configuration.data.sections[1] as SectionOfType<"text">).settings.title).toBe("Saved by tab A");
  });

  it("treats two first saves (both tabs saw an empty service) as a conflict, not an overwrite", async () => {
    const { client } = setup();
    await saveHomeScreen(client, { baseRevision: null, document: withTitle("First") });

    const second = await saveHomeScreen(client, { baseRevision: null, document: withTitle("Second") });

    expect(second).toMatchObject({ ok: false, status: 409, error: { code: "conflict" } });
  });

  it("rejects an invalid document with field issues before calling the service", async () => {
    const { client, requests } = setup();
    const document = buildFixtureDocument();
    (document.data.sections[2] as SectionOfType<"cta">).settings.url = "javascript:alert(1)";

    const result = await saveHomeScreen(client, { baseRevision: null, document });

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: {
        code: "invalid",
        message: "The configuration has 1 invalid field.",
        issues: [{ path: "/data/sections/2/settings/url", message: "Use a full link starting with https:// or http://" }],
      },
    });
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["a missing baseRevision", { document: buildFixtureDocument() }],
    ["an unknown field", { baseRevision: null, document: buildFixtureDocument(), id: "someone-else" }],
    ["a non-object body", "save please"],
  ])("rejects a request with %s as malformed", async (_label, body) => {
    const { client, requests } = setup();

    const result = await saveHomeScreen(client, body);

    expect(result).toMatchObject({ ok: false, status: 400, error: { code: "bad_request" } });
    expect(requests).toHaveLength(0);
  });

  it("reports an outage as retryable without claiming success", async () => {
    const { client } = setup({ fetch: () => Promise.reject(new TypeError("fetch failed")) });

    const result = await saveHomeScreen(client, { baseRevision: 3, document: buildFixtureDocument() });

    expect(result).toMatchObject({ ok: false, status: 503, error: { code: "unavailable" } });
  });
});
