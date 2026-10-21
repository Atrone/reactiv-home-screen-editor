import { describe, expect, it } from "vitest";
import { readJsonBody } from "./request-body.server";

/**
 * Builds a POST request with the given body and headers.
 *
 * @param body - Request body (string or stream).
 * @param headers - Headers to send.
 * @returns The request.
 */
function post(body: BodyInit, headers: Record<string, string> = { "Content-Type": "application/json" }): Request {
  // `duplex` is required by Node whenever the body is a stream.
  return new Request("http://app.local/", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("readJsonBody", () => {
  it("parses a JSON body within the limit, including multi-byte characters", async () => {
    const result = await readJsonBody(post(JSON.stringify({ title: "Café 🍂" })), 1024);
    expect(result).toEqual({ ok: true, value: { title: "Café 🍂" } });
  });

  it("refuses non-JSON content types, so a cross-site text/plain form cannot post", async () => {
    const result = await readJsonBody(post('{"baseRevision":null}', { "Content-Type": "text/plain" }), 1024);
    expect(result).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects malformed and empty JSON with 400", async () => {
    expect(await readJsonBody(post("{oops"), 1024)).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonBody(post(""), 1024)).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an oversized body even when no Content-Length is declared", async () => {
    // A stream body has no Content-Length, so only the byte counter can catch it.
    const chunk = new TextEncoder().encode("x".repeat(600));
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Endless body: the reader must stop on its own once the limit is crossed.
        pulls += 1;
        controller.enqueue(chunk);
      },
    });

    const result = await readJsonBody(post(stream), 1024);

    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(pulls).toBeLessThan(10);
  });

  it("rejects a declared Content-Length over the limit without reading the body", async () => {
    const request = post("{}", { "Content-Type": "application/json", "Content-Length": "999999" });
    expect(await readJsonBody(request, 1024)).toMatchObject({ ok: false, status: 413 });
  });
});
