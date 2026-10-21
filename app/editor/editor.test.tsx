import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Configuration } from "../../contract/api";
import type { HomeScreen, SectionOfType } from "../../contract/home-screen";
import { buildFixtureDocument } from "../../test/fixtures";
import EditorRoute, { clientAction, ErrorBoundary, shouldRevalidate } from "../routes/editor";
import type { SaveRequest, SaveResponse } from "./save-protocol";

type LoaderData = { status: "saved"; configuration: Configuration } | { status: "new"; draft: HomeScreen };
type SaveHandler = (request: SaveRequest) => SaveResponse | Promise<SaveResponse>;

/**
 * Wraps a payload in the configuration resource the service would return.
 *
 * @param data - Home screen payload.
 * @param revision - Revision number.
 * @returns A configuration.
 */
function configurationOf(data: HomeScreen, revision: number): Configuration {
  // structuredClone mimics a fresh JSON-parsed response object.
  return { id: "home", schemaVersion: 1, revision, updatedAt: "2026-10-21T12:00:00.000Z", data: structuredClone(data) };
}

/**
 * Renders the real editor route (component, error boundary, revalidation rule) in a memory
 * router whose loader and action are test doubles. Everything between the route and the
 * reducer is production code.
 *
 * @param options - Loader results in call order, and how the action answers saves.
 * @returns The user-event instance and the save requests the action received.
 */
async function renderEditor(options: { loads?: LoaderData[]; save?: SaveHandler } = {}) {
  const loads = options.loads ?? [{ status: "saved", configuration: configurationOf(buildFixtureDocument().data, 1) }];
  const saveRequests: SaveRequest[] = [];
  let loadCount = 0;
  const Stub = createRoutesStub([
    {
      path: "/",
      // The route component's props come from withComponentProps inside the stub.
      Component: EditorRoute as ComponentType,
      ErrorBoundary: ErrorBoundary as ComponentType,
      shouldRevalidate,
      loader: () => loads[Math.min(loadCount++, loads.length - 1)]!,
      action: async ({ request }) => {
        // Record exactly what the browser would post to the server action.
        const body = (await request.json()) as SaveRequest;
        saveRequests.push(body);
        return options.save ? options.save(body) : { ok: true, configuration: configurationOf(body.document.data, saveRequests.length + 1) };
      },
    },
  ]);
  const user = userEvent.setup();
  render(<Stub />);
  await screen.findByRole("region", { name: "Home screen preview" });
  return { user, saveRequests };
}

/**
 * Returns the preview region, for scoping queries to what the phone shows.
 *
 * @returns The preview element.
 */
function preview(): HTMLElement {
  // Labelled <section> elements expose the "region" role.
  return screen.getByRole("region", { name: "Home screen preview" });
}

/**
 * Returns the card for the section at a 1-based position.
 *
 * @param position - 1-based position.
 * @param total - Number of sections on screen.
 * @param label - Section type label ("Carousel", "Text" or "Button").
 * @returns The card element.
 */
function card(position: number, total: number, label: string): HTMLElement {
  // Card names follow "Section 2 of 6: Text".
  return screen.getByRole("article", { name: `Section ${position} of ${total}: ${label}` });
}

/**
 * Returns the sticky toolbar.
 *
 * @returns The toolbar element.
 */
function toolbar(): HTMLElement {
  // Section cards also use <header>, so the toolbar is found by its landmark name.
  return screen.getByRole("banner", { name: "Editor toolbar" });
}

/**
 * Reads the save status pill in the toolbar.
 *
 * @returns The status text.
 */
function saveStatus(): string {
  // The pill is the Save button's accessible description, which is how assistive tech reads it.
  const describedBy = saveButton().getAttribute("aria-describedby") ?? "";
  return document.getElementById(describedBy)?.textContent ?? "";
}

/**
 * Returns the toolbar's Save button.
 *
 * @returns The button.
 */
function saveButton(): HTMLElement {
  // The label switches to "Saving…" while a request is in flight.
  return within(toolbar()).getByRole("button", { name: /^Sav/ });
}

/**
 * Creates a promise that the test resolves by hand, to hold a save "in flight".
 *
 * @returns The promise and its resolver.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    // Captured so the test decides when the server "answers".
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("live preview", () => {
  it("shows edits in the preview immediately, without saving", async () => {
    const { user, saveRequests } = await renderEditor();
    const title = within(card(2, 6, "Text")).getByLabelText("Title");

    await user.clear(title);
    await user.type(title, "Winter sale ❄️");

    expect(within(preview()).getByRole("heading", { name: "Winter sale ❄️" })).toBeInTheDocument();
    expect(saveStatus()).toBe("Unsaved changes");
    expect(saveRequests).toHaveLength(0);
  });

  it("changes the title and description colors independently", async () => {
    const { user } = await renderEditor();
    const intro = card(2, 6, "Text");

    await user.clear(within(intro).getByLabelText("Title color"));
    await user.type(within(intro).getByLabelText("Title color"), "#ff0000");

    const heading = within(preview()).getByRole("heading", { name: "Fall arrivals 🍂" });
    expect(heading).toHaveStyle({ color: "rgb(255, 0, 0)" });
    // The description keeps its own color (#555 from the fixture).
    expect(within(preview()).getByText(/Layer up\./)).toHaveStyle({ color: "rgb(85, 85, 85)" });
  });

  it("keeps two carousels independent when one gets a new image", async () => {
    const { user } = await renderEditor();
    const lookbook = card(4, 6, "Carousel");

    await user.type(within(lookbook).getByLabelText("Add image"), "https://images.example.com/look-2.jpg");
    await user.click(within(lookbook).getByRole("button", { name: "Add" }));

    const carousels = within(preview()).getAllByRole("group", { name: /Image carousel/ });
    expect(carousels.map((carousel) => carousel.getAttribute("aria-label"))).toEqual(["Image carousel, 2 images", "Image carousel, 2 images"]);
    /**
     * Lists the image sources inside one carousel, in order.
     *
     * @param carousel - A carousel element from the preview.
     * @returns The `src` of every slide image.
     */
    const sources = (carousel: HTMLElement) =>
      // Queried as elements: an image with empty alt text is decorative and has no "img" role.
      [...carousel.querySelectorAll("img")].map((image) => image.getAttribute("src"));
    expect(sources(carousels[1]!)).toEqual(["https://images.example.com/look-1.jpg", "https://images.example.com/look-2.jpg"]);
    expect(sources(carousels[0]!)).toEqual(["https://images.example.com/hero-1.jpg", "https://images.example.com/hero-2.jpg"]);
  });

  it("reorders the preview when a section moves, keeping each section's settings", async () => {
    const { user } = await renderEditor();

    // Move "Our story" (5th) above "Fall arrivals" (2nd): three steps up.
    for (const position of [5, 4, 3]) {
      await user.click(within(card(position, 6, "Text")).getByRole("button", { name: "Move up" }));
    }

    const headings = within(preview()).getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["Our story", "Fall arrivals 🍂"]);
    expect(within(preview()).getByRole("heading", { name: "Our story" })).toHaveStyle({ color: "rgb(171, 205, 239)" });
  });

  it("changes the carousel frame when the view changes", async () => {
    const { user } = await renderEditor();
    const hero = card(1, 6, "Carousel");

    await user.click(within(hero).getByRole("radio", { name: /Square/ }));

    const [firstSlide] = within(preview()).getAllByRole("figure");
    expect(firstSlide).toHaveStyle({ aspectRatio: "1 / 1" });
  });

  it("leaves a usable empty state after the last image is removed", async () => {
    const { user } = await renderEditor();
    const lookbook = card(4, 6, "Carousel");

    await user.click(within(lookbook).getByRole("button", { name: "Remove image 1" }));

    expect(within(lookbook).getByText(/No images yet/)).toBeInTheDocument();
    expect(within(preview()).getByText("No images yet")).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("removes a section only after the remove button is confirmed", async () => {
    const { user } = await renderEditor();
    const remove = within(card(3, 6, "Button")).getByRole("button", { name: "Remove section" });

    await user.click(remove);
    expect(screen.getAllByRole("article")).toHaveLength(6);

    await user.click(within(card(3, 6, "Button")).getByRole("button", { name: "Confirm remove section" }));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(within(preview()).queryByRole("link", { name: "Shop now" })).not.toBeInTheDocument();
  });

  it("adds a new section of each type at the bottom", async () => {
    const { user } = await renderEditor({ loads: [{ status: "new", draft: { sections: [] } }] });
    expect(screen.getByText("This home screen has no sections yet.")).toBeInTheDocument();

    for (const label of ["Carousel", "Text", "Button"]) {
      await user.click(screen.getByRole("button", { name: label }));
    }

    expect(screen.getAllByRole("article").map((article) => article.getAttribute("aria-label"))).toEqual([
      "Section 1 of 3: Carousel",
      "Section 2 of 3: Text",
      "Section 3 of 3: Button",
    ]);
    expect(within(preview()).getByRole("heading", { name: "New heading" })).toBeInTheDocument();
  });
});

describe("validation", () => {
  it("flags an unsafe link inline, blocks Save and Export, and never renders it as a link", async () => {
    const { user } = await renderEditor();
    const cta = card(3, 6, "Button");
    const link = within(cta).getByLabelText("Link");

    await user.clear(link);
    await user.type(link, "javascript:alert(1)");

    expect(link).toHaveAttribute("aria-invalid", "true");
    expect(within(cta).getByText("Use a full link starting with https:// or http://")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(within(toolbar()).getByRole("button", { name: "Export" })).toBeDisabled();
    expect(within(preview()).queryByRole("link", { name: "Shop now" })).not.toBeInTheDocument();
    expect(within(preview()).getByText("Shop now")).not.toHaveAttribute("href");
  });

  it("keeps an error attached to its section when that section moves", async () => {
    const { user } = await renderEditor();
    const color = within(card(5, 6, "Text")).getByLabelText("Title color");
    await user.clear(color);
    await user.type(color, "#12");

    await user.click(within(card(5, 6, "Text")).getByRole("button", { name: "Move up" }));

    expect(within(card(4, 6, "Text")).getByLabelText("Title color")).toHaveAttribute("aria-invalid", "true");
    expect(card(5, 6, "Carousel").querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});

describe("import and export", () => {
  it("exports the current draft, including unsaved edits", async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      // Capture the file contents instead of downloading.
      created.push(blob);
      return "blob:export";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { user } = await renderEditor();
    const title = within(card(2, 6, "Text")).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Unsaved title");

    await user.click(within(toolbar()).getByRole("button", { name: "Export" }));

    const exported = JSON.parse(await created[0]!.text()) as { schemaVersion: number; data: HomeScreen };
    expect(Object.keys(exported)).toEqual(["schemaVersion", "data"]);
    expect((exported.data.sections[1] as SectionOfType<"text">).settings.title).toBe("Unsaved title");
    expect(exported.data.sections.map((section) => section.id)).toEqual(buildFixtureDocument().data.sections.map((section) => section.id));
  });

  it("rejects a malformed file with a reason and leaves the draft untouched", async () => {
    const { user } = await renderEditor();

    await user.upload(screen.getByLabelText("Import a configuration file"), new File(["{ not json"], "broken.json", { type: "application/json" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not import broken.json");
    expect(alert).toHaveTextContent("This file is not valid JSON.");
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(saveStatus()).toBe("All changes saved");
  });

  it("lists field problems for a well-formed but invalid file, without applying any of it", async () => {
    const { user } = await renderEditor();
    const document = buildFixtureDocument();
    document.data.sections = [document.data.sections[1]!];
    (document.data.sections[0] as SectionOfType<"text">).settings.titleColor = "red";

    await user.upload(screen.getByLabelText("Import a configuration file"), new File([JSON.stringify(document)], "bad.json", { type: "application/json" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Section 1 › titleColor: Use a hex color like #1a2b3c or #abc");
    expect(screen.getAllByRole("article")).toHaveLength(6);
  });

  it("replaces the draft with a valid file, without saving it", async () => {
    const { user, saveRequests } = await renderEditor();
    const imported = { schemaVersion: 1, data: { sections: [buildFixtureDocument().data.sections[4]!] } };

    await user.upload(screen.getByLabelText("Import a configuration file"), new File([JSON.stringify(imported)], "story.json", { type: "application/json" }));

    expect(await screen.findByText("Imported story.json")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(within(preview()).getByRole("heading", { name: "Our story" })).toBeInTheDocument();
    expect(saveStatus()).toBe("Unsaved changes");
    expect(saveRequests).toHaveLength(0);
  });
});

describe("saving", () => {
  it("sends the draft with its base revision and then reports everything saved", async () => {
    const { user, saveRequests } = await renderEditor();
    const title = within(card(2, 6, "Text")).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Saved title");

    await user.click(saveButton());

    await waitFor(() => expect(saveStatus()).toBe("All changes saved"));
    expect(saveRequests).toHaveLength(1);
    expect(saveRequests[0]!.baseRevision).toBe(1);
    expect((saveRequests[0]!.document.data.sections[1] as SectionOfType<"text">).settings.title).toBe("Saved title");
    expect(saveButton()).toBeDisabled();
  });

  it("keeps edits typed while a save is in flight, and bases the next save on the new revision", async () => {
    const pending = deferred<SaveResponse>();
    const { user, saveRequests } = await renderEditor({ save: () => pending.promise });
    const title = within(card(2, 6, "Text")).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Draft A");
    await user.click(saveButton());
    expect(saveStatus()).toBe("Saving…");

    await user.type(title, " then B");
    await act(async () => pending.resolve({ ok: true, configuration: configurationOf(saveRequests[0]!.document.data, 2) }));

    await waitFor(() => expect(saveStatus()).toBe("Unsaved changes"));
    expect(title).toHaveValue("Draft A then B");
    expect(within(preview()).getByRole("heading", { name: "Draft A then B" })).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("keeps the draft after a failed save and lets the user retry", async () => {
    const answers: SaveResponse[] = [
      { ok: false, error: { code: "unavailable", message: "The configuration service is unavailable." } },
    ];
    const { user, saveRequests } = await renderEditor({
      save: (request) => answers.shift() ?? { ok: true, configuration: configurationOf(request.document.data, 2) },
    });
    const title = within(card(2, 6, "Text")).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Keep me");

    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("The configuration service is unavailable.");
    expect(saveStatus()).toBe("Not saved");
    expect(title).toHaveValue("Keep me");

    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(saveStatus()).toBe("All changes saved"));
    expect(saveRequests).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("after a conflict, 'load the latest' shows the newer saved version, not the stale page data", async () => {
    const theirs = buildFixtureDocument().data;
    (theirs.sections[1] as SectionOfType<"text">).settings.title = "Saved in another tab";
    const { user } = await renderEditor({
      loads: [
        { status: "saved", configuration: configurationOf(buildFixtureDocument().data, 1) },
        { status: "saved", configuration: configurationOf(theirs, 3) },
      ],
      save: () => ({ ok: false, error: { code: "conflict", message: "This home screen was saved somewhere else after you opened it." } }),
    });
    const title = within(card(2, 6, "Text")).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Mine");
    await user.click(saveButton());
    const alert = await screen.findByRole("alert");

    await user.click(within(alert).getByRole("button", { name: "Discard my changes and load the latest" }));

    await waitFor(() => expect(within(preview()).getByRole("heading", { name: "Saved in another tab" })).toBeInTheDocument());
    expect(within(card(2, 6, "Text")).getByLabelText("Title")).toHaveValue("Saved in another tab");
    expect(saveStatus()).toBe("All changes saved");
  });
});

describe("route wiring", () => {
  it("turns an unreachable app server into a retryable save error instead of throwing", async () => {
    const result = await clientAction({ serverAction: () => Promise.reject(new TypeError("Failed to fetch")) } as never);
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("does not re-run the loader after a save, but does for explicit revalidation", () => {
    const base = { currentUrl: new URL("http://x/"), nextUrl: new URL("http://x/"), currentParams: {}, nextParams: {}, defaultShouldRevalidate: true };
    expect(shouldRevalidate({ ...base, formMethod: "POST" })).toBe(false);
    expect(shouldRevalidate(base)).toBe(true);
  });
});
