import { expect, test } from "@playwright/test";

test("analysis is non-mutating until explicit solution playback", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#stateInput").fill("[5, 1, 2, 3, 4]");
  await page
    .locator("#stateForm")
    .getByRole("button", { name: "Load state" })
    .click();
  await expect(page.locator("#currentState")).toHaveText("[5, 1, 2, 3, 4]");

  await page.locator("#solveButton").click();
  await expect(page.locator("#solutionDepth")).toHaveText("1");
  await expect(page.locator("#currentState")).toHaveText("[5, 1, 2, 3, 4]");
  const layerRows = page.locator("#histogramTableBody tr");
  await expect(layerRows).toHaveCount(10);
  await expect(layerRows.locator("td:first-of-type")).toHaveText([
    "1",
    "4",
    "10",
    "24",
    "56",
    "129",
    "247",
    "320",
    "150",
    "19",
  ]);
  await expect(page.locator(".layer-bar-wrap")).toHaveCount(10);
  await expect(page.locator('[data-depth="1"] .layer-bar.goal')).toBeVisible();
  await expect(page.locator("#histogramCaption")).toContainText(
    "960 positions",
  );
  await expect(page.locator("#analysisStatus")).toContainText(
    "Solved in 1 move",
  );
  await expect(page.locator('[data-path-index="0"]')).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.locator('[data-path-index="1"]')).toBeEnabled();

  await page.locator("#playSolutionButton").click();
  await expect(page.locator("#currentState")).toHaveText("[1, 2, 3, 4, 5]");
  await expect(page.locator("#playPauseButton")).toHaveText("Replay");
});

test("a structurally valid unreachable state remains analyzable", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#stateInput").fill("[1', 2, 3, 4, 5]");
  await page
    .locator("#stateForm")
    .getByRole("button", { name: "Load state" })
    .click();
  await expect(page.locator("#globalStatus")).toContainText(
    "unreachable component",
  );
  await page.locator("#solveButton").click();
  await expect(page.locator("#analysisStatus")).toContainText(
    "Component mismatch",
  );
  await expect(page.locator("#solutionDepth")).toHaveText("—");
  await expect(page.locator("#histogramCaption")).toContainText(
    "960 positions",
  );
});
