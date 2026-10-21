import { describe, expect, it } from "vitest";
import type { SectionOfType } from "../../contract/home-screen";
import { LIMITS } from "../../contract/limits";
import { buildFixtureDocument } from "../../test/fixtures";
import { exportFileName, parseImportText, readImportFile, serializeForExport } from "./import-export";

/**
 * Wraps text in a File, as the file picker would provide it.
 *
 * @param text - File contents.
 * @returns A File.
 */
function fileOf(text: string): File {
  // The name is irrelevant to parsing; it only mirrors a real upload.
  return new File([text], "home-screen.json", { type: "application/json" });
}

describe("export", () => {
  it("writes only the portable document, and reads back to the same payload", async () => {
    const { data } = buildFixtureDocument();

    const text = serializeForExport(data);

    expect(Object.keys(JSON.parse(text))).toEqual(["schemaVersion", "data"]);
    expect(await readImportFile(fileOf(text))).toEqual({ ok: true, document: { schemaVersion: 1, data } });
  });

  it("names the file after the local date", () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe("home-screen-2026-01-05.json");
  });
});

describe("import", () => {
  it("accepts a full API record and ignores its server-owned fields", () => {
    const record = { id: "someone-elses-config", revision: 42, updatedAt: "2026-01-01T00:00:00.000Z", ...buildFixtureDocument() };
    expect(parseImportText(JSON.stringify(record))).toEqual({ ok: true, document: buildFixtureDocument() });
  });

  it.each([
    ["an empty file", "", "The file is empty."],
    ["malformed JSON", "{ not json", "This file is not valid JSON."],
    ["a JSON value that is not a configuration", "[1, 2, 3]", "This file is not a valid home screen configuration."],
  ])("rejects %s with a readable message", async (_label, text, message) => {
    const result = await readImportFile(fileOf(text));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(message);
  });

  it("rejects a file over the size limit without reading it", async () => {
    const huge = fileOf("x".repeat(LIMITS.maxDocumentBytes + 1));
    expect(await readImportFile(huge)).toMatchObject({ ok: false, message: expect.stringContaining("larger than") });
  });

  it("rejects a newer schema version with a single clear message", () => {
    const result = parseImportText(JSON.stringify({ ...buildFixtureDocument(), schemaVersion: 7 }));
    expect(result).toEqual({
      ok: false,
      message: "This configuration uses schema version 7; this editor supports up to version 1.",
      details: [],
    });
  });

  it("lists invalid fields with 1-based, readable locations", () => {
    const document = buildFixtureDocument();
    (document.data.sections[0] as SectionOfType<"carousel">).settings.images[1]!.url = "data:image/png;base64,AAAA";
    (document.data.sections[2] as SectionOfType<"cta">).settings.buttonColor = "blue";
    (document.data.sections[3] as unknown as { type: string }).type = "quiz";

    const result = parseImportText(JSON.stringify(document));

    expect(result).toEqual({
      ok: false,
      message: "This file is not a valid home screen configuration. The configuration has 3 invalid fields.",
      details: [
        "Section 1 › image 2 › url: Use a full image URL starting with https://",
        "Section 3 › buttonColor: Use a hex color like #1a2b3c or #abc",
        "Section 4 › type: Unknown section type (expected carousel, text or cta)",
      ],
    });
  });

  it("summarizes long issue lists instead of dumping every line", () => {
    const document = buildFixtureDocument();
    for (const section of document.data.sections) {
      // Break one field in each of the six sections.
      if (section.type === "text") section.settings.titleColor = "nope";
      if (section.type === "cta") section.settings.labelColor = "nope";
      if (section.type === "carousel") section.settings.aspectRatio = "wide" as never;
    }

    const result = parseImportText(JSON.stringify(document));

    expect(!result.ok && result.details).toHaveLength(6);
    expect(!result.ok && result.details.at(-1)).toBe("…and 1 more.");
  });
});
