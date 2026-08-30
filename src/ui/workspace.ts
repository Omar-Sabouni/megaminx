const TOP_FACE_COLOR_HEX = "#ffffff";
const EDGE_SIDE_COLOR_HEX_BY_ID = {
  1: "#cc0000",
  2: "#008000",
  3: "#0066cc",
  4: "#ffd400",
  5: "#800080",
} as const;

export type StatusTone = "info" | "success" | "warning" | "error";

export interface WorkspaceElements {
  sceneHost: HTMLDivElement;
  sceneFallback: HTMLDivElement;
  resetViewButton: HTMLButtonElement;
  referenceDetails: HTMLDetailsElement;
  shareButton: HTMLButtonElement;
  stateForm: HTMLFormElement;
  stateInput: HTMLInputElement;
  stateError: HTMLParagraphElement;
  currentState: HTMLOutputElement;
  invariantList: HTMLUListElement;
  moveButtons: readonly HTMLButtonElement[];
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  moveLog: HTMLOListElement;
  wordForm: HTMLFormElement;
  wordInput: HTMLTextAreaElement;
  wordError: HTMLParagraphElement;
  wordPreview: HTMLParagraphElement;
  applyWordButton: HTMLButtonElement;
  replayWordButton: HTMLButtonElement;
  scrambleForm: HTMLFormElement;
  seedInput: HTMLInputElement;
  scrambleLength: HTMLInputElement;
  scrambleError: HTMLParagraphElement;
  newSeedButton: HTMLButtonElement;
  scrambleWord: HTMLParagraphElement;
  replayScrambleButton: HTMLButtonElement;
  solveButton: HTMLButtonElement;
  cancelSearchButton: HTMLButtonElement;
  analysisStatus: HTMLParagraphElement;
  analysisEmpty: HTMLParagraphElement;
  analysisResult: HTMLDivElement;
  solutionDepth: HTMLElement;
  solutionWord: HTMLElement;
  copySolutionButton: HTMLButtonElement;
  playSolutionButton: HTMLButtonElement;
  pathList: HTMLOListElement;
  histogram: HTMLDivElement;
  histogramTableBody: HTMLTableSectionElement;
  histogramCaption: HTMLParagraphElement;
  metrics: HTMLDListElement;
  playbackPanel: HTMLElement;
  playbackLabel: HTMLElement;
  playbackProgress: HTMLElement;
  playPauseButton: HTMLButtonElement;
  stepBackButton: HTMLButtonElement;
  stepForwardButton: HTMLButtonElement;
  restartPlaybackButton: HTMLButtonElement;
  exitPlaybackButton: HTMLButtonElement;
  speedSelect: HTMLSelectElement;
  globalStatus: HTMLParagraphElement;
  shareDialog: HTMLDialogElement;
  shareLinkInput: HTMLInputElement;
  closeShareDialog: HTMLButtonElement;
}

const required = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Workspace element missing: ${selector}`);
  return element;
};

export class WorkspaceView {
  readonly elements: WorkspaceElements;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <a class="skip-link" href="#workspace">Skip to puzzle workspace</a>
      <div class="workspace-shell">
        <header class="app-bar">
          <div class="app-identity">
            <div class="title-stack">
              <h1 aria-label="Megaminx"><span>M</span><span>e</span><span>g</span><span>a</span><span>m</span><span>i</span><span>n</span><span>x</span></h1>
              <p class="subtitle">Five top-layer edges. Two moves. 960 positions.</p>
            </div>
          </div>
          <p id="globalStatus" class="global-status info" role="status" aria-live="polite">Loading…</p>
          <button id="shareButton" class="share-button" type="button">Copy link</button>
        </header>

        <main id="workspace" class="workspace-grid" tabindex="-1">
          <section class="viewport-pane" aria-labelledby="puzzleHeading">
            <h2 id="puzzleHeading" class="sr-only">Puzzle</h2>
            <figure class="scene-frame">
              <figcaption>
                <span class="scene-tools"><button id="resetViewButton" type="button">Reset view</button></span>
              </figcaption>
              <p id="sceneDescription" class="sr-only">Interactive 3D Megaminx preview. Drag to rotate and use the mouse wheel or trackpad to zoom. All puzzle state is also shown as text.</p>
              <div id="sceneHost" class="scene-host" aria-describedby="sceneDescription"></div>
              <div id="sceneFallback" class="scene-fallback" role="alert" hidden>
                <strong>The 3D view needs WebGL.</strong>
              </div>
            </figure>

            <div class="state-summary">
              <div class="state-line">
                <span class="field-label">Position</span>
                <output id="currentState" class="current-state mono">[1, 2, 3, 4, 5]</output>
              </div>
            </div>

            <fieldset id="playbackPanel" class="transport" hidden>
              <legend id="playbackLabel">Playback</legend>
              <p id="playbackProgress" class="transport-progress mono">Step 0/0</p>
              <div class="transport-controls">
                <button id="stepBackButton" type="button" aria-label="Previous playback step">|&lt;</button>
                <button id="playPauseButton" type="button" aria-keyshortcuts="Space">Play</button>
                <button id="stepForwardButton" type="button" aria-label="Next playback step">&gt;|</button>
                <button id="restartPlaybackButton" type="button">Restart</button>
                <button id="exitPlaybackButton" type="button">Exit</button>
                <label>Speed
                  <select id="speedSelect">
                    <option value="0.25">0.25×</option><option value="0.5">0.5×</option>
                    <option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option>
                  </select>
                </label>
              </div>
            </fieldset>
          </section>

          <aside class="command-pane" aria-labelledby="controlsHeading">
            <h2 id="controlsHeading" class="pane-title">Moves</h2>

            <section class="tool-section move-section" aria-labelledby="movesHeading">
              <div class="section-heading">
                <h3 id="movesHeading" class="sr-only">Turn</h3>
              </div>
              <div class="move-grid" role="group" aria-label="Megaminx edge moves">
                <button type="button" data-move="F" aria-keyshortcuts="F"><strong>F</strong><small>front</small></button>
                <button type="button" data-move="F'" aria-keyshortcuts="Shift+F"><strong>F′</strong><small>front inverse</small></button>
                <button type="button" data-move="S" aria-keyshortcuts="S"><strong>S</strong><small>ring</small></button>
                <button type="button" data-move="S'" aria-keyshortcuts="Shift+S"><strong>S′</strong><small>ring inverse</small></button>
              </div>
              <div class="command-row">
                <button id="undoButton" type="button" aria-keyshortcuts="Control+Z Meta+Z">Undo</button>
                <button id="redoButton" type="button" aria-keyshortcuts="Control+Y Meta+Y">Redo</button>
                <button id="resetButton" class="danger-command" type="button">Reset</button>
              </div>
            </section>

            <section class="tool-section command-notebook" aria-labelledby="commandInputHeading">
              <h3 id="commandInputHeading" class="sr-only">Input</h3>

              <form id="wordForm" class="command-mode" aria-labelledby="wordModeHeading" novalidate>
                <div class="mode-heading"><h4 id="wordModeHeading">Type a sequence</h4></div>
                <label class="sr-only" for="wordInput">Move word</label>
                <textarea id="wordInput" rows="2" maxlength="800" spellcheck="false" placeholder="S F S′" aria-describedby="wordError wordPreview"></textarea>
                <p id="wordError" class="field-error" role="alert"></p>
                <p id="wordPreview" class="field-note">Identity word. Target equals current state.</p>
                <div class="command-row">
                  <button id="applyWordButton" class="primary-command" type="submit">Apply word</button>
                  <button id="replayWordButton" type="button">Preview</button>
                </div>
              </form>

              <form id="scrambleForm" class="command-mode" aria-labelledby="scrambleModeHeading" novalidate>
                <div class="mode-heading"><h4 id="scrambleModeHeading">Scramble</h4></div>
                <div class="split-fields">
                  <label class="grow">Key<input id="seedInput" name="seed" type="text" value="example" maxlength="64" aria-describedby="scrambleHint scrambleError" /></label>
                  <label class="length-field">Length<input id="scrambleLength" name="length" type="number" min="1" max="50" value="14" inputmode="numeric" aria-describedby="scrambleHint scrambleError" /></label>
                </div>
                <p id="scrambleHint" class="sr-only">The same key always gives the same scramble.</p>
                <p id="scrambleError" class="field-error" role="alert"></p>
                <div class="command-row">
                  <button class="primary-command" type="submit" aria-label="Scramble from solved">Scramble</button>
                  <button id="newSeedButton" type="button">New key</button>
                  <button id="replayScrambleButton" type="button" disabled>Replay</button>
                </div>
                <p id="scrambleWord" class="word-output mono" aria-live="polite"></p>
              </form>

              <form id="stateForm" class="command-mode" aria-labelledby="stateModeHeading" novalidate>
                <div class="mode-heading"><h4 id="stateModeHeading">Set a position</h4></div>
                <label class="sr-only" for="stateInput">Edge state</label>
                <div class="input-command">
                  <input id="stateInput" name="state" type="text" autocomplete="off" spellcheck="false" aria-describedby="stateHint stateError" value="[1, 2, 3, 4, 5]" />
                  <button class="primary-command" type="submit" aria-label="Load state">Load</button>
                </div>
                <p id="stateHint" class="field-note">e.g. <code>[1, 3', 5, 4, 2]</code></p>
                <p id="stateError" class="field-error" role="alert"></p>
              </form>
            </section>

            <details class="tool-section history-block">
              <summary>Move log</summary>
              <ol id="moveLog" class="move-log mono"></ol>
            </details>

            <details id="referenceDetails" class="tool-section reference-block">
              <summary>Notation</summary>
              <div class="reference-copy">
                <p>A prime marks a flipped edge.</p>
                <ul class="color-key" aria-label="Edge color key">
                  ${([1, 2, 3, 4, 5] as const).map((id) => `<li><span class="swatch pair" style="--top:${TOP_FACE_COLOR_HEX};--side:${EDGE_SIDE_COLOR_HEX_BY_ID[id]}"></span><code>${id}</code></li>`).join("")}
                </ul>
                <p>Move words use <code>F, F′, S, S′</code> and are read from left to right.</p>
                <dl class="notation-strip" aria-label="Move definitions">
                  <div><dt><code>F</code></dt><dd><code>[a,b,c,d,e] → [b′,c,a′,d,e]</code></dd></div>
                  <div><dt><code>S</code></dt><dd><code>[a,b,c,d,e] → [e,a,b,c,d]</code></dd></div>
                </dl>
                <p>Checks on the current position:</p>
                <ul id="invariantList" class="invariant-list" aria-label="State invariant checks"></ul>
              </div>
            </details>
          </aside>

          <aside id="analysis" class="analysis-pane" aria-labelledby="analysisHeading">
            <h2 id="analysisHeading" class="pane-title">Solve</h2>
            <div class="solver-toolbar">
              <button id="solveButton" class="primary-command solve-command" type="button">Find the shortest solution</button>
              <button id="cancelSearchButton" class="danger-command" type="button" hidden>Cancel</button>
            </div>
            <p id="analysisStatus" class="analysis-status" role="status" aria-live="polite"></p>
            <p id="analysisEmpty" class="analysis-empty"></p>

            <div id="analysisResult" hidden>
              <dl class="solution-summary">
                <div><dt>Depth</dt><dd id="solutionDepth">—</dd></div>
                <div><dt>Moves</dt><dd id="solutionWord" class="mono">—</dd></div>
              </dl>
              <div class="command-row solution-actions">
                <button id="playSolutionButton" class="primary-command" type="button">Play solution</button>
                <button id="copySolutionButton" type="button">Copy word</button>
              </div>

              <section class="analysis-section" aria-labelledby="pathHeading">
                <h3 id="pathHeading">Step by step</h3>
                <ol id="pathList" class="path-list"></ol>
              </section>

              <section class="analysis-section" aria-labelledby="layersHeading">
                <h3 id="layersHeading">Positions at each depth</h3>
                <p id="histogramCaption" class="histogram-caption"></p>
                <div id="histogram" class="histogram" role="img" aria-labelledby="layersHeading histogramCaption"></div>
                <details class="data-table-wrap">
                  <summary>As a table</summary>
                  <table class="data-table">
                    <caption class="sr-only">States found at each search depth</caption>
                    <thead><tr><th scope="col">Depth</th><th scope="col">States</th><th scope="col">Status</th></tr></thead>
                    <tbody id="histogramTableBody"></tbody>
                  </table>
                  <dl id="metrics" class="metrics-strip" aria-label="Search totals"></dl>
                </details>
              </section>

            </div>
          </aside>
        </main>

        <dialog id="shareDialog" aria-labelledby="shareDialogHeading">
          <form method="dialog">
            <h2 id="shareDialogHeading">Copy session link</h2>
            <p>Copy this link.</p>
            <label for="shareLinkInput">Link</label>
            <input id="shareLinkInput" type="text" readonly />
            <p><button id="closeShareDialog" class="primary-command" value="close">Close</button></p>
          </form>
        </dialog>
      </div>
    `;

    this.elements = {
      sceneHost: required(root, "#sceneHost"),
      sceneFallback: required(root, "#sceneFallback"),
      resetViewButton: required(root, "#resetViewButton"),
      referenceDetails: required(root, "#referenceDetails"),
      shareButton: required(root, "#shareButton"),
      stateForm: required(root, "#stateForm"),
      stateInput: required(root, "#stateInput"),
      stateError: required(root, "#stateError"),
      currentState: required(root, "#currentState"),
      invariantList: required(root, "#invariantList"),
      moveButtons: Array.from(
        root.querySelectorAll<HTMLButtonElement>("[data-move]"),
      ),
      undoButton: required(root, "#undoButton"),
      redoButton: required(root, "#redoButton"),
      resetButton: required(root, "#resetButton"),
      moveLog: required(root, "#moveLog"),
      wordForm: required(root, "#wordForm"),
      wordInput: required(root, "#wordInput"),
      wordError: required(root, "#wordError"),
      wordPreview: required(root, "#wordPreview"),
      applyWordButton: required(root, "#applyWordButton"),
      replayWordButton: required(root, "#replayWordButton"),
      scrambleForm: required(root, "#scrambleForm"),
      seedInput: required(root, "#seedInput"),
      scrambleLength: required(root, "#scrambleLength"),
      scrambleError: required(root, "#scrambleError"),
      newSeedButton: required(root, "#newSeedButton"),
      scrambleWord: required(root, "#scrambleWord"),
      replayScrambleButton: required(root, "#replayScrambleButton"),
      solveButton: required(root, "#solveButton"),
      cancelSearchButton: required(root, "#cancelSearchButton"),
      analysisStatus: required(root, "#analysisStatus"),
      analysisEmpty: required(root, "#analysisEmpty"),
      analysisResult: required(root, "#analysisResult"),
      solutionDepth: required(root, "#solutionDepth"),
      solutionWord: required(root, "#solutionWord"),
      copySolutionButton: required(root, "#copySolutionButton"),
      playSolutionButton: required(root, "#playSolutionButton"),
      pathList: required(root, "#pathList"),
      histogram: required(root, "#histogram"),
      histogramTableBody: required(root, "#histogramTableBody"),
      histogramCaption: required(root, "#histogramCaption"),
      metrics: required(root, "#metrics"),
      playbackPanel: required(root, "#playbackPanel"),
      playbackLabel: required(root, "#playbackLabel"),
      playbackProgress: required(root, "#playbackProgress"),
      playPauseButton: required(root, "#playPauseButton"),
      stepBackButton: required(root, "#stepBackButton"),
      stepForwardButton: required(root, "#stepForwardButton"),
      restartPlaybackButton: required(root, "#restartPlaybackButton"),
      exitPlaybackButton: required(root, "#exitPlaybackButton"),
      speedSelect: required(root, "#speedSelect"),
      globalStatus: required(root, "#globalStatus"),
      shareDialog: required(root, "#shareDialog"),
      shareLinkInput: required(root, "#shareLinkInput"),
      closeShareDialog: required(root, "#closeShareDialog"),
    };
  }

  setStatus(message: string, tone: StatusTone = "info"): void {
    this.elements.globalStatus.textContent = message;
    this.elements.globalStatus.className = `global-status ${tone}`;
  }

  setSceneUnavailable(message: string): void {
    this.elements.sceneHost.hidden = true;
    this.elements.sceneFallback.hidden = false;
    const detail = this.elements.sceneFallback.querySelector("span");
    if (detail) detail.textContent = message;
  }
}
