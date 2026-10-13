// Theme picker: apply the chosen theme instantly instead of reloading the page.
// Without JavaScript the picker's form posts to /theme, which sets the same
// cookie (see src/themes.ts) and reloads.
const picker = document.querySelector(".theme-picker");

if (picker) {
  const summary = picker.querySelector("summary");
  const form = picker.querySelector("form");

  const close = ({ refocus }) => {
    picker.open = false;
    if (refocus) summary.focus();
  };

  form.addEventListener("submit", (event) => {
    const option = event.submitter;
    if (!option || option.name !== "theme") return; // older browsers: let the form post
    event.preventDefault();

    const theme = option.value;
    document.documentElement.dataset.theme = theme;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `nmb_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    for (const button of form.querySelectorAll('button[name="theme"]')) {
      button.setAttribute("aria-pressed", String(button === option));
    }
    close({ refocus: true });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && picker.open) close({ refocus: true });
  });

  document.addEventListener("click", (event) => {
    if (picker.open && !picker.contains(event.target)) close({ refocus: false });
  });
}
