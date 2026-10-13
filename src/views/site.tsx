import type { Context } from "hono";
import type { Child } from "hono/jsx";
import type { NavItem, PageRow } from "../db";
import { normalizeDelta, renderDelta } from "../richtext";
import { THEMES, type ThemeId, currentTheme } from "../themes";
import type { Module } from "../validate";

/** Per-request details every public page needs: the visitor's theme and the current path. */
export function siteContext(c: Context): { theme: ThemeId; path: string } {
  return { theme: currentTheme(c), path: c.req.path };
}

interface SiteLayoutProps {
  title: string;
  nav: NavItem[];
  currentId?: number;
  theme: ThemeId;
  path: string;
  children: Child;
}

export function SiteLayout({ title, nav, currentId, theme, path, children }: SiteLayoutProps) {
  return (
    <html lang="en" data-theme={theme}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href="/assets/site.css" />
        <script src="/assets/site.js" defer></script>
      </head>
      <body>
        <header class="site-header">
          <div class="site-header-inner">
            <nav class="site-nav" aria-label="Main">
              <ul>
                {nav.map((item, index) => (
                  <li>
                    <a
                      href={index === 0 ? "/" : `/${item.slug}`}
                      aria-current={item.id === currentId ? "page" : undefined}
                    >
                      {item.nav_title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <ThemePicker theme={theme} path={path} />
          </div>
        </header>
        <main class="site-main">{children}</main>
      </body>
    </html>
  );
}

/**
 * The navbar's theme button. Clicking it pops out a 3×3 grid of themes, each
 * drawn in its own colors; picking one applies it and closes the grid. Works
 * without JavaScript too (the form posts to /theme and the page reloads).
 */
function ThemePicker({ theme, path }: { theme: ThemeId; path: string }) {
  return (
    <details class="theme-picker">
      <summary class="theme-button" title="Change the color theme">
        <svg
          class="theme-icon"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
          <circle cx="7.5" cy="10.5" r="1" />
          <circle cx="10.5" cy="7" r="1" />
          <circle cx="15" cy="7.5" r="1" />
        </svg>
        <span class="theme-button-label">Theme</span>
      </summary>
      <form class="theme-menu" method="post" action="/theme">
        <p class="theme-menu-title" id="theme-menu-title">
          Color theme
        </p>
        <input type="hidden" name="return" value={path} />
        <div class="theme-grid" role="group" aria-labelledby="theme-menu-title">
          {THEMES.map((option) => (
            <button
              type="submit"
              name="theme"
              value={option.id}
              class="theme-option"
              data-theme={option.id}
              aria-pressed={option.id === theme ? "true" : "false"}
            >
              <span class="theme-swatch" aria-hidden="true">
                <span class="theme-swatch-bar">
                  <span class="theme-swatch-dot"></span>
                </span>
                <span class="theme-swatch-text">Aa</span>
              </span>
              <span class="theme-name">{option.name}</span>
            </button>
          ))}
        </div>
        <p class="theme-menu-note">Your choice is saved in a cookie on this device.</p>
      </form>
    </details>
  );
}

function ModuleView({ module }: { module: Module }) {
  switch (module.type) {
    case "text":
      return (
        <div
          class="module-text rich-text"
          dangerouslySetInnerHTML={{ __html: renderDelta(normalizeDelta(module.data.delta)) }}
        />
      );
    case "image":
      return (
        <figure class="module-image">
          <img src={`/media/${module.data.key}`} alt={module.data.alt} loading="lazy" decoding="async" />
          {module.data.caption ? <figcaption>{module.data.caption}</figcaption> : null}
        </figure>
      );
  }
}

export function PageView({ page, modules }: { page: PageRow; modules: Module[] }) {
  return (
    <article class="page">
      <h1 class="page-title">{page.page_title}</h1>
      {modules.map((module) => (
        <ModuleView module={module} />
      ))}
    </article>
  );
}

export function MessageView({ title, message }: { title: string; message: string }) {
  return (
    <article class="page page-message">
      <h1 class="page-title">{title}</h1>
      <p>{message}</p>
    </article>
  );
}
