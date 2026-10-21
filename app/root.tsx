import type { ReactNode } from "react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";

/**
 * Document links shared by every page.
 *
 * @returns Link descriptors.
 */
export const links: Route.LinksFunction = () => [
  // An inline SVG favicon avoids a 404 on every page load.
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

/**
 * The HTML document shell, used for both normal pages and error pages.
 *
 * @param props - Page content.
 * @returns The document.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-slate-100 text-slate-900 antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Root route component.
 *
 * @returns The matched child route.
 */
export default function App() {
  // The editor is the only page; all behavior lives in routes/editor.tsx.
  return <Outlet />;
}

/**
 * Fallback for errors no route handled (including unknown URLs).
 *
 * @param props - The thrown error.
 * @returns The error page.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // Unknown URLs get a friendly 404; anything else is a generic failure.
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-3 px-6">
      <h1 className="text-xl font-semibold">{notFound ? "Page not found" : "Something went wrong"}</h1>
      <p className="text-slate-600">{notFound ? "There is nothing at this address." : "An unexpected error occurred."}</p>
      {import.meta.env.DEV && error instanceof Error && <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{error.stack}</pre>}
      <a href="/" className="font-medium text-indigo-600 hover:underline">
        Back to the editor
      </a>
    </main>
  );
}
