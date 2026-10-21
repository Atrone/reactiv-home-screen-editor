import {
  CURRENT_SCHEMA_VERSION,
  parseConfigurationDocument,
  type ConfigurationDocument,
  type HomeScreen,
  type ValidationIssue,
} from "../../contract/home-screen";
import { LIMITS } from "../../contract/limits";

export type ImportResult = { ok: true; document: ConfigurationDocument } | { ok: false; message: string; details: string[] };

/** How many field problems to list before summarizing the rest. */
const MAX_LISTED_ISSUES = 5;

/**
 * Serializes the draft as a portable file: schema version plus payload only. Server-owned
 * fields (id, revision, updatedAt) are left out on purpose, so importing a file can never
 * choose which configuration gets saved or fake a revision.
 *
 * @param draft - Current draft (including unsaved edits).
 * @returns Pretty-printed JSON.
 */
export function serializeForExport(draft: HomeScreen): string {
  // Two-space indentation keeps exported files readable and diffable.
  const document: ConfigurationDocument = { schemaVersion: CURRENT_SCHEMA_VERSION, data: draft };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Names the export file after the local date, e.g. `home-screen-2026-10-21.json`.
 *
 * @param date - When the export happens.
 * @returns The file name.
 */
export function exportFileName(date: Date): string {
  // Local date, because that is what the user expects to see in their downloads folder.
  const pad = (value: number) => String(value).padStart(2, "0");
  return `home-screen-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/**
 * Reads and validates a user-selected file. Nothing is applied here; the caller replaces the
 * draft only when this returns `ok`, so a bad file can never leave the editor half-updated.
 *
 * @param file - The selected file.
 * @returns The validated document, or a message and per-field details.
 */
export async function readImportFile(file: Blob): Promise<ImportResult> {
  // Check size before reading, so a huge file is never pulled into memory.
  if (file.size === 0) {
    return failure("The file is empty.");
  }
  if (file.size > LIMITS.maxDocumentBytes) {
    return failure(`The file is larger than the ${LIMITS.maxDocumentBytes / 1024 / 1024} MB limit.`);
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    // E.g. the file was moved or deleted after it was picked.
    return failure("The file could not be read. Try choosing it again.");
  }
  return parseImportText(text);
}

/**
 * Parses file contents into a document. Accepts both this editor's export format and a full
 * configuration record as returned by the API; extra top-level fields like `id` are ignored.
 *
 * @param text - File contents.
 * @returns The validated document, or a message and per-field details.
 */
export function parseImportText(text: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return failure("This file is not valid JSON.");
  }

  // Keep only the portable part; `data` itself is still validated strictly.
  const candidate =
    typeof json === "object" && json !== null && !Array.isArray(json)
      ? { schemaVersion: (json as Record<string, unknown>).schemaVersion, data: (json as Record<string, unknown>).data }
      : json;

  const parsed = parseConfigurationDocument(candidate);
  if (parsed.success) {
    return { ok: true, document: parsed.document };
  }
  if (parsed.reason === "unsupported_version") {
    return failure(parsed.message);
  }

  // List the first few problems in plain language; the rest are summarized.
  const details = parsed.issues.slice(0, MAX_LISTED_ISSUES).map(describeIssue);
  const hidden = parsed.issues.length - details.length;
  if (hidden > 0) {
    details.push(`…and ${hidden} more.`);
  }
  return failure(`This file is not a valid home screen configuration. ${parsed.message}`, details);
}

/**
 * Describes an issue with a 1-based, human-readable location, e.g.
 * `Section 3 › image 2 › url: Use a full image URL starting with https://`.
 *
 * @param issue - A validation issue from the shared parser.
 * @returns One line of text.
 */
export function describeIssue(issue: ValidationIssue): string {
  const parts: string[] = [];
  const path = issue.path[0] === "data" ? issue.path.slice(1) : issue.path;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const next = path[index + 1];
    // "sections, 2" reads better as "Section 3"; same for images.
    if ((segment === "sections" || segment === "images") && typeof next === "number") {
      parts.push(`${segment === "sections" ? "Section" : "image"} ${next + 1}`);
      index += 1;
    } else if (segment !== "settings") {
      parts.push(String(segment));
    }
  }
  return parts.length > 0 ? `${parts.join(" › ")}: ${issue.message}` : issue.message;
}

/**
 * Builds a failed import result.
 *
 * @param message - Summary shown to the user.
 * @param details - Optional per-field lines.
 * @returns The failure.
 */
function failure(message: string, details: string[] = []): ImportResult {
  // Single construction point keeps the failure shape consistent.
  return { ok: false, message, details };
}
