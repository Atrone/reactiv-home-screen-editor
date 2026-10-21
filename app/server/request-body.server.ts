export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; message: string };

/**
 * Reads a JSON request body without ever buffering more than `maxBytes`. This guards the
 * public save action, which is the endpoint browsers (and anyone else) can reach; the
 * private service has its own limit, but only after this server has already read the body.
 *
 * Requiring `Content-Type: application/json` also means a cross-site HTML form cannot post
 * here: forms can only send urlencoded, multipart or text/plain bodies without a CORS preflight.
 *
 * @param request - Incoming request.
 * @param maxBytes - Largest body accepted, in bytes.
 * @returns The parsed JSON value, or an HTTP status and message describing the problem.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  // React Router's JSON submissions always carry this header; anything else is not our client.
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return { ok: false, status: 415, message: "Saves must be sent as application/json." };
  }

  // Cheap early exit when the client declares an oversized body up front.
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > maxBytes) {
    return tooLarge(maxBytes);
  }

  // Content-Length can be absent (chunked) or wrong, so count bytes as they arrive.
  const text = await readTextUpTo(request, maxBytes);
  if (text === null) {
    return tooLarge(maxBytes);
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    // Covers empty bodies too: JSON.parse("") throws.
    return { ok: false, status: 400, message: "The save request was not valid JSON." };
  }
}

/**
 * Streams the body into a string, stopping as soon as it exceeds the limit.
 *
 * @param request - Incoming request.
 * @param maxBytes - Largest body accepted, in bytes.
 * @returns The body text, or null when it was too large.
 */
async function readTextUpTo(request: Request, maxBytes: number): Promise<string | null> {
  // A request without a body stream (e.g. no body at all) is simply empty.
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      // Stop the upload instead of draining the rest of an oversized body.
      await reader.cancel();
      return null;
    }
    // `stream: true` keeps multi-byte characters split across chunks intact.
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Builds the 413 result.
 *
 * @param maxBytes - The limit that was exceeded.
 * @returns A failed {@link JsonBodyResult}.
 */
function tooLarge(maxBytes: number): JsonBodyResult {
  // Round to whole kilobytes so the message stays readable.
  return { ok: false, status: 413, message: `Save requests are limited to ${Math.round(maxBytes / 1024)} KB.` };
}
