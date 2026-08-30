# Megaminx top-edge model

An interactive tool for a five-edge Megaminx top-layer model. It combines direct
puzzle controls, a 3D preview, scrambles, and exact shortest-path solving.

This is a subsystem rather than a complete Megaminx simulator: corners and the
other edges are outside the model. `F` and `S` are the abstract moves defined in
the app and are not standard full-puzzle face-turn notation.

## Run locally

```bash
npm ci
npm run dev
```

Open the local address printed by Vite.

## Controls

- Apply `F`, `F'`, `S`, and `S'` with the buttons or the matching keyboard keys.
- Undo and redo individual moves, or enter a complete move word.
- Generate a scramble from a key and length.
- Load a signed edge state such as `[1, 3', 5, 4, 2]`.
- Select **Solve shortest word** to inspect the path and search layers, then play
  the solution or select a path state.
- Select **Copy session link** to share the current state and inputs.

The five-edge model contains four disconnected components of 960 states. A state
outside the solved component can still be loaded and inspected, but it has no path
to the solved state using these two moves.
