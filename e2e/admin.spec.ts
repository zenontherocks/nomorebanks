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

  // Create the home page with one of each module type.
  await page.getByRole("link", { name: "+ New page" }).click();
  await page.getByLabel("Page title").fill("Welcome to the site");
  await page.getByLabel("Navbar title").fill("Home Page");
  await expect(page.locator(".slug-field input")).toHaveValue("home-page");

  await page.getByRole("button", { name: "+ Main header" }).click();
  await page.getByPlaceholder("Main header text").fill("Hello there");

  await page.getByRole("button", { name: "+ Text" }).click();
  const editor = page.locator(".ql-editor").last();
  await editor.click();
  await page.keyboard.type("This paragraph has ");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("bold words");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" in it.");
  // Tab leaves the editor instead of typing a tab character.
  await page.keyboard.press("Tab");
  await expect(editor).not.toBeFocused();
  await expect(editor).toHaveText("This paragraph has bold words in it.");

  await page.getByRole("button", { name: "+ Subsection header" }).click();
  await page.getByPlaceholder("Subsection header text").fill("Details");

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

  // Drag the subsection header above the text module.
  const cards = page.locator(".module-card");
  await dragAbove(page, cards.nth(2).locator(".drag-handle"), cards.nth(1));
  await expect(cards.locator(".module-label")).toHaveText(["Main header", "Subsection header", "Text", "Image"]);

  // The arrow buttons reorder too: move the image above the text, then back.
  await imageCard.getByRole("button", { name: "Move up" }).click();
  await expect(cards.locator(".module-label")).toHaveText(["Main header", "Subsection header", "Image", "Text"]);
  await imageCard.getByRole("button", { name: "Move down" }).click();

  await page.getByRole("button", { name: "Save page" }).click();
  await expect(page.getByText("Page saved")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit page" })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-editor.png", fullPage: true });

  // The public page shows the modules in the arranged order.
  await page.goto("/");
  await expect(page).toHaveTitle("Welcome to the site");
  const content = page.locator("article.page > *");
  await expect(content.nth(0)).toHaveText("Welcome to the site");
  await expect(content.nth(1)).toHaveText("Hello there");
  await expect(content.nth(2)).toHaveText("Details");
  await expect(content.nth(3)).toHaveText("This paragraph has bold words in it.");
  await expect(content.nth(3).locator("strong")).toHaveText("bold words");
  await expect(content.nth(4).locator("img")).toHaveAttribute("alt", "sunset gradient");
  await expect(content.nth(4).locator("img")).toHaveJSProperty("complete", true);
  expect(await content.nth(4).locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/public-page.png", fullPage: true });

  // A second page appears in the navbar; dragging it first makes it the home page.
  await page.goto("/admin#/pages/new");
  await page.getByLabel("Page title").fill("About this site");
  await page.getByLabel("Navbar title").fill("About");
  await page.getByRole("button", { name: "+ Main header" }).click();
  await page.getByPlaceholder("Main header text").fill("Who we are");
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
  await page.getByRole("button", { name: "+ Main header" }).click();
  await page.getByRole("button", { name: "Save page" }).click();
  await expect(page.getByRole("alert")).toHaveText("Main header module #1 is empty.");

  // Edits typed while a (slow) save is in flight still count as unsaved afterwards.
  await page.getByPlaceholder("Main header text").fill("Saved text");
  await page.route("**/api/pages", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.getByRole("button", { name: "Save page" }).click();
  await page.getByPlaceholder("Main header text").fill("Typed during the save");
  await expect(page.getByText("Page saved")).toBeVisible();
  await expect(page.getByPlaceholder("Main header text")).toHaveValue("Typed during the save");

  let prompted = false;
  page.once("dialog", (dialog) => {
    prompted = true;
    return dialog.dismiss();
  });
  await page.getByRole("link", { name: "← All pages" }).click();
  await expect.poll(() => prompted).toBe(true);
  await expect(page.getByRole("heading", { name: "Edit page" })).toBeVisible();
});
