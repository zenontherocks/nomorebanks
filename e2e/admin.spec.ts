import { type Locator, type Page, expect, test } from "@playwright/test";

const PASSWORD = "e2e-password";

async function makePng(page: Page): Promise<Buffer> {
  // Render a colourful block and screenshot it to get a real image to upload.
  const tmp = await page.context().newPage();
  await tmp.setContent(
    '<div id="art" style="width:480px;height:270px;background:linear-gradient(135deg,#2456d6,#2f9e6e)"></div>',
  );
  const png = await tmp.locator("#art").screenshot();
  await tmp.close();
  return png;
}

/** Chooses a value from one of a text module's toolbar menus (header, font or size). */
async function pickFormat(card: Locator, format: "header" | "font" | "size", value: string) {
  await card.locator(`.ql-${format} .ql-picker-label`).click();
  await card.locator(`.ql-${format} .ql-picker-item[data-value="${value}"]`).click();
}

async function dragAbove(page: Page, handle: Locator, target: Locator) {
  // SortableJS listens to pointer/drag events; move in small steps so it sees the drag.
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 5 });
  await page.mouse.move(to.x + 20, to.y + 5, { steps: 20 });
  await page.mouse.up();
}

test("admin creates, arranges and publishes pages", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());

  // The public site starts empty, and the admin console needs a password.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Coming soon" })).toBeVisible();
  await expect(page.locator("a[href='/admin']")).toHaveCount(0);

  await page.goto("/admin");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Incorrect password.")).toBeVisible();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();

  // Create the home page: two text modules (each with a heading and body text) and an image.
  await page.getByRole("link", { name: "+ New page" }).click();
  await page.getByLabel("Page title").fill("Welcome to the site");
  await page.getByLabel("Navbar title").fill("Home Page");
  await expect(page.locator(".slug-field input")).toHaveValue("home-page");

  const cards = page.locator(".module-card");
  await page.getByRole("button", { name: "+ Text" }).click();
  const first = cards.nth(0);
  const editor = first.locator(".ql-editor");
  // The toolbar explains its controls, including the "Tx" clear-formatting button.
  await expect(first.locator(".ql-clean")).toHaveAttribute("title", /Clear formatting/);
  await expect(first.locator(".ql-header .ql-picker-label")).toHaveAttribute("title", /Text style/);
  await editor.click();
  await pickFormat(first, "header", "2");
  await page.keyboard.type("Hello there");
  await page.keyboard.press("Enter"); // a new line after a heading is normal text again
  await page.keyboard.type("This paragraph has ");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("bold words");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" in it.");
  await expect(editor.locator("h2")).toHaveText("Hello there");
  await expect(editor.locator("p")).toHaveText("This paragraph has bold words in it.");
  // Tab leaves the editor instead of typing a tab character.
  await page.keyboard.press("Tab");
  await expect(editor).not.toBeFocused();

  await page.getByRole("button", { name: "+ Image" }).click();
  const imageCard = page.locator(".module-card.module-image");
  await imageCard.locator("input[type=file]").setInputFiles({
    name: "sunset-gradient.png",
    mimeType: "image/png",
    buffer: await makePng(page),
  });
  await expect(imageCard.getByText("Uploaded. Remember to save the page.")).toBeVisible();
  await expect(imageCard.getByLabel("Alt text")).toHaveValue("sunset gradient");
  await imageCard.getByLabel("Caption (optional)").fill("A gradient, for testing");

  await page.getByRole("button", { name: "+ Text" }).click();
  const second = cards.nth(2);
  await second.locator(".ql-editor").click();
  await pickFormat(second, "header", "3");
  await page.keyboard.type("Details");
  await page.keyboard.press("Enter");
  await pickFormat(second, "font", "georgia");
  await pickFormat(second, "size", "large");
  await page.keyboard.type("Set in Georgia, large.");
  await expect(second.locator(".ql-editor h3")).toHaveText("Details");
  await expect(second.locator(".ql-editor .ql-font-georgia.ql-size-large")).toHaveText("Set in Georgia, large.");

  // Drag the second text module above the image.
  await dragAbove(page, second.locator(".drag-handle"), imageCard);
  await expect(cards.locator(".module-label")).toHaveText(["Text", "Text", "Image"]);
  await expect(cards.nth(1).locator(".ql-editor h3")).toHaveText("Details");

  // The arrow buttons reorder too: move the image up, then back down.
  await imageCard.getByRole("button", { name: "Move up" }).click();
  await expect(cards.locator(".module-label")).toHaveText(["Text", "Image", "Text"]);
  await imageCard.getByRole("button", { name: "Move down" }).click();
  await expect(cards.locator(".module-label")).toHaveText(["Text", "Text", "Image"]);

  await page.getByRole("button", { name: "Save page" }).click();
  await expect(page.getByText("Page saved")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit page" })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-editor.png", fullPage: true });

  // The public page shows the modules, with their headings and styles, in the arranged order.
  await page.goto("/");
  await expect(page).toHaveTitle("Welcome to the site");
  const content = page.locator("article.page > *");
  await expect(content.nth(0)).toHaveText("Welcome to the site");
  await expect(content.nth(1).locator("h2")).toHaveText("Hello there");
  await expect(content.nth(1).locator("p")).toHaveText("This paragraph has bold words in it.");
  await expect(content.nth(1).locator("strong")).toHaveText("bold words");
  await expect(content.nth(2).locator("h3")).toHaveText("Details");
  const styled = content.nth(2).locator("span.rt-font-georgia.rt-size-large");
  await expect(styled).toHaveText("Set in Georgia, large.");
  await expect(styled).toHaveCSS("font-family", /Georgia/);
  await expect(content.nth(3).locator("img")).toHaveAttribute("alt", "sunset gradient");
  await expect(content.nth(3).locator("img")).toHaveJSProperty("complete", true);
  expect(await content.nth(3).locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/public-page.png", fullPage: true });

  // A second page appears in the navbar; dragging it first makes it the home page.
  await page.goto("/admin#/pages/new");
  await page.getByLabel("Page title").fill("About this site");
  await page.getByLabel("Navbar title").fill("About");
  await page.getByRole("button", { name: "+ Text" }).click();
  await page.locator(".ql-editor").click();
  await page.keyboard.type("Who we are");
  await page.getByRole("button", { name: "Save page" }).click();
  await expect(page.getByText("Page saved")).toBeVisible();

  await page.getByRole("link", { name: "← All pages" }).click();
  const items = page.locator(".page-item");
  await expect(items.locator(".page-nav-title")).toHaveText(["Home PageHome", "About"]);
  await dragAbove(page, items.nth(1).locator(".drag-handle"), items.nth(0));
  await expect(page.getByText("Navbar order saved")).toBeVisible();
  await expect(items.locator(".page-nav-title")).toHaveText(["AboutHome", "Home Page"]);
  await page.screenshot({ path: "test-results/admin-pages.png", fullPage: true });

  // The arrow buttons reorder too, and keyboard focus stays on the button that was pressed.
  const moveDown = items.filter({ hasText: "About" }).getByRole("button", { name: "Move About down" });
  await moveDown.click();
  await expect(items.locator(".page-nav-title")).toHaveText(["Home PageHome", "About"]);
  await expect(page.getByRole("button", { name: "Move About down" })).toBeFocused();
  await page.getByRole("button", { name: "Move About up" }).click();
  await expect(items.locator(".page-nav-title")).toHaveText(["AboutHome", "Home Page"]);

  await page.goto("/");
  await expect(page).toHaveTitle("About this site");
  await expect(page.locator(".site-nav a")).toHaveText(["About", "Home Page"]);
  await page.getByRole("link", { name: "Home Page" }).click();
  await expect(page).toHaveURL(/\/home-page$/);
  await expect(page.getByRole("heading", { name: "Hello there" })).toBeVisible();

  // Delete the About page; the original page becomes home again.
  await page.goto("/admin");
  await items.filter({ hasText: "About" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText('Deleted "About"')).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveTitle("Welcome to the site");

  // Logging out locks the console again.
  await page.goto("/admin");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("unsaved changes are protected when leaving the editor", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "+ New page" }).click();
  await page.getByLabel("Page title").fill("Draft");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "← All pages" }).click();
  await expect(page.getByRole("heading", { name: "New page" })).toBeVisible();

  // Saving with an empty module explains what's wrong instead of failing silently.
  await page.getByLabel("Navbar title").fill("Draft");
  await page.getByRole("button", { name: "+ Text" }).click();
  await page.getByRole("button", { name: "Save page" }).click();
  await expect(page.getByRole("alert")).toHaveText("Text module #1 is empty.");

  // Edits typed while a (slow) save is in flight still count as unsaved afterwards.
  const editor = page.locator(".ql-editor");
  await editor.click();
  await page.keyboard.type("Saved text");
  await page.route("**/api/pages", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.getByRole("button", { name: "Save page" }).click();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(", typed during the save");
  await expect(page.getByText("Page saved")).toBeVisible();
  await expect(editor).toHaveText("Saved text, typed during the save");

  let prompted = false;
  page.once("dialog", (dialog) => {
    prompted = true;
    return dialog.dismiss();
  });
  await page.getByRole("link", { name: "← All pages" }).click();
  await expect.poll(() => prompted).toBe(true);
  await expect(page.getByRole("heading", { name: "Edit page" })).toBeVisible();
});

test("toolbar controls are labelled and pasted headings fold to the site's two levels", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "+ New page" }).click();
  await page.getByRole("button", { name: "+ Text" }).click();
  const card = page.locator(".module-card").first();

  // Icon-only controls are named; the text menus are named by their current value.
  await expect(card.locator('.ql-align .ql-picker-item[data-value="center"]')).toHaveAttribute("aria-label", "Center");
  await expect(card.locator(".ql-header .ql-picker-label")).toHaveAttribute("title", /Text style/);
  await expect(card.locator(".ql-header .ql-picker-label")).not.toHaveAttribute("aria-label");

  // Headings pasted from another document become Main heading / Subheading right away.
  await card.locator(".ql-editor").click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/html", "<h1>Big title</h1><p>Body</p><h4>Small title</h4>");
    document
      .querySelector(".ql-editor")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(card.locator(".ql-editor h2")).toHaveText("Big title");
  await expect(card.locator(".ql-editor h3")).toHaveText("Small title");
  await expect(card.locator(".ql-editor h1, .ql-editor h4")).toHaveCount(0);
});
