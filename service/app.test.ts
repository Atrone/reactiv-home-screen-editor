import { describe, expect, it, vi } from "vitest";
import type { Configuration } from "../contract/api";
import type { SectionOfType } from "../contract/home-screen";
import { LIMITS } from "../contract/limits";
import { buildFixtureDocument } from "../test/fixtures";
import { createConfigurationService, type ServiceOptions } from "./app";
import { createSqliteRepository, openDatabase, type ConfigurationRepository } from "./repository";

const API_KEY = "test-key-0123456789abcdefghijklmnopqrstuvwxyz";

type CallOptions = { body?: unknown; headers?: Record<string, string>; apiKey?: string | null };

/**
 * Creates a service backed by in-memory SQLite, with a deterministic clock and id generator.
 *
 * @param overrides - Replace any service option (e.g. a failing repository).
 * @returns The app, its repository, a request helper and the error logger spy.
 */
function setup(overrides: Partial<ServiceOptions> = {}) {
  const repository = createSqliteRepository(openDatabase(":memory:"));
  // Each call to now() advances one second so updatedAt changes are observable.
  let seconds = 0;
  let ids = 0;
  const logError = vi.fn();
  const app = createConfigurationService({
    repository,
    apiKey: API_KEY,
    now: () => new Date(Date.UTC(2026, 9, 21, 12, 0, seconds++)),
    generateId: () => `generated-${++ids}`,
    logError,
    ...overrides,
  });

  /**
   * Sends one request to the in-process app.
   *
   * @param method - HTTP method.
   * @param path - Request path.
   * @param options - Body (objects are JSON-encoded), extra headers, and the key to send (null for none).
   * @returns The response.
   */
  const call = (method: string, path: string, options: CallOptions = {}) => {
    const { body, headers = {}, apiKey = API_KEY } = options;
    // Build headers the way the real app server does, unless a test overrides them.
    const finalHeaders: Record<string, string> = { ...(apiKey === null ? {} : { Authorization: `Bearer ${apiKey}` }) };
    if (body !== undefined) {
      finalHeaders["Content-Type"] = "application/json";
    }
    return app.request(path, {
      method,
      headers: { ...finalHeaders, ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  };

  return { app, repository, call, logError };
}

/**
 * Creates the fixture configuration with a known id and returns it.
 *
 * @param call - Request helper from {@link setup}.
 * @param id - Id to propose.
 * @returns The created configuration.
 */
async function createFixture(call: ReturnType<typeof setup>["call"], id = "home"): Promise<Configuration> {
  const response = await call("POST", "/v1/configurations", { body: { id, ...buildFixtureDocument() } });
  // Fail loudly here rather than in a confusing later assertion.
  expect(response.status).toBe(201);
  return (await response.json()) as Configuration;
}

describe("authentication", () => {
  it.each([
    ["GET", "/v1/configurations/home", undefined],
    ["POST", "/v1/configurations", { id: "home", ...buildFixtureDocument() }],
    ["PUT", "/v1/configurations/home", buildFixtureDocument()],
  ])("rejects %s without a key or with the wrong key, before touching storage", async (method, path, body) => {
    const { call, repository } = setup();
    const spies = [vi.spyOn(repository, "get"), vi.spyOn(repository, "create"), vi.spyOn(repository, "update")];

    const missing = await call(method, path, { body, apiKey: null, headers: { "If-Match": '"1"' } });
    const wrong = await call(method, path, { body, apiKey: "not-the-key-0123456789abcdefghijklmnop", headers: { "If-Match": '"1"' } });

    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
    expect(missing.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("keeps the health probe public and data-free", async () => {
    const { call } = setup();
    const response = await call("GET", "/health", { apiKey: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("create", () => {
  it("stores the document at revision 1 and returns it with Location and ETag", async () => {
    const { call } = setup();

    const response = await call("POST", "/v1/configurations", { body: { id: "home", ...buildFixtureDocument() } });

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe("/v1/configurations/home");
    expect(response.headers.get("ETag")).toBe('"1"');
    expect(await response.json()).toEqual({
      id: "home",
      schemaVersion: 1,
      revision: 1,
      updatedAt: "2026-10-21T12:00:00.000Z",
      data: buildFixtureDocument().data,
    });
  });

  it("generates distinct ids when none is proposed, and both records stay retrievable", async () => {
    const { call } = setup();

    const first = (await (await call("POST", "/v1/configurations", { body: buildFixtureDocument() })).json()) as Configuration;
    const second = (await (await call("POST", "/v1/configurations", { body: { schemaVersion: 1, data: { sections: [] } } })).json()) as Configuration;

    expect([first.id, second.id]).toEqual(["generated-1", "generated-2"]);
    expect((await (await call("GET", "/v1/configurations/generated-1")).json()) as Configuration).toMatchObject({ data: buildFixtureDocument().data });
    expect((await (await call("GET", "/v1/configurations/generated-2")).json()) as Configuration).toMatchObject({ data: { sections: [] } });
  });

  it("refuses to overwrite an existing id (409) and leaves the original intact", async () => {
    const { call } = setup();
    await createFixture(call);

    const response = await call("POST", "/v1/configurations", { body: { id: "home", schemaVersion: 1, data: { sections: [] } } });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "ALREADY_EXISTS" } });
    const stored = (await (await call("GET", "/v1/configurations/home")).json()) as Configuration;
    expect(stored.data).toEqual(buildFixtureDocument().data);
  });

  it("rejects an invalid proposed id with a field issue", async () => {
    const { call } = setup();
    const response = await call("POST", "/v1/configurations", { body: { id: "Not Valid!", ...buildFixtureDocument() } });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", issues: [{ path: "/id" }] } });
  });
});

describe("load", () => {
  it("returns a stored configuration by id with its ETag", async () => {
    const { call } = setup();
    const created = await createFixture(call);

    const response = await call("GET", "/v1/configurations/home");

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"1"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(created);
  });

  it.each(["missing", "NOT-A-VALID-ID"])("returns 404 for %s", async (id) => {
    const { call } = setup();
    const response = await call("GET", `/v1/configurations/${id}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("update", () => {
  /**
   * Builds a changed copy of the fixture: the first text section gets a new title.
   *
   * @param title - New title.
   * @returns The document.
   */
  const changedDocument = (title: string) => {
    const document = buildFixtureDocument();
    // Section 1 is the "intro" text section in the fixture.
    (document.data.sections[1] as SectionOfType<"text">).settings.title = title;
    return document;
  };

  it("replaces the payload, bumps the revision and updatedAt when If-Match is current", async () => {
    const { call } = setup();
    const created = await createFixture(call);

    const response = await call("PUT", "/v1/configurations/home", { body: changedDocument("Winter"), headers: { "If-Match": '"1"' } });

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"2"');
    const updated = (await response.json()) as Configuration;
    expect(updated.revision).toBe(2);
    expect(updated.updatedAt > created.updatedAt).toBe(true);
    expect((updated.data.sections[1] as SectionOfType<"text">).settings.title).toBe("Winter");
  });

  it("requires If-Match (428) and rejects malformed values (400)", async () => {
    const { call } = setup();
    await createFixture(call);

    const missing = await call("PUT", "/v1/configurations/home", { body: changedDocument("x") });
    const weak = await call("PUT", "/v1/configurations/home", { body: changedDocument("x"), headers: { "If-Match": 'W/"1"' } });

    expect(missing.status).toBe(428);
    expect(await missing.json()).toMatchObject({ error: { code: "PRECONDITION_REQUIRED" } });
    expect(weak.status).toBe(400);
  });

  it("rejects a stale revision with 412 and keeps the newer data", async () => {
    const { call } = setup();
    await createFixture(call);
    await call("PUT", "/v1/configurations/home", { body: changedDocument("Saved by tab A"), headers: { "If-Match": '"1"' } });

    const stale = await call("PUT", "/v1/configurations/home", { body: changedDocument("Saved by tab B"), headers: { "If-Match": '"1"' } });

    expect(stale.status).toBe(412);
    expect(await stale.json()).toMatchObject({ error: { code: "REVISION_MISMATCH" } });
    const stored = (await (await call("GET", "/v1/configurations/home")).json()) as Configuration;
    expect(stored.revision).toBe(2);
    expect((stored.data.sections[1] as SectionOfType<"text">).settings.title).toBe("Saved by tab A");
  });

  it("lets exactly one of two concurrent saves from the same revision win", async () => {
    const { call } = setup();
    await createFixture(call);

    const results = await Promise.all([
      call("PUT", "/v1/configurations/home", { body: changedDocument("A"), headers: { "If-Match": '"1"' } }),
      call("PUT", "/v1/configurations/home", { body: changedDocument("B"), headers: { "If-Match": '"1"' } }),
    ]);

    expect(results.map((response) => response.status).sort()).toEqual([200, 412]);
  });

  it("returns 404 for an unknown id instead of creating it", async () => {
    const { call } = setup();
    const response = await call("PUT", "/v1/configurations/nope", { body: buildFixtureDocument(), headers: { "If-Match": '"1"' } });
    expect(response.status).toBe(404);
    expect((await call("GET", "/v1/configurations/nope")).status).toBe(404);
  });

  it("rejects invalid data with field issues (422) and leaves the stored record unchanged", async () => {
    const { call } = setup();
    const created = await createFixture(call);
    const document = buildFixtureDocument();
    (document.data.sections[2] as SectionOfType<"cta">).settings.url = "javascript:alert(1)";
    (document.data.sections[1] as SectionOfType<"text">).settings.titleColor = "#GGGGGG";

    const response = await call("PUT", "/v1/configurations/home", { body: document, headers: { "If-Match": '"1"' } });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "The configuration has 2 invalid fields.",
        issues: [
          { path: "/data/sections/1/settings/titleColor", message: "Use a hex color like #1a2b3c or #abc" },
          { path: "/data/sections/2/settings/url", message: "Use a full link starting with https:// or http://" },
        ],
      },
    });
    expect(await (await call("GET", "/v1/configurations/home")).json()).toEqual(created);
  });

  it("rejects a newer schema version with its own error code", async () => {
    const { call } = setup();
    await createFixture(call);
    const response = await call("PUT", "/v1/configurations/home", { body: { ...buildFixtureDocument(), schemaVersion: 2 }, headers: { "If-Match": '"1"' } });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "UNSUPPORTED_SCHEMA_VERSION" } });
  });
});

describe("request hygiene", () => {
  it("answers malformed JSON with 400, a non-JSON content type with 415 and a non-object body with 422", async () => {
    const { call } = setup();

    const malformed = await call("POST", "/v1/configurations", { body: "{not json" });
    const wrongType = await call("POST", "/v1/configurations", { body: "x", headers: { "Content-Type": "text/plain" } });
    const array = await call("POST", "/v1/configurations", { body: [] });

    expect([malformed.status, wrongType.status, array.status]).toEqual([400, 415, 422]);
    expect(await malformed.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect(await wrongType.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
  });

  it("rejects bodies over the size limit with 413", async () => {
    const { call } = setup();
    const response = await call("POST", "/v1/configurations", { body: JSON.stringify({ padding: "x".repeat(LIMITS.maxDocumentBytes) }) });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("uses the error envelope for unknown routes", async () => {
    const { call } = setup();
    const response = await call("DELETE", "/v1/configurations/home");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("hides internal error details from the caller but logs them", async () => {
    const failing: ConfigurationRepository = {
      get: async () => {
        throw new Error("disk I/O error at /var/data/configurations.sqlite");
      },
      create: async () => null,
      update: async () => ({ status: "not_found" }),
    };
    const { call, logError } = setup({ repository: failing });

    const response = await call("GET", "/v1/configurations/home");

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "INTERNAL_ERROR", message: "Unexpected error" } });
    expect(text).not.toContain("sqlite");
    expect(logError).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error: expect.stringContaining("disk I/O") }));
  });
});
