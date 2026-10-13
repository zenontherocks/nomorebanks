// Theme picker: apply the chosen theme instantly instead of reloading the page.
// Without JavaScript the picker's form posts to /theme, which sets the same
// cookie (see src/themes.ts) and reloads.
const picker = document.querySelector(".theme-picker");

if (picker) {
  const summary = picker.querySelector("summary");
  const form = picker.querySelector("form");
  const options = [...form.querySelectorAll('button[name="theme"]')];

  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    for (const option of options) option.setAttribute("aria-pressed", String(option.value === theme));
  };

  // Pages brought back by Back/Forward (from the cache) were drawn with the theme
  // chosen at the time; switch them to the one saved since.
  const syncFromCookie = () => {
    const saved = document.cookie.match(/(?:^|; )nmb_theme=([a-z-]+)/)?.[1];
    if (saved && saved !== document.documentElement.dataset.theme && options.some((o) => o.value === saved)) {
      applyTheme(saved);
    }
  };
  syncFromCookie();
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) syncFromCookie();
  });

  const close = ({ refocus }) => {
    picker.open = false;
    if (refocus) summary.focus();
  };

  form.addEventListener("submit", (event) => {
    const option = event.submitter;
    if (!option || option.name !== "theme") return; // older browsers: let the form post
    event.preventDefault();

    applyTheme(option.value);
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `nmb_theme=${option.value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    close({ refocus: true });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && picker.open) close({ refocus: true });
  });

  document.addEventListener("click", (event) => {
    if (picker.open && !picker.contains(event.target)) close({ refocus: false });
  });

  // Tabbing out of the grid closes it, so it never covers the newly focused element.
  // (relatedTarget is null when clicking blank space inside the grid; keep it open then.)
  picker.addEventListener("focusout", (event) => {
    if (picker.open && event.relatedTarget && !picker.contains(event.relatedTarget)) close({ refocus: false });
  });
}
