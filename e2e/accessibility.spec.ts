import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const expectNoPageOverflow = async (page: import("@playwright/test").Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
};

test("puzzle workspace is accessible across application states", async ({
  page,
}) => {
  await page.goto("/");

  const initialScan = await new AxeBuilder({ page }).analyze();
  expect(initialScan.violations).toEqual([]);

  await page.locator("#stateInput").fill("[5, 1, 2, 3, 4]");
  await page
    .locator("#stateForm")
    .getByRole("button", { name: "Load state" })
    .click();
  await page.locator("#solveButton").click();
  await expect(page.locator("#analysisResult")).toBeVisible();

  const populatedScan = await new AxeBuilder({ page }).analyze();
  expect(populatedScan.violations).toEqual([]);
});

test("edge identity remains available as both notation and sticker color", async ({
  page,
}) => {
  await page.goto("/");

  const pieces = page.locator("#currentState .state-piece");
  await expect(pieces).toHaveText(["1", "2", "3", "4", "5"]);
  const edgeColors = await pieces.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).backgroundColor),
  );
  expect(edgeColors).toEqual([
    "rgb(204, 0, 0)",
    "rgb(0, 128, 0)",
    "rgb(0, 102, 204)",
    "rgb(255, 212, 0)",
    "rgb(128, 0, 128)",
  ]);

  for (const move of [
    "F front",
    "F′ front inverse",
    "S ring",
    "S′ ring inverse",
  ]) {
    await expect(
      page.getByRole("button", { name: move, exact: true }),
    ).toBeVisible();
  }
});

test("the workspace does not overflow supported viewports", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 375, height: 812 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expectNoPageOverflow(page);
  }
});

test("the workspace keeps controls available at 200 percent zoom", async ({
  page,
}) => {
  // At 200% browser zoom, a 1280 px display exposes a 640 CSS-pixel
  // layout viewport. Testing that viewport exercises the same reflow path.
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/");

  await expectNoPageOverflow(page);
  await expect(page.locator("#stateInput")).toBeVisible();
  await expect(page.locator("#solveButton")).toBeVisible();
  await expect(page.locator("#referenceDetails > summary")).toBeVisible();

  const clippedControls = await page
    .locator("button, input, textarea, select, summary")
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const rect = control.getBoundingClientRect();
          return (
            rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)
          );
        })
        .map((control) => control.id || control.textContent?.trim()),
    );
  expect(clippedControls).toEqual([]);
});
