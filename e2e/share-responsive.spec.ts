import { expect, test } from "@playwright/test";

test("seeded scramble and fragment session round-trip", async ({ page }) => {
  await page.goto("/");
  await page.locator("#seedInput").fill("lab-0001");
  await page.locator("#scrambleLength").fill("6");
  await page
    .locator("#scrambleForm")
    .getByRole("button", { name: "Scramble from solved" })
    .click();
  await expect(page.locator("#scrambleWord")).not.toHaveText(
    "No scramble generated.",
  );
  const state = await page.locator("#currentState").textContent();

  await expect.poll(() => page.url()).toContain("seed=lab-0001");
  await page.reload();
  await expect(page.locator("#currentState")).toHaveText(state ?? "");
  await expect(page.locator("#seedInput")).toHaveValue("lab-0001");
  await expect(page.locator("#scrambleLength")).toHaveValue("6");

  await page.locator("#seedInput").fill("draft-only");
  await page.locator("#scrambleLength").fill("9");
  await expect.poll(() => page.url()).toContain("seed=draft-only");
  await expect.poll(() => page.url()).toContain("len=9");
  await expect(page.locator("#currentState")).toHaveText(state ?? "");

  await page.goto("/#v=1&p=top-layer-edges&state=bad");
  await expect(page.locator("#currentState")).toHaveText("[1, 2, 3, 4, 5]");
  await expect(page.locator("#globalStatus")).toContainText(
    "Shared state is invalid",
  );
});

test("mobile reflow has no page overflow and shortcuts ignore editors", async ({
  page,
}) => {
  const paneBoxes = async () => {
    const puzzle = await page
      .locator('[aria-labelledby="puzzleHeading"]')
      .boundingBox();
    const commands = await page
      .locator('[aria-labelledby="controlsHeading"]')
      .boundingBox();
    const analysis = await page
      .locator('[aria-labelledby="analysisHeading"]')
      .boundingBox();
    expect(puzzle).not.toBeNull();
    expect(commands).not.toBeNull();
    expect(analysis).not.toBeNull();
    return { puzzle: puzzle!, commands: commands!, analysis: analysis! };
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const desktop = await paneBoxes();
  expect(desktop.commands.x).toBeGreaterThanOrEqual(
    desktop.puzzle.x + desktop.puzzle.width - 1,
  );
  expect(desktop.analysis.x).toBeGreaterThanOrEqual(
    desktop.commands.x + desktop.commands.width - 1,
  );
  expect(desktop.analysis.y).toBeCloseTo(desktop.puzzle.y, 0);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mobile = await paneBoxes();
  expect(mobile.commands.y).toBeGreaterThanOrEqual(
    mobile.puzzle.y + mobile.puzzle.height - 1,
  );
  expect(mobile.analysis.y).toBeGreaterThanOrEqual(
    mobile.commands.y + mobile.commands.height - 1,
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator("#wordInput").focus();
  await page.keyboard.type("S");
  await expect(page.locator("#currentState")).toHaveText("[1, 2, 3, 4, 5]");
  await expect(page.locator("#globalStatus")).toHaveAttribute(
    "aria-live",
    "polite",
  );

  await page.locator("#solveButton").focus();
  await expect(page.locator("#solveButton")).toBeFocused();
});
