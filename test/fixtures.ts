import type { ConfigurationDocument } from "../contract/home-screen";

/**
 * A document with two sections of every type, each with distinct values, so a test that
 * mixes up section identity or order fails visibly. Includes Unicode and a multiline description.
 *
 * @returns A fresh, valid version 1 document.
 */
export function buildFixtureDocument(): ConfigurationDocument {
  // Built fresh on every call so tests can mutate their copy freely.
  return {
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "hero",
          type: "carousel",
          settings: {
            aspectRatio: "landscape",
            images: [
              { id: "hero-1", url: "https://images.example.com/hero-1.jpg", alt: "Autumn collection" },
              { id: "hero-2", url: "https://images.example.com/hero-2.jpg", alt: "" },
            ],
          },
        },
        {
          id: "intro",
          type: "text",
          settings: {
            title: "Fall arrivals 🍂",
            description: "Layer up.\nNew knits every week — café au lait included.",
            titleColor: "#1a2b3c",
            descriptionColor: "#555",
          },
        },
        {
          id: "shop-cta",
          type: "cta",
          settings: { label: "Shop now", url: "https://shop.example.com/new", buttonColor: "#0f766e", labelColor: "#ffffff" },
        },
        {
          id: "lookbook",
          type: "carousel",
          settings: {
            aspectRatio: "portrait",
            images: [{ id: "look-1", url: "https://images.example.com/look-1.jpg", alt: "Look one" }],
          },
        },
        {
          id: "story",
          type: "text",
          settings: { title: "Our story", description: "Made in Montréal.", titleColor: "#ABCDEF", descriptionColor: "#123456" },
        },
        {
          id: "newsletter-cta",
          type: "cta",
          settings: { label: "Join the list", url: "http://news.example.com/join", buttonColor: "#ABC", labelColor: "#111111" },
        },
      ],
    },
  };
}
