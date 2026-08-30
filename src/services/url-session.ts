import type { PuzzleDefinition } from "../puzzles/types";
import {
  DEFAULT_SCRAMBLE_LENGTH,
  normalizeScrambleSeed,
  parseScrambleLength,
} from "../core/scramble";
import { formatWord, MAX_WORD_LENGTH, parseWord } from "../core/word";

export const SESSION_SCHEMA_VERSION = 1 as const;

export type SessionField = "v" | "p" | "state" | "word" | "seed" | "len";

export type SessionWarningCode =
  | "missing-field"
  | "duplicate-field"
  | "unsupported-version"
  | "puzzle-mismatch"
  | "invalid-state"
  | "invalid-word"
  | "invalid-seed"
  | "invalid-length";

export interface SessionWarning {
  code: SessionWarningCode;
  field: SessionField;
  message: string;
}

export type SessionDefinition<S, M extends string> = Pick<
  PuzzleDefinition<S, M>,
  | "id"
  | "moves"
  | "solvedState"
  | "isState"
  | "cloneState"
  | "serialize"
  | "deserialize"
>;

export interface SessionEncodeOptions<M extends string> {
  word?: readonly M[];
  seed?: string;
  scrambleLength?: number;
}

export interface DecodedSession<S, M extends string> {
  hasSession: boolean;
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  puzzleId: string;
  state: S;
  word: M[];
  wordText: string;
  seed: string;
  scrambleLength: number;
  warnings: SessionWarning[];
}

const encodeComponent = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const appendField = (
  fields: string[],
  key: SessionField,
  value: string,
): void => {
  fields.push(`${encodeComponent(key)}=${encodeComponent(value)}`);
};

const readSingleField = (
  params: URLSearchParams,
  field: SessionField,
  warnings: SessionWarning[],
): string | undefined => {
  const values = params.getAll(field);
  if (values.length > 1) {
    warnings.push({
      code: "duplicate-field",
      field,
      message: `Shared session field "${field}" appears more than once and was ignored.`,
    });
    return undefined;
  }
  return values[0];
};

const defaultSession = <S, M extends string>(
  definition: SessionDefinition<S, M>,
  hasSession: boolean,
  warnings: SessionWarning[] = [],
): DecodedSession<S, M> => ({
  hasSession,
  schemaVersion: SESSION_SCHEMA_VERSION,
  puzzleId: definition.id,
  state: definition.cloneState(definition.solvedState),
  word: [],
  wordText: "",
  seed: "",
  scrambleLength: DEFAULT_SCRAMBLE_LENGTH,
  warnings,
});

/**
 * Encode only shareable workspace inputs. History, playback, status and camera
 * state are deliberately not accepted by this interface.
 */
export const encodeSessionHash = <S, M extends string>(
  definition: SessionDefinition<S, M>,
  state: S,
  options: SessionEncodeOptions<M> = {},
): string => {
  if (!definition.isState(state)) {
    throw new TypeError("Cannot share an invalid puzzle state.");
  }

  const registeredMoves = new Set(
    definition.moves.map(({ notation }) => notation),
  );
  const word = options.word ?? [];
  if (word.length > MAX_WORD_LENGTH) {
    throw new RangeError(
      `Cannot share a word longer than ${MAX_WORD_LENGTH} moves.`,
    );
  }
  const invalidMove = word.find((move) => !registeredMoves.has(move));
  if (invalidMove !== undefined) {
    throw new TypeError(`Cannot share unregistered move "${invalidMove}".`);
  }

  let normalizedSeed: string | undefined;
  if (options.seed !== undefined) {
    const seedResult = normalizeScrambleSeed(options.seed);
    if (!seedResult.ok) {
      throw new RangeError(seedResult.error.message);
    }
    normalizedSeed = seedResult.value;
  }

  const includeLength =
    options.scrambleLength !== undefined || normalizedSeed !== undefined;
  const lengthResult = parseScrambleLength(options.scrambleLength);
  if (!lengthResult.ok) {
    throw new RangeError(lengthResult.error.message);
  }

  const fields: string[] = [];
  appendField(fields, "v", String(SESSION_SCHEMA_VERSION));
  appendField(fields, "p", definition.id);
  appendField(fields, "state", definition.serialize(state));

  if (word.length > 0) {
    appendField(fields, "word", formatWord(word));
  }
  if (normalizedSeed !== undefined) {
    appendField(fields, "seed", normalizedSeed);
  }
  if (includeLength) {
    appendField(fields, "len", String(lengthResult.value));
  }

  return `#${fields.join("&")}`;
};

/** Decode a fragment into a safe, paused workspace snapshot. */
export const decodeSessionHash = <S, M extends string>(
  hash: string,
  definition: SessionDefinition<S, M>,
): DecodedSession<S, M> => {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment.length === 0) {
    return defaultSession(definition, false);
  }

  const warnings: SessionWarning[] = [];
  const params = new URLSearchParams(fragment);
  const version = readSingleField(params, "v", warnings);

  if (version === undefined) {
    if (!warnings.some(({ field }) => field === "v")) {
      warnings.push({
        code: "missing-field",
        field: "v",
        message:
          "Shared session is missing required data; the solved state was loaded.",
      });
    }
    return defaultSession(definition, true, warnings);
  }

  if (version !== String(SESSION_SCHEMA_VERSION)) {
    warnings.push({
      code: "unsupported-version",
      field: "v",
      message: `Shared session version "${version}" is not supported; the solved state was loaded.`,
    });
    return defaultSession(definition, true, warnings);
  }

  const puzzleId = readSingleField(params, "p", warnings);
  if (puzzleId === undefined) {
    if (!warnings.some(({ field }) => field === "p")) {
      warnings.push({
        code: "missing-field",
        field: "p",
        message:
          "Shared session is missing its puzzle id; the solved state was loaded.",
      });
    }
    return defaultSession(definition, true, warnings);
  }

  if (puzzleId !== definition.id) {
    warnings.push({
      code: "puzzle-mismatch",
      field: "p",
      message: `Shared puzzle "${puzzleId}" is unavailable here; the solved state was loaded.`,
    });
    return defaultSession(definition, true, warnings);
  }

  const decoded = defaultSession(definition, true, warnings);
  const serializedState = readSingleField(params, "state", warnings);
  if (serializedState === undefined) {
    if (!warnings.some(({ field }) => field === "state")) {
      warnings.push({
        code: "missing-field",
        field: "state",
        message:
          "Shared session is missing its state; the solved state was loaded.",
      });
    }
  } else {
    const stateResult = definition.deserialize(serializedState);
    if (stateResult.ok) {
      decoded.state = stateResult.value;
    } else {
      warnings.push({
        code: "invalid-state",
        field: "state",
        message: `Shared state is invalid (${stateResult.error.message}); the solved state was loaded.`,
      });
    }
  }

  const wordInput = readSingleField(params, "word", warnings);
  if (wordInput !== undefined) {
    const wordResult = parseWord(wordInput, definition);
    if (wordResult.ok) {
      decoded.word = wordResult.value.moves;
      decoded.wordText = wordResult.value.normalized;
    } else {
      warnings.push({
        code: "invalid-word",
        field: "word",
        message: `Shared word was ignored: ${wordResult.error.message}`,
      });
    }
  }

  const seedInput = readSingleField(params, "seed", warnings);
  if (seedInput !== undefined) {
    const seedResult = normalizeScrambleSeed(seedInput);
    if (seedResult.ok) {
      decoded.seed = seedResult.value;
    } else {
      warnings.push({
        code: "invalid-seed",
        field: "seed",
        message: `Shared key was ignored: ${seedResult.error.message}`,
      });
    }
  }

  const lengthInput = readSingleField(params, "len", warnings);
  if (lengthInput !== undefined) {
    const lengthResult = parseScrambleLength(lengthInput);
    if (lengthResult.ok) {
      decoded.scrambleLength = lengthResult.value;
    } else {
      warnings.push({
        code: "invalid-length",
        field: "len",
        message: `Shared scramble length was ignored: ${lengthResult.error.message}`,
      });
    }
  }

  return decoded;
};
