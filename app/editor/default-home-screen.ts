import type { HomeScreen } from "../../contract/home-screen";

/**
 * The screen shown before anything has been saved. Ids are fixed strings rather than random
 * ones so the server-rendered HTML and the hydrated client always agree.
 *
 * @returns A fresh copy of the default home screen.
 */
export function createDefaultHomeScreen(): HomeScreen {
  // A new object every call, so callers can never mutate a shared default.
  return {
    sections: [
      {
        id: "welcome-carousel",
        type: "carousel",
        settings: {
          aspectRatio: "landscape",
          images: [
            { id: "welcome-1", url: "https://picsum.photos/seed/reactiv-hero-1/1200/675", alt: "Featured collection" },
            { id: "welcome-2", url: "https://picsum.photos/seed/reactiv-hero-2/1200/675", alt: "New arrivals" },
            { id: "welcome-3", url: "https://picsum.photos/seed/reactiv-hero-3/1200/675", alt: "Staff picks" },
          ],
        },
      },
      {
        id: "welcome-text",
        type: "text",
        settings: {
          title: "New season, new favourites",
          description: "Discover this week's arrivals, picked by our team.\nFree shipping on orders over $50.",
          titleColor: "#111827",
          descriptionColor: "#4b5563",
        },
      },
      {
        id: "welcome-cta",
        type: "cta",
        settings: {
          label: "Shop new arrivals",
          url: "https://example.com/collections/new",
          buttonColor: "#111827",
          labelColor: "#ffffff",
        },
      },
    ],
  };
}
