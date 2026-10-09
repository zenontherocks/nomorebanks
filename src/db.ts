import type { Module, PageInput } from "./validate";

export interface PageRow {
  id: number;
  slug: string;
  page_title: string;
  nav_title: string;
  nav_order: number;
  created_at: string;
  updated_at: string;
}

export type NavItem = Pick<PageRow, "id" | "slug" | "nav_title">;

const PAGE_COLUMNS = "id, slug, page_title, nav_title, nav_order, created_at, updated_at";

/** Pages in navbar order; the first one is the home page. */
export async function listPages(db: D1Database): Promise<PageRow[]> {
  const { results } = await db
    .prepare(`SELECT ${PAGE_COLUMNS} FROM pages ORDER BY nav_order, id`)
    .all<PageRow>();
  return results;
}

export function getPageById(db: D1Database, id: number): Promise<PageRow | null> {
  return db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ?`).bind(id).first<PageRow>();
}

export function getPageBySlug(db: D1Database, slug: string): Promise<PageRow | null> {
  return db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE slug = ?`).bind(slug).first<PageRow>();
}

export async function getModules(db: D1Database, pageId: number): Promise<Module[]> {
  const { results } = await db
    .prepare("SELECT type, data FROM modules WHERE page_id = ? ORDER BY position")
    .bind(pageId)
    .all<{ type: Module["type"]; data: string }>();
  return results.map((row) => ({ type: row.type, data: JSON.parse(row.data) }) as Module);
}

export async function slugTaken(db: D1Database, slug: string, exceptId?: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM pages WHERE slug = ? AND id != ?")
    .bind(slug, exceptId ?? 0)
    .first();
  return row !== null;
}

/** Module inserts for a page identified by a SQL expression (bound to pageParam). */
function insertModules(db: D1Database, pageIdSql: string, pageParam: string | number, modules: Module[]) {
  return modules.map((module, position) =>
    db
      .prepare(`INSERT INTO modules (page_id, position, type, data) VALUES (${pageIdSql}, ?, ?, ?)`)
      .bind(pageParam, position, module.type, JSON.stringify(module.data)),
  );
}

/** Creates a page and its modules atomically, appended to the end of the navbar. */
export async function createPage(db: D1Database, input: PageInput): Promise<PageRow> {
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO pages (slug, page_title, nav_title, nav_order, created_at, updated_at)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(nav_order), -1) + 1 FROM pages), ?, ?)`,
      )
      .bind(input.slug, input.page_title, input.nav_title, now, now),
    // The new page's id isn't known inside the batch, so look it up by its unique slug.
    ...insertModules(db, "(SELECT id FROM pages WHERE slug = ?)", input.slug, input.modules),
  ]);
  return (await getPageBySlug(db, input.slug))!;
}

/** Replaces a page's fields and its whole module list atomically. */
export async function updatePage(db: D1Database, id: number, input: PageInput): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE pages SET slug = ?, page_title = ?, nav_title = ?, updated_at = ? WHERE id = ?")
      .bind(input.slug, input.page_title, input.nav_title, new Date().toISOString(), id),
    db.prepare("DELETE FROM modules WHERE page_id = ?").bind(id),
    ...insertModules(db, "?", id, input.modules),
  ]);
}

export async function deletePage(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM modules WHERE page_id = ?").bind(id),
    db.prepare("DELETE FROM pages WHERE id = ?").bind(id),
  ]);
}

/** Sets navbar order; `ids` must list every page exactly once. */
export async function reorderPages(db: D1Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id, index) => db.prepare("UPDATE pages SET nav_order = ? WHERE id = ?").bind(index, id)),
  );
}

export async function referencedImageKeys(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT json_extract(data, '$.key') AS key FROM modules WHERE type = 'image'")
    .all<{ key: string | null }>();
  return new Set(results.flatMap((row) => (row.key ? [row.key] : [])));
}
