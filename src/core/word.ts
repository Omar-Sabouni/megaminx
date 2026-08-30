import type { MoveSpec, PuzzleDefinition } from "../puzzles/types";

export const MAX_WORD_LENGTH = 200;

export interface MoveCatalog<M extends string> {
  moves: readonly Pick<MoveSpec<M>, "notation">[];
}

export type WordParseErrorCode = "empty-token" | "unknown-move" | "too-long";

export interface WordParseError {
  code: WordParseErrorCode;
  message: string;
  /** Zero-based position in the parsed move sequence. */
  tokenIndex?: number;
  token?: string;
}

export interface ParsedWord<M extends string> {
  moves: M[];
  normalized: string;
}

export type WordParseResult<M extends string> =
  { ok: true; value: ParsedWord<M> } | { ok: false; error: WordParseError };

export interface WordPreview<S, M extends string> extends ParsedWord<M> {
  state: S;
}

export type WordPreviewResult<S, M extends string> =
  { ok: true; value: WordPreview<S, M> } | { ok: false; error: WordParseError };

const tokenize = (input: string): string[] | WordParseError => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const tokens: string[] = [];
  const commaGroups = trimmed.split(",");

  for (const group of commaGroups) {
    const cleaned = group.trim();
    if (cleaned.length === 0) {
      return {
        code: "empty-token",
        message: `Move ${tokens.length + 1} is empty. Remove the extra comma or enter a move.`,
        tokenIndex: tokens.length,
        token: "",
      };
    }

    tokens.push(...cleaned.split(/\s+/u));
  }

  return tokens;
};

export const formatWord = <M extends string>(moves: readonly M[]): string =>
  moves.join(" ");

export const parseWord = <M extends string>(
  input: string,
  catalog: MoveCatalog<M>,
): WordParseResult<M> => {
  const tokenized = tokenize(input);
  if (!Array.isArray(tokenized)) {
    return { ok: false, error: tokenized };
  }

  if (tokenized.length > MAX_WORD_LENGTH) {
    return {
      ok: false,
      error: {
        code: "too-long",
        message: `A word may contain at most ${MAX_WORD_LENGTH} moves (received ${tokenized.length}).`,
      },
    };
  }

  const byNotation = new Map<string, M>(
    catalog.moves.map((move) => [move.notation, move.notation] as const),
  );
  const moves: M[] = [];

  for (const [tokenIndex, token] of tokenized.entries()) {
    const move = byNotation.get(token);
    if (move === undefined) {
      const registered = catalog.moves
        .map(({ notation }) => notation)
        .join(", ");
      return {
        ok: false,
        error: {
          code: "unknown-move",
          message: `Move ${tokenIndex + 1} ("${token}") is not registered. Use one of: ${registered}.`,
          tokenIndex,
          token,
        },
      };
    }
    moves.push(move);
  }

  return {
    ok: true,
    value: {
      moves,
      normalized: formatWord(moves),
    },
  };
};

export const applyWordToState = <S, M extends string>(
  definition: Pick<PuzzleDefinition<S, M>, "applyMove" | "cloneState">,
  state: S,
  moves: readonly M[],
): S =>
  moves.reduce(
    (current, move) => definition.applyMove(current, move),
    definition.cloneState(state),
  );

export const previewWord = <S, M extends string>(
  input: string,
  definition: Pick<
    PuzzleDefinition<S, M>,
    "moves" | "applyMove" | "cloneState"
  >,
  state: S,
): WordPreviewResult<S, M> => {
  const parsed = parseWord(input, definition);
  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    value: {
      ...parsed.value,
      state: applyWordToState(definition, state, parsed.value.moves),
    },
  };
};
