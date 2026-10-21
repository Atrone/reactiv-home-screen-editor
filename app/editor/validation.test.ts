import { describe, expect, it } from "vitest";
import type { HomeScreen, SectionOfType } from "../../contract/home-screen";
import { LIMITS } from "../../contract/limits";
import { buildFixtureDocument } from "../../test/fixtures";
import { editorReducer, createInitialState } from "./state";
import { errorsForSection, validateDraft } from "./validation";

/**
 * Returns a mutable copy of the fixture's payload.
 *
 * @returns The fixture home screen.
 */
function fixtureScreen(): HomeScreen {
  // Fresh copy per test so mutations never leak between tests.
  return buildFixtureDocument().data;
}

describe("validateDraft", () => {
  it("reports nothing for a valid draft", () => {
    expect(validateDraft(fixtureScreen())).toEqual({ isValid: true, issueCount: 0, sectionErrors: {}, screenErrors: [] });
  });

  it("keys errors by section id and field, so they follow a section when it moves", () => {
    const screen = fixtureScreen();
    (screen.sections[4] as SectionOfType<"text">).settings.titleColor = "#12";
    (screen.sections[5] as SectionOfType<"cta">).settings.url = "javascript:alert(1)";

    const before = validateDraft(screen);
    const moved = editorReducer(createInitialState({ draft: screen, saved: null }), { type: "sectionMoved", sectionId: "story", toIndex: 0 });
    const after = validateDraft(moved.draft);

    expect(before.sectionErrors).toEqual({
      story: { titleColor: "Use a hex color like #1a2b3c or #abc" },
      "newsletter-cta": { url: "Use a full link starting with https:// or http://" },
    });
    expect(after.sectionErrors).toEqual(before.sectionErrors);
    expect(before.issueCount).toBe(2);
  });

  it("keys image errors by image id rather than position", () => {
    const screen = fixtureScreen();
    (screen.sections[0] as SectionOfType<"carousel">).settings.images[1]!.url = "http://insecure.example.com/a.jpg";

    expect(errorsForSection(validateDraft(screen), "hero")).toEqual({ "images.hero-2.url": "Use a full image URL starting with https://" });
  });

  it("reports screen-wide limits separately from field errors", () => {
    const screen: HomeScreen = {
      sections: Array.from({ length: LIMITS.maxSections + 1 }, (_, index) => ({
        id: `text-${index}`,
        type: "text" as const,
        settings: { title: "", description: "", titleColor: "#000", descriptionColor: "#000" },
      })),
    };

    const validation = validateDraft(screen);

    expect(validation.isValid).toBe(false);
    expect(validation.screenErrors).toEqual([`A home screen can hold at most ${LIMITS.maxSections} sections`]);
    expect(validation.sectionErrors).toEqual({});
  });

  it("returns a shared empty object for a section without errors", () => {
    const validation = validateDraft(fixtureScreen());
    expect(errorsForSection(validation, "hero")).toBe(errorsForSection(validation, "intro"));
  });
});
