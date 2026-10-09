// Copies the admin console's browser libraries from node_modules into
// public/assets/admin/vendor so the site needs no build step or CDN.
// Run `npm run vendor` after upgrading quill or sortablejs, then commit.
import { copyFileSync, mkdirSync } from "node:fs";

const dest = "public/assets/admin/vendor";
mkdirSync(dest, { recursive: true });

const files = [
  ["node_modules/quill/dist/quill.js", "quill.js"],
  ["node_modules/quill/dist/quill.snow.css", "quill.snow.css"],
  ["node_modules/quill/LICENSE", "quill.LICENSE.txt"],
  ["node_modules/quill/dist/quill.js.LICENSE.txt", "quill.js.LICENSE.txt"],
  ["node_modules/sortablejs/Sortable.min.js", "Sortable.min.js"],
  ["node_modules/sortablejs/LICENSE", "Sortable.LICENSE.txt"],
];

for (const [from, to] of files) {
  copyFileSync(from, `${dest}/${to}`);
  console.log(`copied ${from} -> ${dest}/${to}`);
}
