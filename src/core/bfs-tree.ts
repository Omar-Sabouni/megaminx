import { applyMove, cloneState, formatState, MOVES, serialize } from "./moves";
import type {
  BfsTreeLayer,
  BfsTreeNode,
  BfsTreeResult,
  EdgeState,
  Move,
} from "./types";

interface ParentLink {
  prev: string;
  move: Move;
}

export interface BfsTreeOptions {
  maxDepth: number;
  maxNodes?: number;
}

const buildPathToRoot = (
  parents: Map<string, ParentLink>,
  key: string,
  rootKey: string,
): string[] => {
  const reversedPath: string[] = [];
  let trace: string | undefined = key;
  while (trace) {
    reversedPath.push(trace);
    if (trace === rootKey) {
      break;
    }
    trace = parents.get(trace)?.prev;
  }
  reversedPath.reverse();
  return reversedPath[0] === rootKey ? reversedPath : [];
};

export const buildBfsTree = (
  root: EdgeState,
  current: EdgeState,
  options: BfsTreeOptions,
): BfsTreeResult => {
  const maxDepth = Math.max(0, options.maxDepth);
  const maxNodes = options.maxNodes ?? 20000;
  const rootKey = serialize(root);
  const currentKey = serialize(current);

  const visited = new Set<string>();
  const parents = new Map<string, ParentLink>();
  const depths = new Map<string, number>();
  const states = new Map<string, EdgeState>();
  const layerCounts = new Map<number, number>();

  const queue: EdgeState[] = [cloneState(root)];
  let head = 0;

  visited.add(rootKey);
  depths.set(rootKey, 0);
  states.set(rootKey, cloneState(root));
  layerCounts.set(0, 1);

  while (head < queue.length) {
    if (visited.size > maxNodes) {
      break;
    }

    const state = queue[head];
    head += 1;
    const stateKey = serialize(state);
    const depth = depths.get(stateKey) ?? 0;

    for (const move of MOVES) {
      const next = applyMove(state, move);
      const key = serialize(next);
      if (visited.has(key)) {
        continue;
      }

      const nextDepth = depth + 1;
      visited.add(key);
      parents.set(key, { prev: stateKey, move });
      depths.set(key, nextDepth);
      states.set(key, cloneState(next));
      layerCounts.set(nextDepth, (layerCounts.get(nextDepth) ?? 0) + 1);
      queue.push(next);
    }
  }

  const depthByKey: Record<string, number> = {};
  const parentByKey: BfsTreeResult["parentByKey"] = {};
  const stateLabelByKey: Record<string, string> = {};
  let maxObservedDepth = 0;
  for (const [key, depth] of depths) {
    depthByKey[key] = depth;
    const parent = parents.get(key);
    parentByKey[key] = {
      prev: parent?.prev ?? null,
      move: parent?.move ?? null,
    };
    const state = states.get(key);
    if (state) {
      stateLabelByKey[key] = formatState(state);
    }
    if (depth > maxObservedDepth) {
      maxObservedDepth = depth;
    }
  }

  const nodes: BfsTreeNode[] = [];
  for (const [key, depth] of depths) {
    if (depth > maxDepth) {
      continue;
    }

    const parent = parents.get(key);
    const state = states.get(key);
    if (!state) {
      continue;
    }

    nodes.push({
      key,
      depth,
      parentKey: parent?.prev ?? null,
      moveFromParent: parent?.move ?? null,
      stateLabel: stateLabelByKey[key] ?? formatState(state),
    });
  }
  nodes.sort((a, b) =>
    a.depth !== b.depth ? a.depth - b.depth : a.key.localeCompare(b.key),
  );

  const layers: BfsTreeLayer[] = [];
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const count = layerCounts.get(depth) ?? 0;
    layers.push({
      depth,
      count,
      renderedCount: count,
    });
  }

  let deeperNodeCount = 0;
  for (let depth = maxDepth + 1; depth <= maxObservedDepth; depth += 1) {
    deeperNodeCount += layerCounts.get(depth) ?? 0;
  }

  const currentDepth = depths.get(currentKey) ?? null;
  const currentInComponent = currentDepth !== null;
  const pathToCurrent = currentInComponent
    ? buildPathToRoot(parents, currentKey, rootKey)
    : [];

  let renderedAncestorKey: string | null = null;
  if (currentInComponent) {
    if (currentDepth <= maxDepth) {
      renderedAncestorKey = currentKey;
    } else {
      for (const key of pathToCurrent) {
        const depth = depthByKey[key];
        if (depth <= maxDepth) {
          renderedAncestorKey = key;
        } else {
          break;
        }
      }
    }
  }

  return {
    rootKey,
    maxRenderedDepth: maxDepth,
    hasDeeperNodes: deeperNodeCount > 0,
    deeperNodeCount,
    totalVisited: visited.size,
    nodes,
    layers,
    depthByKey,
    parentByKey,
    stateLabelByKey,
    currentKey,
    currentDepth,
    currentInComponent,
    renderedAncestorKey,
    pathToCurrent,
  };
};
