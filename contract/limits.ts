/**
 * Hard limits shared by the editor, the JSON import, the app server and the configuration
 * service, so a document that one layer accepts is never rejected by another for a
 * different reason. Exceeding a limit is a validation error, never a silent truncation.
 */
export const LIMITS = {
  maxSections: 30,
  maxImagesPerCarousel: 12,
  maxUrlLength: 2048,
  maxAltTextLength: 200,
  maxTitleLength: 120,
  maxDescriptionLength: 1000,
  maxCtaLabelLength: 40,
  maxIdLength: 64,
  /** Applies to service request bodies and to imported files. */
  maxDocumentBytes: 1024 * 1024,
} as const;
