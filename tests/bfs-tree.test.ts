import { describe, expect, it } from "vitest";
import { applyWord, serialize, SOLVED_STATE } from "../src/core/moves";
import { buildBfsTree } from "../src/core/bfs-tree";

describe("bfs tree", () => {
  it("builds a tree rooted at the given input and tracks current depth", () => {
    const current = applyWord(SOLVED_STATE, ["F", "S", "F"]);
    const tree = buildBfsTree(SOLVED_STATE, current, { maxDepth: 10 });

    expect(tree.rootKey).toBe(serialize(SOLVED_STATE));
    expect(tree.currentInComponent).toBe(true);
    expect(tree.currentDepth).not.toBeNull();
    expect(tree.currentDepth).toBe(3);
    expect(tree.hasDeeperNodes).toBe(false);
    expect(tree.pathToCurrent[0]).toBe(tree.rootKey);
    expect(tree.pathToCurrent[tree.pathToCurrent.length - 1]).toBe(
      tree.currentKey,
    );
  });

  it("reports truncation and rendered ancestor when max depth is small", () => {
    const current = applyWord(SOLVED_STATE, ["F", "S", "F", "S"]);
    const tree = buildBfsTree(SOLVED_STATE, current, { maxDepth: 2 });

    expect(tree.hasDeeperNodes).toBe(true);
    expect(tree.currentInComponent).toBe(true);
    expect(tree.currentDepth).not.toBeNull();
    if (tree.currentDepth !== null) {
      expect(tree.currentDepth).toBeGreaterThan(2);
    }
    expect(tree.renderedAncestorKey).not.toBeNull();
    if (tree.renderedAncestorKey) {
      expect(tree.depthByKey[tree.renderedAncestorKey]).toBe(2);
    }
  });

  it("exposes parent links and state labels for visited keys", () => {
    const current = applyWord(SOLVED_STATE, ["S", "F"]);
    const tree = buildBfsTree(SOLVED_STATE, current, { maxDepth: 10 });
    const currentKey = serialize(current);
    const link = tree.parentByKey[currentKey];
    expect(link).toBeDefined();
    expect(link.prev).not.toBeNull();
    expect(link.move).not.toBeNull();
    expect(tree.stateLabelByKey[tree.rootKey]).toBe("[1, 2, 3, 4, 5]");
    expect(tree.stateLabelByKey[currentKey]).toBe("[1', 2, 5', 3, 4]");
  });
});
