import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url);
const ASSETS = new URL("assets/", DIST);
const limits = {
  clientJavaScript: 165 * 1024,
  workerJavaScript: 8 * 1024,
  css: 12 * 1024,
};

const files = await readdir(ASSETS);
const sizeGzip = async (name) =>
  gzipSync(await readFile(new URL(name, ASSETS))).byteLength;
const workerFiles = files.filter((name) => /^solverWorker-.*\.js$/u.test(name));
const clientFiles = files.filter(
  (name) => name.endsWith(".js") && !workerFiles.includes(name),
);
const cssFiles = files.filter((name) => name.endsWith(".css"));

if (workerFiles.length !== 1) {
  throw new Error(
    `Expected exactly one solver worker asset; found ${workerFiles.length}.`,
  );
}

const sum = async (names) => {
  const sizes = await Promise.all(names.map(sizeGzip));
  return sizes.reduce((total, size) => total + size, 0);
};

const totals = {
  clientJavaScript: await sum(clientFiles),
  workerJavaScript: await sum(workerFiles),
  css: await sum(cssFiles),
};

const html = await readFile(join(DIST.pathname, "index.html"), "utf8");
if (html.includes("/src/main.ts")) {
  throw new Error("Production HTML still references /src/main.ts.");
}

for (const [kind, size] of Object.entries(totals)) {
  const limit = limits[kind];
  if (size > limit) {
    throw new Error(`${kind} is ${size} gzip bytes; budget is ${limit}.`);
  }
}

const kib = (bytes) => `${(bytes / 1024).toFixed(2)} KiB gzip`;
console.log(
  `Bundle budgets pass: client JS ${kib(totals.clientJavaScript)}, worker ${kib(totals.workerJavaScript)}, CSS ${kib(totals.css)}.`,
);
