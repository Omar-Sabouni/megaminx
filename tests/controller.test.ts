// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchPuzzle } from "../src/core/search";
import type { EdgeState } from "../src/core/types";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";

vi.mock("../src/services/search-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/services/search-client")>();
  return {
    ...original,
    SearchClient: class {
      active = false;
      search(
        _puzzle: typeof TOP_LAYER_EDGES,
        start: EdgeState,
        goal: EdgeState,
      ) {
        this.active = true;
        return searchPuzzle(TOP_LAYER_EDGES, start, goal).finally(() => {
          this.active = false;
        });
      }
      cancel() {}
      dispose() {}
    },
  };
});

vi.mock("../src/ui/scene", () => ({
  TopLayerScene: class {
    available = true;
    async setState() {}
    resetView() {}
    dispose() {}
  },
}));

import { MegaminxApp } from "../src/app/controller";

const click = (selector: string): void => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  element.click();
};

describe("application controller", () => {
  let app: MegaminxApp;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    window.history.replaceState(null, "", "/");
    app = new MegaminxApp(document.querySelector<HTMLElement>("#app")!);
  });

  afterEach(() => {
    app.dispose();
    vi.restoreAllMocks();
  });

  it("shows a solution without mutating state until Play solution", async () => {
    click('[data-move="S"]');
    await vi.waitFor(() =>
      expect(document.querySelector("#currentState")?.textContent).not.toBe(
        "[1, 2, 3, 4, 5]",
      ),
    );
    const scrambled = document.querySelector("#currentState")?.textContent;

    click("#solveButton");
    await vi.waitFor(() =>
      expect(document.querySelector("#solutionDepth")?.textContent).toBe("1"),
    );
    expect(document.querySelector("#currentState")?.textContent).toBe(
      scrambled,
    );
    expect(document.querySelector("#histogramCaption")?.textContent).toContain(
      "960 positions",
    );
    expect(
      Array.from(
        document.querySelectorAll("#histogramTableBody td:first-of-type"),
      ).map((cell) => cell.textContent),
    ).toEqual(["1", "4", "10", "24", "56", "129", "247", "320", "150", "19"]);
    expect(document.querySelectorAll(".layer-bar-wrap")).toHaveLength(10);
    expect(
      document.querySelector('[data-depth="1"] .layer-bar.goal'),
    ).not.toBeNull();
  });

  it("loads structurally valid unreachable states and analyzes the mismatch", async () => {
    const input = document.querySelector<HTMLInputElement>("#stateInput")!;
    input.value = "[1', 2, 3, 4, 5]";
    document.querySelector<HTMLFormElement>("#stateForm")!.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("#currentState")?.textContent).toBe(
        "[1', 2, 3, 4, 5]",
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#globalStatus")?.textContent).toContain(
        "unreachable component",
      ),
    );

    click("#solveButton");
    await vi.waitFor(() =>
      expect(document.querySelector("#analysisStatus")?.textContent).toContain(
        "Component mismatch",
      ),
    );
    expect(document.querySelector("#solutionDepth")?.textContent).toBe("—");
  });

  it("previews a word without mutation and applies it with per-move history", async () => {
    const word = document.querySelector<HTMLTextAreaElement>("#wordInput")!;
    word.value = "S F";
    word.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#wordPreview")?.textContent).toContain(
      "2 moves",
    );
    expect(document.querySelector("#currentState")?.textContent).toBe(
      "[1, 2, 3, 4, 5]",
    );

    document.querySelector<HTMLFormElement>("#wordForm")!.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#moveLog li")).toHaveLength(2),
    );
    expect(document.querySelector("#currentState")?.textContent).toBe(
      "[1', 2, 5', 3, 4]",
    );
  });

  it("opens notation help without treating the section as a shared session", async () => {
    click('[data-move="S"]');
    await vi.waitFor(() =>
      expect(document.querySelector("#currentState")?.textContent).not.toBe(
        "[1, 2, 3, 4, 5]",
      ),
    );
    const state = document.querySelector("#currentState")?.textContent;

    click("#referenceDetails > summary");

    expect(
      document.querySelector<HTMLDetailsElement>("#referenceDetails")?.open,
    ).toBe(true);
    expect(document.querySelector("#currentState")?.textContent).toBe(state);
    expect(window.location.hash).not.toBe("#reference");
  });

  it("shares edited scramble inputs even before generating a scramble", async () => {
    const seed = document.querySelector<HTMLInputElement>("#seedInput")!;
    const length = document.querySelector<HTMLInputElement>("#scrambleLength")!;
    seed.value = "draft-seed";
    seed.dispatchEvent(new Event("input", { bubbles: true }));
    length.value = "7";
    length.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(window.location.hash).toContain("seed=draft-seed");
      expect(window.location.hash).toContain("len=7");
    });
  });

  it("lets keyboard users load and seek the exact solution path", async () => {
    const input = document.querySelector<HTMLInputElement>("#stateInput")!;
    input.value = "[5, 1, 2, 3, 4]";
    document.querySelector<HTMLFormElement>("#stateForm")!.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("#currentState")?.textContent).toBe(
        "[5, 1, 2, 3, 4]",
      ),
    );
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>("#solveButton")?.disabled,
      ).toBe(false),
    );
    click("#solveButton");
    await vi.waitFor(() =>
      expect(document.querySelector("#solutionDepth")?.textContent).toBe("1"),
    );

    const target = document.querySelector<HTMLButtonElement>(
      '[data-path-index="1"]',
    )!;
    expect(target.disabled).toBe(false);
    target.focus();
    target.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#currentState")?.textContent).toBe(
        "[1, 2, 3, 4, 5]",
      ),
    );
    await vi.waitFor(() => {
      const current = document.querySelector<HTMLButtonElement>(
        '[data-path-index="1"]',
      );
      expect(current?.getAttribute("aria-current")).toBe("step");
      expect(document.activeElement).toBe(current);
    });
  });

  it("keeps direct manipulation available while analysis is running", async () => {
    click("#solveButton");
    const move = document.querySelector<HTMLButtonElement>('[data-move="F"]')!;
    expect(move.disabled).toBe(false);

    move.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#currentState")?.textContent).not.toBe(
        "[1, 2, 3, 4, 5]",
      ),
    );
    expect(document.querySelector<HTMLElement>("#analysisResult")?.hidden).toBe(
      true,
    );
  });
});
