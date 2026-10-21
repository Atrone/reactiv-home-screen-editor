import type { Configuration } from "../../contract/api";
import type { CarouselImage, HomeScreen, Section, SectionType, SettingsOf } from "../../contract/home-screen";
import type { SaveError } from "./save-protocol";

/** What the configuration service last acknowledged. */
export type SavedSnapshot = { revision: number; updatedAt: string; data: HomeScreen };

export type SaveState =
  | { status: "idle" }
  /** `submitted` is the exact draft object that was sent, used to reconcile the response. */
  | { status: "saving"; submitted: HomeScreen }
  | { status: "failed"; error: SaveError };

export type EditorState = {
  /** What the inputs and the preview show. Holds raw input, so it can be temporarily invalid. */
  draft: HomeScreen;
  /** Null until the first successful save. */
  saved: SavedSnapshot | null;
  /** The draft the page opened with; "unsaved changes" is measured against it until the first save. */
  startingDraft: HomeScreen;
  save: SaveState;
};

/** A settings patch whose shape is tied to the section type it targets. */
type SettingsPatch = { [T in SectionType]: { sectionType: T; patch: Partial<SettingsOf<T>> } }[SectionType];

export type EditorAction =
  | { type: "sectionAdded"; section: Section }
  | { type: "sectionRemoved"; sectionId: string }
  | { type: "sectionMoved"; sectionId: string; toIndex: number }
  | ({ type: "settingsChanged"; sectionId: string } & SettingsPatch)
  | { type: "imageAdded"; sectionId: string; image: CarouselImage }
  | { type: "imageChanged"; sectionId: string; imageId: string; patch: Partial<Omit<CarouselImage, "id">> }
  | { type: "imageRemoved"; sectionId: string; imageId: string }
  | { type: "draftReplaced"; draft: HomeScreen }
  | { type: "saveStarted" }
  | { type: "saveSucceeded"; configuration: Configuration }
  | { type: "saveFailed"; error: SaveError }
  | { type: "saveErrorDismissed" };

export type EditorInit = { draft: HomeScreen; saved: SavedSnapshot | null };

/**
 * Builds the reducer's initial state from what the loader returned.
 *
 * @param init - The draft to show and the saved snapshot (if any).
 * @returns The initial editor state.
 */
export function createInitialState(init: EditorInit): EditorState {
  // The opening draft doubles as the "nothing changed yet" baseline before the first save.
  return { draft: init.draft, saved: init.saved, startingDraft: init.draft, save: { status: "idle" } };
}

/**
 * The editor's single state transition function. Pure: ids and timestamps arrive inside
 * actions, so replaying an action always produces the same state. Unknown targets (a section
 * id that no longer exists) leave the state untouched instead of throwing.
 *
 * @param state - Current state.
 * @param action - What happened.
 * @returns The next state (the same object when nothing changed).
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "sectionAdded":
      // New sections go to the bottom, where the "Add section" buttons are.
      return withSections(state, [...state.draft.sections, action.section]);

    case "sectionRemoved":
      return withSections(
        state,
        state.draft.sections.filter((section) => section.id !== action.sectionId),
      );

    case "sectionMoved":
      return withSections(state, moveItem(state.draft.sections, action.sectionId, action.toIndex));

    case "settingsChanged":
      return updateSection(state, action.sectionId, (section) =>
        // The type check makes the cast safe: the action's patch is typed for `sectionType`.
        section.type === action.sectionType ? ({ ...section, settings: { ...section.settings, ...action.patch } } as Section) : section,
      );

    case "imageAdded":
      return updateImages(state, action.sectionId, (images) => [...images, action.image]);

    case "imageChanged":
      return updateImages(state, action.sectionId, (images) =>
        images.map((image) => (image.id === action.imageId ? { ...image, ...action.patch } : image)),
      );

    case "imageRemoved":
      return updateImages(state, action.sectionId, (images) => images.filter((image) => image.id !== action.imageId));

    case "draftReplaced":
      // An import replaces what is on screen but not what is saved, so it shows as unsaved.
      // A failure message from an earlier save no longer describes this draft, so clear it.
      return { ...state, draft: action.draft, save: state.save.status === "saving" ? state.save : { status: "idle" } };

    case "saveStarted":
      // One save at a time; the button is disabled while saving, this is the backstop.
      if (state.save.status === "saving") {
        return state;
      }
      return { ...state, save: { status: "saving", submitted: state.draft } };

    case "saveSucceeded": {
      const { configuration } = action;
      const saved: SavedSnapshot = { revision: configuration.revision, updatedAt: configuration.updatedAt, data: configuration.data };
      // If nothing was edited while the request was in flight, adopt the server's copy so the
      // draft and the saved snapshot are identical. If the user kept typing, keep their newer
      // draft: it stays "unsaved", and the next save is based on the new revision.
      const untouched = state.save.status === "saving" && state.draft === state.save.submitted;
      return { ...state, saved, draft: untouched ? configuration.data : state.draft, save: { status: "idle" } };
    }

    case "saveFailed":
      // The draft is never touched on failure, so nothing the user typed is lost.
      return { ...state, save: { status: "failed", error: action.error } };

    case "saveErrorDismissed":
      return state.save.status === "failed" ? { ...state, save: { status: "idle" } } : state;
  }
}

/**
 * Whether the draft differs from what is saved (or, before the first save, from what the page opened with).
 *
 * @param state - Editor state.
 * @returns True when there is something to save.
 */
export function hasUnsavedChanges(state: EditorState): boolean {
  // Structural comparison, so typing a character and deleting it again does not count as a change.
  return !isSameJson(state.draft, state.saved ? state.saved.data : state.startingDraft);
}

/**
 * Deep equality for JSON-shaped values. Object key order is ignored, because the server's
 * copy is rebuilt by the schema and may order keys differently than the editor does.
 *
 * @param a - First value.
 * @param b - Second value.
 * @returns True when both values have the same JSON content.
 */
export function isSameJson(a: unknown, b: unknown): boolean {
  // Same reference (or equal primitives): the common case after a save.
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, index) => isSameJson(item, other[index]));
  }
  // Plain objects: same key set, and every value equal.
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && isSameJson(left[key], right[key]));
}

/**
 * Returns a state with a new section list, or the same state if the list did not change.
 *
 * @param state - Current state.
 * @param sections - Candidate section list.
 * @returns Next state.
 */
function withSections(state: EditorState, sections: Section[]): EditorState {
  // Helpers return the original array when nothing matched; keep the state reference stable then.
  if (sections === state.draft.sections) {
    return state;
  }
  return { ...state, draft: { ...state.draft, sections } };
}

/**
 * Replaces one section via `update`, leaving every other section object untouched so memoized
 * previews of the other sections do not re-render.
 *
 * @param state - Current state.
 * @param sectionId - Section to update.
 * @param update - Returns the new section (or the same one for "no change").
 * @returns Next state.
 */
function updateSection(state: EditorState, sectionId: string, update: (section: Section) => Section): EditorState {
  let changed = false;
  const sections = state.draft.sections.map((section) => {
    // Only the targeted section is rebuilt.
    if (section.id !== sectionId) {
      return section;
    }
    const next = update(section);
    changed ||= next !== section;
    return next;
  });
  return changed ? withSections(state, sections) : state;
}

/**
 * Applies `update` to the image list of one carousel section.
 *
 * @param state - Current state.
 * @param sectionId - Carousel section id.
 * @param update - Maps the current image list to the next one.
 * @returns Next state (unchanged when the section is missing or not a carousel).
 */
function updateImages(state: EditorState, sectionId: string, update: (images: CarouselImage[]) => CarouselImage[]): EditorState {
  return updateSection(state, sectionId, (section) =>
    // Image actions only make sense for carousels; anything else is ignored.
    section.type === "carousel" ? { ...section, settings: { ...section.settings, images: update(section.settings.images) } } : section,
  );
}

/**
 * Moves the item with `id` to `toIndex` (clamped to the list bounds).
 *
 * @param items - Items with ids.
 * @param id - Item to move.
 * @param toIndex - Destination index.
 * @returns A new array, or the original array when the move is a no-op.
 */
function moveItem<T extends { id: string }>(items: T[], id: string, toIndex: number): T[] {
  const fromIndex = items.findIndex((item) => item.id === id);
  const target = Math.max(0, Math.min(items.length - 1, toIndex));
  // Unknown id or same position: nothing to do.
  if (fromIndex === -1 || fromIndex === target) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(target, 0, moved!);
  return next;
}
