import type { MoveSpec } from "../puzzles/types";
import { formatWord } from "./word";

export const SCRAMBLE_VERSION = 1 as const;
export const DEFAULT_SCRAMBLE_LENGTH = 14;
export const MIN_SCRAMBLE_LENGTH = 1;
export const MAX_SCRAMBLE_LENGTH = 50;
export const MAX_SCRAMBLE_SEED_LENGTH = 64;

export interface ScrambleCatalog<M extends string> {
  moves: readonly MoveSpec<M>[];
}

export type ScrambleErrorCode =
  "invalid-seed" | "invalid-length" | "invalid-catalog";

export interface ScrambleError {
  code: ScrambleErrorCode;
  message: string;
}

export type ScrambleValueResult<T> =
  { ok: true; value: T } | { ok: false; error: ScrambleError };

export interface GeneratedScramble<M extends string> {
  version: typeof SCRAMBLE_VERSION;
  seed: string;
  length: number;
  moves: M[];
  normalized: string;
}

export type ScrambleResult<M extends string> = ScrambleValueResult<
  GeneratedScramble<M>
>;

const utf8 = new TextEncoder();

/** Stable 32-bit FNV-1a over the UTF-8 representation of a string. */
export const fnv1a32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(input)) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return hash >>> 0;
};

/** Stable Mulberry32 stream. Each call returns a value in [0, 1). */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
};

export const normalizeScrambleSeed = (
  input: string,
): ScrambleValueResult<string> => {
  const seed = input.normalize("NFKC").trim();
  const length = [...seed].length;

  if (length < 1 || length > MAX_SCRAMBLE_SEED_LENGTH) {
    return {
      ok: false,
      error: {
        code: "invalid-seed",
        message: `Key must contain 1–${MAX_SCRAMBLE_SEED_LENGTH} characters after trimming and normalization.`,
      },
    };
  }

  return { ok: true, value: seed };
};

export const parseScrambleLength = (
  input: number | string | undefined,
): ScrambleValueResult<number> => {
  if (input === undefined) {
    return { ok: true, value: DEFAULT_SCRAMBLE_LENGTH };
  }

  const text = typeof input === "number" ? String(input) : input.trim();
  if (!/^\d+$/u.test(text)) {
    return {
      ok: false,
      error: {
        code: "invalid-length",
        message: `Scramble length must be a whole number from ${MIN_SCRAMBLE_LENGTH} to ${MAX_SCRAMBLE_LENGTH}.`,
      },
    };
  }

  const length = Number(text);
  if (
    !Number.isSafeInteger(length) ||
    length < MIN_SCRAMBLE_LENGTH ||
    length > MAX_SCRAMBLE_LENGTH
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-length",
        message: `Scramble length must be a whole number from ${MIN_SCRAMBLE_LENGTH} to ${MAX_SCRAMBLE_LENGTH}.`,
      },
    };
  }

  return { ok: true, value: length };
};

const validateCatalog = <M extends string>(
  catalog: ScrambleCatalog<M>,
): ScrambleValueResult<readonly MoveSpec<M>[]> => {
  if (catalog.moves.length === 0) {
    return {
      ok: false,
      error: {
        code: "invalid-catalog",
        message: "The puzzle has no registered moves.",
      },
    };
  }

  const registered = new Map<M, MoveSpec<M>>();
  for (const move of catalog.moves) {
    if (registered.has(move.notation)) {
      return {
        ok: false,
        error: {
          code: "invalid-catalog",
          message: `Move notation "${move.notation}" is registered more than once.`,
        },
      };
    }
    registered.set(move.notation, move);
  }

  for (const move of catalog.moves) {
    const inverse = registered.get(move.inverse);
    if (inverse === undefined) {
      return {
        ok: false,
        error: {
          code: "invalid-catalog",
          message: `Move "${move.notation}" names an unregistered inverse "${move.inverse}".`,
        },
      };
    }
    if (inverse.inverse !== move.notation) {
      return {
        ok: false,
        error: {
          code: "invalid-catalog",
          message: `Inverse metadata for "${move.notation}" and "${move.inverse}" is inconsistent.`,
        },
      };
    }
  }

  return { ok: true, value: catalog.moves };
};

export const generateScramble = <M extends string>(
  catalog: ScrambleCatalog<M>,
  seedInput: string,
  lengthInput: number | string | undefined = DEFAULT_SCRAMBLE_LENGTH,
): ScrambleResult<M> => {
  const seedResult = normalizeScrambleSeed(seedInput);
  if (!seedResult.ok) {
    return seedResult;
  }

  const lengthResult = parseScrambleLength(lengthInput);
  if (!lengthResult.ok) {
    return lengthResult;
  }

  const catalogResult = validateCatalog(catalog);
  if (!catalogResult.ok) {
    return catalogResult;
  }

  const random = mulberry32(fnv1a32(seedResult.value));
  const moves: M[] = [];
  let previous: MoveSpec<M> | undefined;

  for (let index = 0; index < lengthResult.value; index += 1) {
    const forbiddenInverse = previous?.inverse;
    const eligible =
      forbiddenInverse !== undefined
        ? catalogResult.value.filter(
            (move) => move.notation !== forbiddenInverse,
          )
        : catalogResult.value;

    if (eligible.length === 0) {
      return {
        ok: false,
        error: {
          code: "invalid-catalog",
          message: `No move can follow "${previous?.notation}" without immediately undoing it.`,
        },
      };
    }

    const selected = eligible[Math.floor(random() * eligible.length)];
    moves.push(selected.notation);
    previous = selected;
  }

  return {
    ok: true,
    value: {
      version: SCRAMBLE_VERSION,
      seed: seedResult.value,
      length: lengthResult.value,
      moves,
      normalized: formatWord(moves),
    },
  };
};
