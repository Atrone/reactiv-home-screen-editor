import { describe, expect, it } from "vitest";
import { buildFixtureDocument } from "../test/fixtures";
import { parseConfigurationDocument, toJsonPointer, type ConfigurationDocument, type SectionOfType } from "./home-screen";
import { LIMITS } from "./limits";
import { isAllowedUrl, isHexColor } from "./rules";

/**
 * Parses a document and returns the issue messages keyed by JSON Pointer, for compact assertions.
 *
 * @param document - Candidate document.
 * @returns Map of pointer -> message (empty when valid).
 */
function issuesOf(document: unknown): Record<string, string> {
  const result = parseConfigurationDocument(document);
  // Valid documents produce no issues at all.
  if (result.success) {
    return {};
  }
  return Object.fromEntries(result.issues.map((issue) => [toJsonPointer(issue.path), issue.message]));
}

describe("hex colors", () => {
  it.each(["#123", "#12ABEF", "#abc", "#ABCDEF"])("accepts %s", (value) => {
    expect(isHexColor(value)).toBe(true);
  });

  it.each(["#12", "#GGGGGG", "red", "#1234", "#12345678", "12ABEF", " #123", "xx#123456"])("rejects %s", (value) => {
    expect(isHexColor(value)).toBe(false);
  });
});

describe("URLs", () => {
  it("accepts absolute https image URLs and http(s) links", () => {
    expect(isAllowedUrl("https://images.example.com/a.jpg?w=800", ["https:"])).toBe(true);
    expect(isAllowedUrl("http://shop.example.com/sale", ["https:", "http:"])).toBe(true);
    expect(isAllowedUrl("HTTPS://EXAMPLE.COM/A", ["https:"])).toBe(true);
  });

  it.each([
    ["script scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["file scheme", "file:///etc/passwd"],
    ["relative path", "/images/a.jpg"],
    ["scheme without slashes (resolves relative to the page)", "https:example.com"],
    ["embedded credentials", "https://user:secret@example.com/"],
    ["surrounding whitespace", " https://example.com/a.jpg"],
    ["inner whitespace", "https://exa mple.com/"],
    ["empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(isAllowedUrl(value, ["https:", "http:"])).toBe(false);
  });

  it("only allows https for images", () => {
    expect(isAllowedUrl("http://images.example.com/a.jpg", ["https:"])).toBe(false);
  });
});

describe("parseConfigurationDocument", () => {
  it("accepts a document with repeated section types and keeps order, Unicode and line breaks", () => {
    const result = parseConfigurationDocument(buildFixtureDocument());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.data.sections.map((section) => section.id)).toEqual([
      "hero",
      "intro",
      "shop-cta",
      "lookbook",
      "story",
      "newsletter-cta",
    ]);
    expect(result.document).toEqual(buildFixtureDocument());
  });

  it("rejects a newer schema version with a clear message instead of field errors", () => {
    const result = parseConfigurationDocument({ ...buildFixtureDocument(), schemaVersion: 2 });

    expect(result).toMatchObject({ success: false, reason: "unsupported_version" });
    expect(result.success === false && result.message).toContain("version 2");
  });

  it.each([
    ["missing schemaVersion", { data: { sections: [] } }],
    ["non-object input", "hello"],
    ["array input", []],
    ["null", null],
  ])("rejects %s", (_label, input) => {
    expect(parseConfigurationDocument(input)).toMatchObject({ success: false, reason: "invalid" });
  });

  it("reports invalid fields by path", () => {
    const document = buildFixtureDocument();
    const [hero, intro, cta] = document.data.sections as [SectionOfType<"carousel">, SectionOfType<"text">, SectionOfType<"cta">];
    hero.settings.images[0]!.url = "javascript:alert(1)";
    intro.settings.titleColor = "#12";
    cta.settings.label = "   ";

    expect(issuesOf(document)).toEqual({
      "/data/sections/0/settings/images/0/url": "Use a full image URL starting with https://",
      "/data/sections/1/settings/titleColor": "Use a hex color like #1a2b3c or #abc",
      "/data/sections/2/settings/label": "A button needs a label",
    });
  });

  it("rejects unknown section types and unknown keys rather than silently dropping them", () => {
    const document = buildFixtureDocument() as unknown as { data: { sections: Record<string, unknown>[] } };
    document.data.sections[0] = { id: "quiz-1", type: "quiz", settings: {} };
    (document.data.sections[1]!.settings as Record<string, unknown>).fontSize = 18;

    expect(issuesOf(document)).toEqual({
      "/data/sections/0/type": "Unknown section type (expected carousel, text or cta)",
      "/data/sections/1/settings": 'Unrecognized key: "fontSize"',
    });
  });

  it("rejects duplicate section ids", () => {
    const document = buildFixtureDocument();
    document.data.sections[3]!.id = "hero";

    expect(issuesOf(document)).toEqual({ "/data/sections/3/id": 'Duplicate section id "hero"' });
  });

  it("enforces section, image and text limits", () => {
    const tooManySections: ConfigurationDocument = {
      schemaVersion: 1,
      data: {
        sections: Array.from({ length: LIMITS.maxSections + 1 }, (_, index) => ({
          id: `t${index}`,
          type: "text" as const,
          settings: { title: "", description: "", titleColor: "#000", descriptionColor: "#000" },
        })),
      },
    };
    expect(issuesOf(tooManySections)["/data/sections"]).toMatch(/at most 30 sections/);

    const document = buildFixtureDocument();
    const [hero, intro] = document.data.sections as [SectionOfType<"carousel">, SectionOfType<"text">];
    hero.settings.images = Array.from({ length: LIMITS.maxImagesPerCarousel + 1 }, (_, index) => ({
      id: `img-${index}`,
      url: `https://images.example.com/${index}.jpg`,
      alt: "",
    }));
    intro.settings.title = "x".repeat(LIMITS.maxTitleLength + 1);

    const issues = issuesOf(document);
    expect(issues["/data/sections/0/settings/images"]).toMatch(/at most 12 images/);
    expect(issues["/data/sections/1/settings/title"]).toMatch(/at most 120 characters/);
  });

  it("accepts an empty home screen and an empty carousel", () => {
    const document = buildFixtureDocument();
    const hero = document.data.sections[0] as SectionOfType<"carousel">;
    hero.settings.images = [];

    expect(parseConfigurationDocument(document).success).toBe(true);
    expect(parseConfigurationDocument({ schemaVersion: 1, data: { sections: [] } }).success).toBe(true);
  });
});

describe("toJsonPointer", () => {
  it("escapes ~ and / per RFC 6901", () => {
    expect(toJsonPointer(["data", "a/b", "c~d", 0])).toBe("/data/a~1b/c~0d/0");
    expect(toJsonPointer([])).toBe("");
  });
});
