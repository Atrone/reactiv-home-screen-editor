import { useEffect } from "react";

/**
 * Starts a browser download of in-memory text, without a server round trip.
 *
 * @param fileName - Suggested file name.
 * @param contents - File contents.
 * @param type - MIME type.
 */
export function downloadTextFile(fileName: string, contents: string, type = "application/json"): void {
  // An object URL plus a temporary <a download> is the portable way to save a generated file.
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on the next tick; some browsers read the URL asynchronously after click().
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Asks the browser to confirm before closing or reloading the tab while there are unsaved changes.
 *
 * @param active - Whether a warning is currently needed.
 */
export function useLeavePageWarning(active: boolean): void {
  useEffect(() => {
    // Only listen while there is something to lose; an idle listener can disable the bfcache.
    if (!active) {
      return;
    }

    /**
     * Triggers the browser's native "Leave site?" dialog.
     *
     * @param event - The beforeunload event.
     */
    const warn = (event: BeforeUnloadEvent) => {
      // preventDefault is the standard signal; browsers show their own generic message.
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
