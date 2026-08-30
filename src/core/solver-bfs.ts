import { applyMove, cloneState, MOVES, serialize } from "./moves";
import type { EdgeState, Move, SolveResult } from "./types";

interface ParentLink {
  prev: string;
  move: Move;
}

export interface BfsOptions {
  maxNodes?: number;
}

export const findShortestWord = (
  start: EdgeState,
  goal: EdgeState,
  options: BfsOptions = {},
): SolveResult => {
  const startKey = serialize(start);
  const goalKey = serialize(goal);
  const maxNodes = options.maxNodes ?? 20000;

  if (startKey === goalKey) {
    return { reachable: true, word: [], depth: 0 };
  }

  const queue: EdgeState[] = [cloneState(start)];
  let head = 0;
  const visited = new Set<string>([startKey]);
  const parents = new Map<string, ParentLink>();

  while (head < queue.length) {
    if (visited.size > maxNodes) {
      return {
        reachable: false,
        reason: `Search aborted after exceeding max node limit (${maxNodes}).`,
      };
    }

    const current = queue[head];
    head += 1;
    const currentKey = serialize(current);

    for (const move of MOVES) {
      const next = applyMove(current, move);
      const key = serialize(next);
      if (visited.has(key)) {
        continue;
      }

      visited.add(key);
      parents.set(key, { prev: currentKey, move });

      if (key === goalKey) {
        const word: Move[] = [];
        let trace = goalKey;
        while (trace !== startKey) {
          const link = parents.get(trace);
          if (!link) {
            break;
          }
          word.push(link.move);
          trace = link.prev;
        }
        word.reverse();
        return { reachable: true, word, depth: word.length };
      }

      queue.push(next);
    }
  }

  return {
    reachable: false,
    reason:
      "No path exists between start and goal in the generated F/S state graph.",
  };
};
