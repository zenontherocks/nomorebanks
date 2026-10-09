import type { Child } from "hono/jsx";
import type { NavItem, PageRow } from "../db";
import { normalizeDelta, renderDelta } from "../richtext";
import type { Module } from "../validate";

interface SiteLayoutProps {
  title: string;
  nav: NavItem[];
  currentId?: number;
  children: Child;
}

export function SiteLayout({ title, nav, currentId, children }: SiteLayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href="/assets/site.css" />
      </head>
      <body>
        {nav.length > 0 && (
          <header class="site-header">
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
          </header>
        )}
        <main class="site-main">{children}</main>
      </body>
    </html>
  );
}

function ModuleView({ module }: { module: Module }) {
  switch (module.type) {
    case "heading":
      return <h2 class="module-heading">{module.data.text}</h2>;
    case "subheading":
      return <h3 class="module-subheading">{module.data.text}</h3>;
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
