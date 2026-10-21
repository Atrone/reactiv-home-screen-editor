# Decision Log

Anthony Teixeira · Reactiv full-stack take-home

## How I used AI

- **Planning (ChatGPT).** I used ChatGPT to turn the brief into an acceptance checklist (43 pass
  conditions) and an architecture proposal. An earlier attempt followed that proposal closely:
  Postgres in Docker, Fastify, tenant scoping, rate limiting, about 640 tests. For this submission
  I started over with a deliberately smaller scope, using the checklist rather than the proposal
  as the definition of done.
- **Checking the output.** The agent probed a library's real behavior before relying on it, wrote
  a failing test before trusting a fix, and drove the running app in a browser against both servers
  (including killing the service mid-session).
  Final state: 126 passing tests, clean typecheck and production build, and no trace
  of the API key in the client bundle, the rendered HTML or the logs.

## What I changed or rejected

1. **Most of the AI architecture proposal, for this scope.**
   - Postgres in Docker became SQLite via Node's built-in `node:sqlite` (no Docker, no native
     addon), and Fastify became Hono, whose `app.request()` lets tests drive the real service
     in-process. Tenancy, rate limiting, a publish/CDN pipeline and Playwright became future work.
   - Colors are stored exactly as typed instead of normalized to six-digit hex, so the server
     echoes what was sent and "All changes saved" stays truthful.
   - The proposal's limits (100 sections, 20 images, 256 KiB) allowed documents larger than its
     own body limit; they were re-derived from worst-case size (30 sections, 12 images, 1 MiB).
2. **Zod's `z.url()` for user-entered links.** A probe showed it accepts `javascript:alert(1)` and
   `data:text/html,…`, which would be stored XSS as a button `href`. A second probe showed that
   `https:example.com` parses as absolute but resolves relative to the page when used as a link.
   The shared rule is now an allow-list (`https:` for images, `http(s):` for links) that also
   requires `scheme://host`. Both cases have tests.
3. **The body limit the first draft skipped.** The private service capped bodies at 1 MiB, but the
   public save action (the endpoint browsers can actually reach) read unbounded bodies; the draft
   left that to "a reverse proxy". The action now counts bytes while streaming, which works without
   `Content-Length`. It also requires `application/json`, which blocks cross-site `text/plain` form
   posts.
4. **A race found in browser testing.** After a save conflict, "Discard my changes and load the
   latest" showed stale data, even though the service log proved the loader had re-run. React
   Router commits revalidated loader data inside a React transition, and the editor remounted
   immediately after `await revalidate()` as an urgent update, before the new data had rendered.
   The agent wrote a regression test against the real route module, confirmed it failed, then moved
   the remount into an effect that runs once the fresh data is on screen.
5. **Smaller browser findings, all fixed and rechecked:** visually hidden inputs in labels without
   `position: relative` could jump the page to the top on focus; the toolbar title collapsed at
   375 px; and a save error rendered at the top of the page, invisible if you had scrolled down.

## Key technical tradeoffs

- **A separate private service rather than API routes inside the app.** It costs a second process
  and a shared contract. In return the credential boundary is structural: the service listens on
  loopback and requires a key only the app server holds, so the browser has no path to it. The app
  server also validates the service's responses, so contract drift fails loudly at the boundary.
- **SQLite document storage.** Each screen is one JSON row, because it is always read and written
  whole. Data survives restarts with no setup, and an update is one atomic compare-and-set
  (`UPDATE … WHERE revision = ? RETURNING`). The price is a single host and a single writer. The
  repository is an async interface, so Postgres can replace it. In-memory storage was rejected
  because every `tsx watch` restart would wipe saved data during review.
- **Optimistic concurrency over last-write-wins.** `If-Match` is required (428 without it, 412 when
  stale), so a second tab cannot silently overwrite newer work. The cost is a conflict flow in the
  UI (export or load the latest) and a slightly clunkier API for manual `curl` use.
- **One schema everywhere.** The browser, file import, app server and service all run
  `parseConfigurationDocument()`, so the layers cannot drift and their error messages match. The
  cost is Zod in the client bundle (the editor chunk is about 36 KB gzipped).
- **The draft holds raw input.** Typing `#12` produces an inline error instead of being rejected or
  swallowed, and errors are keyed by section and image id, so they move with their section. The
  cost: the preview can never trust the draft. Colors and URLs are re-checked before they reach a
  `style` or `href`, and Save and Export wait for a valid draft.
- **A fixed configuration id chosen on the server** (`home`); `POST` accepts an optional proposed
  id. Every reload of `/` restores the same screen without redirects or cookies, and the browser
  can never choose which configuration gets written. Supporting multiple configurations would mean
  deriving the id from the signed-in merchant.
- **Platform features over libraries.** CSS scroll-snap instead of a carousel plugin, move buttons
  instead of drag-and-drop: no dependencies, server-render friendly, keyboard accessible. The cost
  is no autoplay, looping or drag reordering.

## What I would improve with more time

- **Real identity.** The service key authenticates the app server, not a merchant. Next would be
  sessions, per-merchant authorization in the loader and action, tenant-scoped queries, and CSRF
  tokens once cookies exist.
- **A Playwright smoke test** of edit → save → reload against both real processes (today: component
  tests plus manual browser runs).
- **Editing ergonomics:** undo/redo (the reducer is pure, so a history stack is cheap),
  drag-and-drop with the move buttons as the accessible fallback, and image reordering.
- **Draft versus published.** Saving currently means live; a publish step with immutable versions
  would let the mobile app read from a cache while editing stays private.
- **Operations:** request ids correlated across both servers' logs, API key rotation, Postgres for
  multiple instances, and `zod/mini` to shrink the client bundle.
