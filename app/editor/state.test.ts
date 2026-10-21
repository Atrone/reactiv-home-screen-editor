import { describe, expect, it } from "vitest";
import type { Configuration } from "../../contract/api";
import type { HomeScreen, SectionOfType } from "../../contract/home-screen";
import { buildFixtureDocument } from "../../test/fixtures";
import { createInitialState, editorReducer, hasUnsavedChanges, isSameJson, type EditorAction, type EditorState } from "./state";

/**
 * Editor state that starts from the shared fixture, saved at revision 1.
 *
 * @returns A state whose draft and saved snapshot are the fixture.
 */
function savedFixtureState(): EditorState {
  // Same object for draft and saved data, exactly like right after a load.
  const data = buildFixtureDocument().data;
  return createInitialState({ draft: data, saved: { revision: 1, updatedAt: "2026-10-21T12:00:00.000Z", data } });
}

/**
 * Applies actions in order.
 *
 * @param state - Starting state.
 * @param actions - Actions to apply.
 * @returns The final state.
 */
function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  // Mirrors what React does with a sequence of dispatches.
  return actions.reduce(editorReducer, state);
}

/**
 * Builds the configuration the service would return for a save of `data`.
 *
 * @param data - The saved payload.
 * @param revision - The new revision.
 * @returns A configuration resource.
 */
function configurationOf(data: HomeScreen, revision: number): Configuration {
  // structuredClone: the response is a fresh object, as it would be after JSON parsing.
  return { id: "home", schemaVersion: 1, revision, updatedAt: `2026-10-21T12:0${revision}:00.000Z`, data: structuredClone(data) };
}

/**
 * Finds a text section's title in a draft.
 *
 * @param state - Editor state.
 * @param id - Section id.
 * @returns The title.
 */
function titleOf(state: EditorState, id: string): string {
  // Fails loudly if the id is missing or not a text section.
  const section = state.draft.sections.find((candidate) => candidate.id === id) as SectionOfType<"text">;
  return section.settings.title;
}

describe("sections", () => {
  it("moves a section past another of the same type without mixing up ids or settings", () => {
    const before = savedFixtureState();

    const after = run(before, { type: "sectionMoved", sectionId: "story", toIndex: 1 });

    expect(after.draft.sections.map((section) => section.id)).toEqual(["hero", "story", "intro", "shop-cta", "lookbook", "newsletter-cta"]);
    // The moved objects are the same objects, so their settings cannot have been swapped.
    expect(after.draft.sections[1]).toBe(before.draft.sections[4]);
    expect(after.draft.sections[2]).toBe(before.draft.sections[1]);
  });

  it("clamps moves past either end and returns the same state for a no-op", () => {
    const before = savedFixtureState();

    expect(run(before, { type: "sectionMoved", sectionId: "hero", toIndex: -5 })).toBe(before);
    expect(run(before, { type: "sectionMoved", sectionId: "missing", toIndex: 2 })).toBe(before);
    expect(run(before, { type: "sectionMoved", sectionId: "hero", toIndex: 99 }).draft.sections.at(-1)!.id).toBe("hero");
  });

  it("patches only the targeted section and keeps every other section object identical", () => {
    const before = savedFixtureState();

    const after = run(before, { type: "settingsChanged", sectionId: "story", sectionType: "text", patch: { titleColor: "#ff0000" } });

    expect((after.draft.sections[4] as SectionOfType<"text">).settings).toEqual({
      title: "Our story",
      description: "Made in Montréal.",
      titleColor: "#ff0000",
      descriptionColor: "#123456",
    });
    // Untouched sections keep their identity, which is what lets their previews skip re-rendering.
    after.draft.sections.forEach((section, index) => index !== 4 && expect(section).toBe(before.draft.sections[index]));
  });

  it("ignores a patch whose section type does not match the target", () => {
    const before = savedFixtureState();
    expect(run(before, { type: "settingsChanged", sectionId: "hero", sectionType: "text", patch: { title: "nope" } })).toBe(before);
  });

  it("adds sections at the end and removes them by id", () => {
    const added = run(savedFixtureState(), {
      type: "sectionAdded",
      section: { id: "extra", type: "cta", settings: { label: "Go", url: "https://example.com", buttonColor: "#000", labelColor: "#fff" } },
    });
    expect(added.draft.sections.at(-1)!.id).toBe("extra");

    const removed = run(added, { type: "sectionRemoved", sectionId: "intro" });
    expect(removed.draft.sections.map((section) => section.id)).toEqual(["hero", "shop-cta", "lookbook", "story", "newsletter-cta", "extra"]);
  });
});

describe("carousel images", () => {
  it("adds, edits and removes images in the targeted carousel only", () => {
    const before = savedFixtureState();

    const after = run(
      before,
      { type: "imageAdded", sectionId: "lookbook", image: { id: "look-2", url: "https://images.example.com/look-2.jpg", alt: "" } },
      { type: "imageChanged", sectionId: "lookbook", imageId: "look-1", patch: { url: "https://images.example.com/look-1b.jpg" } },
      { type: "imageRemoved", sectionId: "lookbook", imageId: "look-2" },
      { type: "imageRemoved", sectionId: "lookbook", imageId: "look-1" },
    );

    expect((after.draft.sections[3] as SectionOfType<"carousel">).settings.images).toEqual([]);
    // The other carousel is the very same object.
    expect(after.draft.sections[0]).toBe(before.draft.sections[0]);
  });

  it("ignores image actions aimed at a section that is not a carousel", () => {
    const before = savedFixtureState();
    expect(run(before, { type: "imageRemoved", sectionId: "intro", imageId: "x" })).toBe(before);
  });
});

describe("saving", () => {
  it("adopts the server's copy when nothing changed during the save", () => {
    const edited = run(savedFixtureState(), { type: "settingsChanged", sectionId: "intro", sectionType: "text", patch: { title: "A" } });
    const saving = run(edited, { type: "saveStarted" });

    const done = run(saving, { type: "saveSucceeded", configuration: configurationOf(saving.draft, 2) });

    expect(done.saved?.revision).toBe(2);
    expect(done.draft).toBe(done.saved?.data);
    expect(hasUnsavedChanges(done)).toBe(false);
    expect(done.save).toEqual({ status: "idle" });
  });

  it("keeps edits made while a save was in flight, and still reports them as unsaved", () => {
    // Save "A", type "B" before the response arrives, then the response for "A" lands.
    const saving = run(
      savedFixtureState(),
      { type: "settingsChanged", sectionId: "intro", sectionType: "text", patch: { title: "A" } },
      { type: "saveStarted" },
    );
    const submitted = saving.draft;
    const typedDuringSave = run(saving, { type: "settingsChanged", sectionId: "intro", sectionType: "text", patch: { title: "B" } });

    const done = run(typedDuringSave, { type: "saveSucceeded", configuration: configurationOf(submitted, 2) });

    expect(titleOf(done, "intro")).toBe("B");
    expect((done.saved!.data.sections[1] as SectionOfType<"text">).settings.title).toBe("A");
    expect(done.saved!.revision).toBe(2);
    expect(hasUnsavedChanges(done)).toBe(true);
  });

  it("leaves the draft and the saved snapshot alone when a save fails", () => {
    const edited = run(savedFixtureState(), { type: "settingsChanged", sectionId: "intro", sectionType: "text", patch: { title: "Unsaved" } });

    const failed = run(edited, { type: "saveStarted" }, { type: "saveFailed", error: { code: "unavailable", message: "Down" } });

    expect(titleOf(failed, "intro")).toBe("Unsaved");
    expect(failed.saved).toBe(edited.saved);
    expect(failed.save).toEqual({ status: "failed", error: { code: "unavailable", message: "Down" } });
    expect(run(failed, { type: "saveErrorDismissed" }).save).toEqual({ status: "idle" });
  });

  it("ignores a second saveStarted while one save is still running", () => {
    const saving = run(savedFixtureState(), { type: "saveStarted" });
    expect(run(saving, { type: "saveStarted" })).toBe(saving);
  });
});

describe("unsaved changes", () => {
  it("treats an imported copy of the saved document as unchanged, and a different one as unsaved", () => {
    const state = savedFixtureState();

    const sameContent = run(state, { type: "draftReplaced", draft: buildFixtureDocument().data });
    const differentContent = run(state, { type: "draftReplaced", draft: { sections: [] } });

    expect(hasUnsavedChanges(sameContent)).toBe(false);
    expect(hasUnsavedChanges(differentContent)).toBe(true);
    expect(differentContent.saved).toBe(state.saved);
  });

  it("does not count typing a character and deleting it as a change", () => {
    const state = savedFixtureState();
    const original = titleOf(state, "intro");

    const after = run(
      state,
      { type: "settingsChanged", sectionId: "intro", sectionType: "text", patch: { title: `${original}!` } },
      { type: "settingsChanged", sectionId: "intro", sectionType: "text", patch: { title: original } },
    );

    expect(after.draft).not.toBe(state.draft);
    expect(hasUnsavedChanges(after)).toBe(false);
  });

  it("measures changes against the opening draft before the first save", () => {
    const fresh = createInitialState({ draft: buildFixtureDocument().data, saved: null });

    expect(hasUnsavedChanges(fresh)).toBe(false);
    expect(hasUnsavedChanges(run(fresh, { type: "sectionRemoved", sectionId: "hero" }))).toBe(true);
  });
});

describe("isSameJson", () => {
  it("ignores object key order but not array order", () => {
    expect(isSameJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(isSameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(isSameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});
