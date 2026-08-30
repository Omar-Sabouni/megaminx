import { expect, test } from "@playwright/test";

test("puzzle controls, history, and paused word replay work without page errors", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Megaminx" })).toBeVisible();
  await expect(
    page.locator('canvas[role="img"], #sceneFallback:not([hidden])'),
  ).toBeVisible();
  await expect(page.locator("#currentState")).toHaveText("[1, 2, 3, 4, 5]");

  await page.locator('[data-move="F"]').click();
  await expect(page.locator("#currentState")).not.toHaveText("[1, 2, 3, 4, 5]");
  await page.locator("#undoButton").click();
  await expect(page.locator("#currentState")).toHaveText("[1, 2, 3, 4, 5]");
  await page.locator("#redoButton").click();
  await expect(page.locator("#moveLog li")).toHaveCount(1);

  await page.locator("#wordInput").fill("S F");
  await expect(page.locator("#wordPreview")).toContainText("2 moves");
  const beforeReplay = await page.locator("#currentState").textContent();
  await page.locator("#replayWordButton").click();
  await expect(page.locator("#playbackPanel")).toBeVisible();
  await expect(page.locator("#playbackProgress")).toContainText("Step 0/2");
  await expect(page.locator("#currentState")).toHaveText(beforeReplay ?? "");
  await page.locator("#exitPlaybackButton").click();

  const stateBeforeHelp = await page.locator("#currentState").textContent();
  await page.locator("#referenceDetails > summary").click();
  await expect(page.locator("#referenceDetails")).toHaveAttribute("open", "");
  await expect(page.locator("#currentState")).toHaveText(stateBeforeHelp ?? "");
  expect(page.url()).not.toContain("#reference");

  expect(pageErrors).toEqual([]);
});
