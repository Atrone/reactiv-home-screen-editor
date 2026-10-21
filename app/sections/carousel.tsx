import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { carouselImageSchema, type AspectRatio, type CarouselImage, type SectionOfType, type SettingsOf } from "../../contract/home-screen";
import { LIMITS } from "../../contract/limits";
import { isAllowedUrl } from "../../contract/rules";
import { SegmentedControl, TextField } from "../components/fields";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, TrashIcon } from "../components/icons";
import { useEditorDispatch } from "../editor/context";
import type { FieldErrors } from "../editor/validation";
import { ASPECT_RATIO_OPTIONS, createImage } from "./registry";

const RATIO_CHOICES = (Object.keys(ASPECT_RATIO_OPTIONS) as AspectRatio[]).map((value) => ({
  value,
  label: ASPECT_RATIO_OPTIONS[value].label,
  detail: ASPECT_RATIO_OPTIONS[value].ratio,
}));

/**
 * Form for a carousel: view (aspect ratio), the image list, and an "add image" input.
 *
 * @param props - The section and its field errors.
 * @returns The form fields.
 */
export function CarouselFields({ section, errors }: { section: SectionOfType<"carousel">; errors: FieldErrors }) {
  const dispatch = useEditorDispatch();
  const { aspectRatio, images } = section.settings;
  const atLimit = images.length >= LIMITS.maxImagesPerCarousel;

  return (
    <div className="space-y-5">
      <SegmentedControl
        name={`${section.id}-aspect-ratio`}
        legend="View"
        value={aspectRatio}
        options={RATIO_CHOICES}
        // Aspect ratio comes from a fixed list, so it can be dispatched without validation.
        onChange={(value) => dispatch({ type: "settingsChanged", sectionId: section.id, sectionType: "carousel", patch: { aspectRatio: value } })}
      />

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h4 className="text-sm font-medium text-slate-700">Images</h4>
          <span className="text-xs text-slate-500 tabular-nums">
            {images.length}/{LIMITS.maxImagesPerCarousel}
          </span>
        </div>
        {images.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">No images yet. Paste an image URL below.</p>
        ) : (
          <ol className="space-y-3">
            {images.map((image, index) => (
              <ImageRow key={image.id} sectionId={section.id} image={image} position={index + 1} errors={errors} />
            ))}
          </ol>
        )}
        {errors.images && <p className="text-sm text-red-600">{errors.images}</p>}
        <AddImageForm sectionId={section.id} disabled={atLimit} />
      </div>
    </div>
  );
}

type ImageRowProps = { sectionId: string; image: CarouselImage; position: number; errors: FieldErrors };

/**
 * One editable image: thumbnail, URL, alt text and a remove button.
 *
 * @param props - The image, its position (1-based) and the section's field errors.
 * @returns The list item.
 */
function ImageRow({ sectionId, image, position, errors }: ImageRowProps) {
  const dispatch = useEditorDispatch();
  const idBase = `${sectionId}-image-${image.id}`;

  return (
    <li className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="mt-6 size-12 shrink-0 overflow-hidden rounded-md bg-slate-200">
        <PreviewImage key={image.url} image={image} eager compact />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <TextField
          id={`${idBase}-url`}
          label={`Image ${position} URL`}
          type="url"
          value={image.url}
          // URL edits are stored as typed; the shared schema reports problems inline.
          onChange={(url) => dispatch({ type: "imageChanged", sectionId, imageId: image.id, patch: { url } })}
          error={errors[`images.${image.id}.url`]}
          trimOnBlur
        />
        <TextField
          id={`${idBase}-alt`}
          label={`Image ${position} description`}
          value={image.alt}
          placeholder="Describe the image for screen readers"
          onChange={(alt) => dispatch({ type: "imageChanged", sectionId, imageId: image.id, patch: { alt } })}
          error={errors[`images.${image.id}.alt`]}
          limit={LIMITS.maxAltTextLength}
        />
      </div>
      <button
        type="button"
        aria-label={`Remove image ${position}`}
        title={`Remove image ${position}`}
        onClick={() => dispatch({ type: "imageRemoved", sectionId, imageId: image.id })}
        className="mt-6 self-start rounded-md p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
      >
        <TrashIcon />
      </button>
    </li>
  );
}

/**
 * Input for appending an image. The URL is validated before it is added (with the same rule
 * and message as the schema), so the common "paste a URL" flow never makes the draft invalid.
 *
 * @param props - Target section and whether the image limit is reached.
 * @returns The form.
 */
function AddImageForm({ sectionId, disabled }: { sectionId: string; disabled: boolean }) {
  const dispatch = useEditorDispatch();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | undefined>();
  const inputId = `${sectionId}-new-image`;

  /**
   * Validates the pasted URL and appends it as a new image.
   *
   * @param event - Form submit event.
   */
  const submit = (event: FormEvent<HTMLFormElement>) => {
    // Handled entirely client-side; nothing is persisted until Save.
    event.preventDefault();
    const candidate = url.trim();
    const result = carouselImageSchema.shape.url.safeParse(candidate);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid URL");
      return;
    }
    dispatch({ type: "imageAdded", sectionId, image: createImage(candidate) });
    setUrl("");
    setError(undefined);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-1">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        Add image
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="url"
          value={url}
          disabled={disabled}
          placeholder={disabled ? `Limit of ${LIMITS.maxImagesPerCarousel} images reached` : "https://…"}
          onChange={(event) => {
            // Clear a stale error as soon as the user edits the value.
            setUrl(event.target.value);
            setError(undefined);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`block w-full min-w-0 rounded-lg border px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:bg-slate-100 ${error ? "border-red-400" : "border-slate-300"}`}
        />
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <PlusIcon width={16} height={16} />
          Add
        </button>
      </div>
      {error && (
        <p id={`${inputId}-error`} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Horizontally scrolling carousel using native CSS scroll-snap: touch and trackpad scrolling,
 * momentum and keyboard scrolling come from the browser, with no library and nothing to
 * initialize after hydration. The next slide peeks in to show there is more; prev/next buttons
 * cover mouse users without a horizontal wheel.
 *
 * @param props - Carousel settings.
 * @returns The preview block.
 */
export function CarouselPreview({ settings }: { settings: SettingsOf<"carousel"> }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: false });
  const ratio = ASPECT_RATIO_OPTIONS[settings.aspectRatio]?.css ?? "16 / 9";
  const count = settings.images.length;

  /**
   * Recomputes whether the scroller is at either end, to disable the matching button.
   */
  const updateEdges = useCallback(() => {
    const scroller = scrollerRef.current;
    // Nothing to measure before mount or for an empty carousel.
    if (!scroller) {
      return;
    }
    setEdges({ atStart: scroller.scrollLeft <= 1, atEnd: scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1 });
  }, []);

  // Slide count and frame shape change the scroll width, so re-measure after either changes.
  useEffect(updateEdges, [updateEdges, count, settings.aspectRatio]);

  /**
   * Scrolls by roughly one slide.
   *
   * @param direction - -1 for previous, 1 for next.
   */
  const step = (direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    // scrollBy is missing in some test DOMs; the browser always has it.
    scroller?.scrollBy?.({ left: direction * scroller.clientWidth * 0.85, behavior: "smooth" });
  };

  if (count === 0) {
    return (
      <div className="px-4" data-aspect-ratio={settings.aspectRatio}>
        <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400" style={{ aspectRatio: ratio }}>
          No images yet
        </div>
      </div>
    );
  }

  return (
    <div className="relative" data-aspect-ratio={settings.aspectRatio}>
      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label={`Image carousel, ${count} ${count === 1 ? "image" : "images"}`}
        className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-scrollbar]:hidden"
      >
        {settings.images.map((image, index) => (
          <figure
            key={image.id}
            aria-label={`Slide ${index + 1} of ${count}`}
            className={`relative shrink-0 snap-center overflow-hidden rounded-xl bg-slate-100 ${count === 1 ? "basis-full" : "basis-[85%]"}`}
            style={{ aspectRatio: ratio }}
          >
            {/* Keyed by URL so a corrected URL gets a fresh load attempt. */}
            <PreviewImage key={image.url} image={image} eager={index === 0} />
          </figure>
        ))}
      </div>
      {count > 1 && (
        <>
          <CarouselButton label="Previous image" disabled={edges.atStart} onClick={() => step(-1)} side="left" />
          <CarouselButton label="Next image" disabled={edges.atEnd} onClick={() => step(1)} side="right" />
        </>
      )}
    </div>
  );
}

/**
 * Round prev/next button overlaid on the carousel edge.
 *
 * @param props - Label, side, disabled state and click handler.
 * @returns The button.
 */
function CarouselButton({ label, side, disabled, onClick }: { label: string; side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  // Hidden (not just disabled) at the ends, so it never covers the first or last image.
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`absolute top-1/2 ${side === "left" ? "left-1.5" : "right-1.5"} -translate-y-1/2 rounded-full bg-white/90 p-1 text-slate-800 shadow transition hover:bg-white disabled:opacity-0`}
    >
      {side === "left" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </button>
  );
}

type PreviewImageProps = { image: CarouselImage; eager?: boolean; compact?: boolean };

/**
 * Image with a bounded fallback. The frame's aspect ratio is reserved by the parent, so a
 * slow or broken image never collapses the layout.
 *
 * @param props - The image, whether to load eagerly, and whether to use the small fallback.
 * @returns The image or a placeholder.
 */
function PreviewImage({ image, eager = false, compact = false }: PreviewImageProps) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const valid = isAllowedUrl(image.url, ["https:"]);

  useEffect(() => {
    // If the image failed before React hydrated, onError has already fired with no listener
    // attached. A finished image with no pixels is a failed one.
    const element = imageRef.current;
    if (element?.complete && element.naturalWidth === 0) {
      setFailed(true);
    }
  }, []);

  if (!valid || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 p-2 text-center text-xs text-slate-400">
        {compact ? "—" : valid ? "Image failed to load" : "Invalid image URL"}
      </div>
    );
  }
  return (
    <img
      ref={imageRef}
      src={image.url}
      alt={image.alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}
