import { analyzeInvariants, invariantComponentKey } from "./invariants";
import { SOLVED_STATE } from "./moves";
import type { EdgeState } from "./types";

/** 5! permutations times 2^5 edge-orientation assignments. */
export const TOTAL_STRUCTURALLY_VALID_STATES = 3_840;

/** F/S preserve both parity bits, producing four equally sized components. */
export const SOLVED_ORBIT_SIZE = TOTAL_STRUCTURALLY_VALID_STATES / 4;

const solvedComponentKey = invariantComponentKey(SOLVED_STATE);
const solvedInvariant = analyzeInvariants(SOLVED_STATE);

export interface ReachabilityResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly componentKey: string;
  readonly solvedComponentKey: string;
  readonly mismatches: readonly ("orientation parity" | "permutation parity")[];
}

export const areMutuallyReachable = (
  left: EdgeState,
  right: EdgeState,
): boolean => invariantComponentKey(left) === invariantComponentKey(right);

export const isInSolvedOrbit = (state: EdgeState): boolean =>
  invariantComponentKey(state) === solvedComponentKey;

/**
 * Describes component membership without declaring a structurally valid tuple
 * invalid. Callers may load any valid tuple and present this result as analysis.
 */
export const validateReachableInput = (
  state: EdgeState,
): ReachabilityResult => {
  const currentInvariant = analyzeInvariants(state);
  const componentKey = invariantComponentKey(state);
  const mismatches = [
    currentInvariant.orientationParity !== solvedInvariant.orientationParity
      ? ("orientation parity" as const)
      : null,
    currentInvariant.permutationParity !== solvedInvariant.permutationParity
      ? ("permutation parity" as const)
      : null,
  ].filter(
    (value): value is "orientation parity" | "permutation parity" =>
      value !== null,
  );

  if (mismatches.length === 0) {
    return {
      ok: true,
      componentKey,
      solvedComponentKey,
      mismatches,
    };
  }

  return {
    ok: false,
    reason: `State is outside the solved F/S component (${mismatches.join(" + ")} mismatch).`,
    componentKey,
    solvedComponentKey,
    mismatches,
  };
};
