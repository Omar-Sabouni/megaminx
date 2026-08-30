/** A machine-readable parse error suitable for inline validation. */
export interface ParseError {
  readonly code: string;
  readonly message: string;
}

export interface ParseSuccess<Value> {
  readonly ok: true;
  readonly value: Value;
}

export interface ParseFailure {
  readonly ok: false;
  readonly error: ParseError;
}

export type ParseResult<Value> = ParseSuccess<Value> | ParseFailure;

/** Canonical metadata for one move in a puzzle definition. */
export interface MoveSpec<Move extends string> {
  readonly notation: Move;
  readonly inverse: Move;
  readonly label: string;
}

/**
 * Everything the state-independent application and search layers need to know
 * about a puzzle. Definitions are deliberately serialization-friendly so the
 * same contract can be used on the main thread and in a worker.
 */
export interface PuzzleDefinition<State, Move extends string> {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly moves: readonly MoveSpec<Move>[];
  readonly solvedState: State;
  readonly isState: (value: unknown) => value is State;
  readonly cloneState: (state: State) => State;
  readonly serialize: (state: State) => string;
  readonly deserialize: (serialized: string) => ParseResult<State>;
  readonly formatState: (state: State) => string;
  readonly parseState: (input: string) => ParseResult<State>;
  readonly applyMove: (state: State, move: Move) => State;
  /** Equal keys mean that two structurally valid states share a component. */
  readonly componentKey: (state: State) => string;
}
