import { describe, expect, it } from "vitest";
import { SessionModel } from "../src/app/session";
import { applyWord, serialize, SOLVED_STATE } from "../src/core/moves";
import { TOP_LAYER_EDGES } from "../src/puzzles/topLayerEdges";

describe("session model", () => {
  it("tracks moves, undo/redo, and branch truncation", () => {
    const session = new SessionModel(TOP_LAYER_EDGES, SOLVED_STATE);
    session.commitMove("S");
    session.commitMove("F");
    expect(session.currentKey()).toBe(
      serialize(applyWord(SOLVED_STATE, ["S", "F"])),
    );

    session.undo();
    expect(session.canRedo()).toBe(true);
    session.commitMove("S");
    expect(session.canRedo()).toBe(false);
    expect(session.snapshot().history.moves).toEqual(["S", "S"]);
  });

  it("loads playback paused and never rewinds before its anchor", () => {
    const session = new SessionModel(TOP_LAYER_EDGES, SOLVED_STATE);
    session.commitMove("S");
    const anchor = session.currentKey();
    session.startPlayback(["F", "S'"], "word", "Test word");

    expect(session.snapshot().playback?.isPlaying).toBe(false);
    expect(session.stepPlaybackBackward()).toBeNull();
    session.stepPlaybackForward();
    session.stepPlaybackForward();
    expect(session.snapshot().playback?.index).toBe(2);

    session.restartPlayback();
    expect(session.currentKey()).toBe(anchor);
    expect(session.snapshot().playback?.index).toBe(0);
  });

  it("seeks deterministically while retaining per-move history", () => {
    const session = new SessionModel(TOP_LAYER_EDGES, SOLVED_STATE);
    const word = ["S", "F", "S'"] as const;
    session.startPlayback(word, "solution", "Solution");
    session.seekPlayback(2);

    expect(session.currentKey()).toBe(
      serialize(applyWord(SOLVED_STATE, word.slice(0, 2))),
    );
    expect(session.snapshot().history.moves).toEqual(word.slice(0, 2));
    session.seekPlayback(1);
    expect(session.snapshot().history.moves).toEqual(word.slice(0, 1));
  });
});
