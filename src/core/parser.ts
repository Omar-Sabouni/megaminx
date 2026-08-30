import type { ParseFailure, ParseResult, ParseSuccess } from "../puzzles/types";
import { cloneState, formatState } from "./moves";
import type { Edge, EdgeId, EdgeState } from "./types";

export type {
  ParseError,
  ParseFailure,
  ParseResult,
  ParseSuccess,
} from "../puzzles/types";

export interface TupleParseSuccess extends ParseSuccess<EdgeState> {
  /** Compatibility alias used by the original UI. */
  readonly state: EdgeState;
}

export interface TupleParseFailure extends ParseFailure {
  /** Compatibility alias used by the original UI. */
  readonly reason: string;
}

export type TupleParseResult = TupleParseSuccess | TupleParseFailure;

const failure = (code: string, message: string): TupleParseFailure => ({
  ok: false,
  error: { code, message },
  reason: message,
});

const success = (edges: readonly Edge[]): TupleParseSuccess => {
  const state = cloneState(edges as unknown as EdgeState);
  return { ok: true, value: state, state };
};

const parseHumanToken = (token: string): Edge | null => {
  const match = token.match(/^([1-5])(')?$/);
  if (!match) {
    return null;
  }
  return {
    id: Number(match[1]) as EdgeId,
    flipped: match[2] === "'",
  };
};

const validateUniqueIds = (
  edges: readonly Edge[],
): TupleParseFailure | null => {
  const ids = new Set(edges.map((edge) => edge.id));
  return ids.size === 5
    ? null
    : failure("DUPLICATE_EDGE", "Each edge id 1..5 must appear exactly once.");
};

/** Parse strict human tuple notation, with either no brackets or one matched pair. */
export const parseTuple = (input: string): TupleParseResult => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return failure("EMPTY_INPUT", "Enter five comma-separated edge tokens.");
  }

  const hasOpeningBracket = trimmed.startsWith("[");
  const hasClosingBracket = trimmed.endsWith("]");
  if (hasOpeningBracket !== hasClosingBracket) {
    return failure(
      "MISMATCHED_BRACKETS",
      "Square brackets must be either omitted or matched.",
    );
  }

  const body = hasOpeningBracket ? trimmed.slice(1, -1).trim() : trimmed;
  const tokens = body.split(",").map((token) => token.trim());
  if (tokens.length !== 5) {
    return failure(
      "TOKEN_COUNT",
      "Input must contain exactly 5 comma-separated edge tokens.",
    );
  }

  const emptyPosition = tokens.findIndex((token) => token.length === 0);
  if (emptyPosition >= 0) {
    return failure(
      "EMPTY_TOKEN",
      `Edge token ${emptyPosition + 1} is empty; trailing and repeated commas are not allowed.`,
    );
  }

  const edges: Edge[] = [];
  for (const token of tokens) {
    const edge = parseHumanToken(token);
    if (!edge) {
      return failure(
        "INVALID_TOKEN",
        `Invalid token "${token}". Use 1..5 optionally followed by an apostrophe (e.g. 3').`,
      );
    }
    edges.push(edge);
  }

  return validateUniqueIds(edges) ?? success(edges);
};

/** Parse the stable URL/worker form, for example `1n|2p|3n|4n|5n`. */
export const parseSerializedState = (
  serialized: string,
): ParseResult<EdgeState> => {
  const tokens = serialized.split("|");
  if (tokens.length !== 5 || tokens.some((token) => token.length === 0)) {
    return {
      ok: false,
      error: {
        code: "SERIALIZED_TOKEN_COUNT",
        message:
          "Serialized state must contain exactly five pipe-separated edge tokens.",
      },
    };
  }

  const edges: Edge[] = [];
  for (const token of tokens) {
    const match = token.match(/^([1-5])([np])$/);
    if (!match) {
      return {
        ok: false,
        error: {
          code: "INVALID_SERIALIZED_TOKEN",
          message: `Invalid serialized edge token "${token}".`,
        },
      };
    }
    edges.push({
      id: Number(match[1]) as EdgeId,
      flipped: match[2] === "p",
    });
  }

  const duplicateError = validateUniqueIds(edges);
  if (duplicateError) {
    return { ok: false, error: duplicateError.error };
  }
  const state = cloneState(edges as unknown as EdgeState);
  return { ok: true, value: state };
};

export const stateToInputString = (state: EdgeState): string =>
  formatState(state);
