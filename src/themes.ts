import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

/**
 * Color themes visitors can pick from the navbar, in the order the picker shows
 * them (a 3×3 grid). The colors live in public/assets/site.css under
 * [data-theme="<id>"]; public/assets/site.js sets the same cookie when a theme
 * is picked without reloading.
 */
export const THEMES = [
  { id: "classic", name: "Classic" },
  { id: "ocean", name: "Ocean" },
  { id: "forest", name: "Forest" },
  { id: "sand", name: "Sand" },
  { id: "lavender", name: "Lavender" },
  { id: "rose", name: "Rose" },
  { id: "midnight", name: "Midnight" },
  { id: "charcoal", name: "Charcoal" },
  { id: "dusk", name: "Dusk" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** The theme visitors see until they pick one themselves. */
export const DEFAULT_THEME: ThemeId = "classic";

export const THEME_COOKIE = "nmb_theme";
const THEME_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

/** The visitor's chosen theme, or the default. */
export function currentTheme(c: Context): ThemeId {
  const chosen = getCookie(c, THEME_COOKIE);
  return isThemeId(chosen) ? chosen : DEFAULT_THEME;
}

export function rememberTheme(c: Context, theme: ThemeId): void {
  // Not HttpOnly: the picker script updates it directly when switching themes.
  setCookie(c, THEME_COOKIE, theme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
  });
}
