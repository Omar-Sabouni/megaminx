import type { EdgeState } from "./types";
import { assertEdgeState } from "./moves";

const inversionParity = (values: readonly number[]): 0 | 1 => {
  let inversions = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i] > values[j]) {
        inversions += 1;
      }
    }
  }
  return (inversions % 2) as 0 | 1;
};

export const orientationParity = (state: EdgeState): 0 | 1 => {
  assertEdgeState(state);
  return (state.filter((edge) => edge.flipped).length % 2) as 0 | 1;
};

export const permutationParity = (state: EdgeState): 0 | 1 => {
  assertEdgeState(state);
  return inversionParity(state.map((edge) => edge.id));
};

export interface InvariantSummary {
  readonly orientationParity: 0 | 1;
  readonly permutationParity: 0 | 1;
}

export const analyzeInvariants = (state: EdgeState): InvariantSummary => ({
  orientationParity: orientationParity(state),
  permutationParity: permutationParity(state),
});

export const invariantComponentKey = (state: EdgeState): string => {
  const summary = analyzeInvariants(state);
  return `${summary.orientationParity}:${summary.permutationParity}`;
};
