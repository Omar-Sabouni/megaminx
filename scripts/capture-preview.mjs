import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const previewUrl =
  process.env.MEGAMINX_PREVIEW_URL ?? "http://127.0.0.1:44731/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
});

await page.goto(previewUrl, { waitUntil: "networkidle" });
await page.locator("#stateInput").fill("[5, 1, 2, 3, 4]");
await page
  .locator("#stateForm")
  .getByRole("button", { name: "Load state" })
  .click();
await page.locator("#solveButton").click();
await page.locator("#solutionDepth").getByText("1").waitFor();
await page.addStyleTag({
  content:
    "html { scroll-behavior: auto !important; } .app-bar { position: static !important; }",
});
const documentHeight = await page.evaluate(() => {
  document.querySelector(".skip-link")?.setAttribute("hidden", "");
  window.scrollTo(0, 0);
  return document.documentElement.scrollHeight;
});
await page.setViewportSize({ width: 1440, height: documentHeight });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(250);
await page.screenshot({
  path: resolve("docs/megaminx-lab.png"),
  fullPage: false,
});

await browser.close();
