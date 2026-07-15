/**
 * The Cadence sequencer IDE (SPEC milestone v1): compose on the grid, run
 * with live console output, Save renders a real .wav with count-in, Open
 * decodes one back to the grid. The editor is a drum machine, not a text
 * editor — the audio is the source.
 */
import {
  assemble,
  decode,
  encode,
  formatError,
  grooveMeasure,
  parse,
  run,
  stepSeconds,
  RuntimeError,
  type DrumSymbol,
  type Grid,
  type Instruction,
  type Line,
  type MeasureGrid,
  type Program,
  type Register,
  type Step,
  type VMEvent,
} from "@cadence/core";
import { KitAudio, type LoadedAudio } from "./audio.js";
import { EXAMPLES } from "./examples.js";
import "./style.css";

// ---- lanes (top to bottom, like the explainer's anatomy diagram) ----------
const LANES: { sym: DrumSymbol; label: string }[] = [
  { sym: "C", label: "Crash" },
  { sym: "R", label: "Ride" },
  { sym: "T1", label: "Tom 1" },
  { sym: "T2", label: "Tom 2" },
  { sym: "T3", label: "Tom 3" },
  { sym: "FT", label: "Floor Tom" },
  { sym: "S", label: "Snare" },
  { sym: "H", label: "Closed Hat" },
  { sym: "K", label: "Kick" },
];

// ---- state -----------------------------------------------------------------
let grid: Grid = assemble(EXAMPLES["Countdown (5 4 3 2 1)"]!);
let bpm = 120;
let program: Program = parse(grid);
let loaded: LoadedAudio | null = null;
let loadError = "";

const app = document.getElementById("app")!;

async function ensureAudio(): Promise<LoadedAudio> {
  if (!loaded) loaded = await KitAudio.load();
  await loaded.audio.resume();
  return loaded;
}

// ---- console ---------------------------------------------------------------
let consoleText = "";
let consoleStatus = "";
let consoleRunning = false;

function paintConsole(): void {
  const el = document.getElementById("console")!;
  el.innerHTML =
    `<span class="prompt">$ cadence run program.wav</span>\n` +
    escapeHtml(consoleText) +
    (consoleRunning ? `<span class="cursor">▌</span>` : "") +
    (consoleStatus ? `\n<span class="prompt">${escapeHtml(consoleStatus)}</span>` : "");
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- the runner: streaming VM → lookahead audio scheduler ------------------
type RunnerState = "idle" | "running" | "awaiting-input" | "stepping";

class Runner {
  state: RunnerState = "idle";
  private gen: Generator<VMEvent, void, bigint | undefined> | null = null;
  private stash: VMEvent | null = null; // next chunk's `bar` event
  private genDone = false;
  private nextTime = 0;
  private timer: number | null = null;
  private timeouts: number[] = [];
  private pendingResume: ((v: bigint) => void) | null = null;

  constructor(private readonly onFinish: (status: string) => void) {}

  private barSeconds(): number {
    return 16 * stepSeconds(bpm);
  }

  /**
   * Pull one executed bar from the generator: the bar index plus the I/O
   * events it produced. Returns null when the program is over. If an IN
   * instruction needs a value, `needsInput` is set and the chunk is partial —
   * call resume(value) to finish it.
   */
  private pullChunk(): {
    bar: number;
    events: (VMEvent | { type: "fedInput"; value: bigint })[];
    needsInput: Register | null;
  } | null {
    if (!this.gen || this.genDone) return null;
    let barEvent = this.stash;
    this.stash = null;
    const events: (VMEvent | { type: "fedInput"; value: bigint })[] = [];
    let needsInput: Register | null = null;

    for (;;) {
      if (!barEvent) {
        const r = this.gen.next();
        if (r.done) {
          this.genDone = true;
          break;
        }
        if (r.value.type === "bar") {
          barEvent = r.value;
          continue;
        }
        // events before any bar event shouldn't happen; tolerate
        events.push(r.value);
        continue;
      }
      // we have the current bar; collect its events until the next bar
      const r = this.gen.next();
      if (r.done) {
        this.genDone = true;
        break;
      }
      const e = r.value;
      if (e.type === "bar") {
        this.stash = e;
        break;
      }
      events.push(e);
      if (e.type === "input") {
        const queued = takeQueuedInput();
        if (queued !== null) {
          // feed it synchronously and keep collecting
          events.push({ type: "fedInput", value: queued });
          const rr = this.gen.next(queued);
          if (rr.done) {
            this.genDone = true;
            break;
          }
          if (rr.value.type === "bar") {
            this.stash = rr.value;
            break;
          }
          events.push(rr.value);
        } else {
          needsInput = e.reg;
          break;
        }
      }
    }
    if (!barEvent) return null;
    return { bar: (barEvent as { bar: number }).bar, events, needsInput };
  }

  private async scheduleChunk(
    chunk: NonNullable<ReturnType<Runner["pullChunk"]>>,
    t: number,
  ): Promise<void> {
    const { audio } = await ensureAudio();
    const stepDur = stepSeconds(bpm);
    const measure = grid[chunk.bar - 1];
    if (measure) {
      measure.steps.forEach((hits, s) => {
        for (const sym of hits) audio.play(sym, t + s * stepDur);
        this.timeouts.push(
          window.setTimeout(
            () => highlightStep(chunk.bar, s),
            Math.max(0, (t + s * stepDur - audio.now()) * 1000),
          ),
        );
      });
    }
    // console + tone land at the top of the bar
    this.timeouts.push(
      window.setTimeout(
        () => {
          highlightBar(chunk.bar);
          for (const e of chunk.events) {
            if (e.type === "outN") consoleText += `${e.value} `;
            else if (e.type === "outC")
              consoleText += safeFromCodePoint(e.codepoint);
            else if (e.type === "fedInput") consoleText += `in: ${e.value}\n`;
          }
          paintConsole();
        },
        Math.max(0, (t - audio.now()) * 1000),
      ),
    );
    for (const e of chunk.events) {
      if (e.type === "tone") audio.playTone(e.midi, t);
    }
  }

  async start(): Promise<void> {
    if (this.state !== "idle") return;
    if (program.errors.length > 0) return;
    const { audio } = await ensureAudio();
    this.gen = run(program, { barEvents: true });
    this.genDone = false;
    this.stash = null;
    consoleText = "";
    consoleStatus = "";
    consoleRunning = true;
    paintConsole();
    this.state = "running";
    this.nextTime = audio.now() + 0.15;
    let barsPerformed = 0;

    const tick = async (): Promise<void> => {
      if (this.state !== "running") return;
      const { audio } = await ensureAudio();
      while (this.state === "running" && this.nextTime < audio.now() + 0.3) {
        let chunk;
        try {
          chunk = this.pullChunk();
        } catch (err) {
          this.finish(errorStatus(err));
          return;
        }
        if (!chunk) {
          const doneAt = this.nextTime;
          this.timeouts.push(
            window.setTimeout(
              () => this.finish(`— ${barsPerformed} bars performed, halted`),
              Math.max(0, (doneAt - audio.now()) * 1000),
            ),
          );
          this.state = "stepping"; // stop scheduling, let tail play out
          return;
        }
        barsPerformed++;
        await this.scheduleChunk(chunk, this.nextTime);
        this.nextTime += this.barSeconds();
        if (chunk.needsInput) {
          this.state = "awaiting-input";
          promptForInput(chunk.needsInput, (value) => {
            // finish the interrupted bar, then carry on
            this.resumeWith(value);
          });
          return;
        }
      }
    };
    this.timer = window.setInterval(() => void tick(), 60);
    void tick();
    updateToolbar();
  }

  private resumeWith(value: bigint): void {
    if (!this.gen || this.state !== "awaiting-input") return;
    consoleText += `in: ${value}\n`;
    paintConsole();
    // drain the rest of the interrupted bar
    let r = this.gen.next(value);
    for (;;) {
      if (r.done) {
        this.genDone = true;
        break;
      }
      if (r.value.type === "bar") {
        this.stash = r.value;
        break;
      }
      const e = r.value;
      if (e.type === "outN") consoleText += `${e.value} `;
      else if (e.type === "outC") consoleText += safeFromCodePoint(e.codepoint);
      else if (e.type === "tone" && loaded) loaded.audio.playTone(e.midi);
      r = this.gen.next();
    }
    paintConsole();
    if (loaded) this.nextTime = Math.max(this.nextTime, loaded.audio.now() + 0.15);
    this.state = "running";
    updateToolbar();
  }

  stop(status = "— stopped"): void {
    this.finish(status);
  }

  private finish(status: string): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts = [];
    this.gen = null;
    this.state = "idle";
    consoleRunning = false;
    consoleStatus = status;
    clearHighlights();
    paintConsole();
    this.onFinish(status);
  }
}

function errorStatus(err: unknown): string {
  if (err instanceof RuntimeError) return `runtime error — ${err.message}`;
  return `error — ${err instanceof Error ? err.message : String(err)}`;
}

function safeFromCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "�";
  }
}

const runner = new Runner(() => updateToolbar());

// ---- typed input (IN) -------------------------------------------------------
function takeQueuedInput(): bigint | null {
  const field = document.getElementById("inputQueue") as HTMLInputElement | null;
  if (!field) return null;
  const parts = field.value.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const head = parts.shift()!;
  field.value = parts.join(" ");
  try {
    return BigInt(head);
  } catch {
    return null;
  }
}

function promptForInput(reg: Register, submit: (v: bigint) => void): void {
  const box = document.getElementById("inputPrompt")!;
  box.classList.add("visible");
  box.innerHTML = `<label>IN → R${reg}: <input id="inValue" type="text" inputmode="numeric" placeholder="number" /></label> <button id="inSubmit">crash ⟶ submit</button>`;
  const input = document.getElementById("inValue") as HTMLInputElement;
  const done = (): void => {
    let v: bigint;
    try {
      v = BigInt(input.value.trim() || "0");
    } catch {
      input.select();
      return;
    }
    box.classList.remove("visible");
    box.innerHTML = "";
    submit(v);
  };
  document.getElementById("inSubmit")!.addEventListener("click", done);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") done();
  });
  input.focus();
  updateToolbar();
}

// ---- grid editing -----------------------------------------------------------
function toggleCell(bar: number, step: number, sym: DrumSymbol): void {
  const hits = grid[bar]!.steps[step]!;
  const i = hits.indexOf(sym);
  if (i >= 0) hits.splice(i, 1);
  else hits.push(sym);
  reparse();
  renderEditor();
  if (i < 0 && loaded) loaded.audio.play(sym); // audible feedback on add
}

function reparse(): void {
  program = parse(grid);
}

function formatInstr(instr: Instruction): string {
  const parts: string[] = [instr.opcode];
  const args: string[] = [];
  if (instr.rd !== undefined) args.push(`R${instr.rd}`);
  if (instr.rs !== undefined) args.push(`R${instr.rs}`);
  if (instr.imm !== undefined) args.push(String(instr.imm));
  return parts.join(" ") + (args.length ? " " + args.join(", ") : "");
}

function lineLabel(line: Line): { text: string; kind: string } {
  if (line.kind === "code") return { text: formatInstr(line.instr), kind: "code" };
  if (line.kind === "groove") return { text: "· groove ·", kind: "groove" };
  return { text: "syntax error", kind: "error" };
}

// ---- rendering ---------------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fieldClass(step: number): string {
  if (step < 4) return "f-op";
  if (step < 8) return "f-reg";
  return "f-imm";
}

function renderEditor(): void {
  const editor = document.getElementById("editor")!;
  editor.innerHTML = "";
  grid.forEach((measure, b) => {
    editor.appendChild(renderBar(measure, b));
  });

  const addRow = el("div", "addbar");
  const addBtn = el("button", "btn", "+ add bar");
  addBtn.addEventListener("click", () => {
    grid.push({ steps: Array.from({ length: 16 }, () => [] as Step) });
    reparse();
    renderEditor();
  });
  const addGroove = el("button", "btn", "+ groove bar");
  addGroove.addEventListener("click", () => {
    grid.push(grooveMeasure());
    reparse();
    renderEditor();
  });
  addRow.append(addBtn, addGroove);
  editor.appendChild(addRow);

  renderStatus();
}

function renderBar(measure: MeasureGrid, b: number): HTMLElement {
  const line = program.lines[b]!;
  const { text, kind } = lineLabel(line);

  const bar = el("div", "bar");
  bar.dataset["bar"] = String(b + 1);

  const head = el("div", "barhead");
  head.append(
    el("span", "barnum", `bar ${b + 1}`),
    el("span", `barlabel ${kind}`, text),
  );
  const spacer = el("span", "spacer");
  const del = el("button", "btn small", "✕");
  del.title = "delete bar";
  del.addEventListener("click", () => {
    grid.splice(b, 1);
    if (grid.length === 0) grid.push({ steps: Array.from({ length: 16 }, () => []) });
    reparse();
    renderEditor();
  });
  const dup = el("button", "btn small", "⧉");
  dup.title = "duplicate bar";
  dup.addEventListener("click", () => {
    grid.splice(b + 1, 0, { steps: measure.steps.map((s) => [...s]) });
    reparse();
    renderEditor();
  });
  head.append(spacer, dup, del);
  bar.appendChild(head);

  const table = el("div", "lanes");
  for (const lane of LANES) {
    const row = el("div", "lane");
    row.appendChild(el("span", "lanelabel", lane.label));
    for (let s = 0; s < 16; s++) {
      const hits = measure.steps[s]!;
      const cell = el("button", `cell ${fieldClass(s)}${hits.includes(lane.sym) ? " on" : ""}`);
      cell.dataset["bar"] = String(b + 1);
      cell.dataset["step"] = String(s);
      if (s % 4 === 0) cell.classList.add("beat");
      cell.title = `${lane.label} · step ${s + 1}`;
      cell.addEventListener("click", () => toggleCell(b, s, lane.sym));
      row.appendChild(cell);
    }
    table.appendChild(row);
  }
  bar.appendChild(table);
  return bar;
}

function renderStatus(): void {
  const status = document.getElementById("status")!;
  if (program.errors.length === 0) {
    const codeBars = program.lines.filter((l) => l.kind === "code").length;
    status.className = "status ok";
    status.textContent = `✓ ${codeBars} code bar${codeBars === 1 ? "" : "s"}, no errors`;
  } else {
    status.className = "status bad";
    status.textContent = program.errors.map(formatError).join(" · ");
  }
  updateToolbar();
}

function highlightBar(bar: number): void {
  document.querySelectorAll(".bar.now").forEach((n) => n.classList.remove("now"));
  document.querySelector(`.bar[data-bar="${bar}"]`)?.classList.add("now");
}

function highlightStep(bar: number, step: number): void {
  document.querySelectorAll(".cell.playing").forEach((n) => n.classList.remove("playing"));
  document
    .querySelectorAll(`.cell[data-bar="${bar}"][data-step="${step}"]`)
    .forEach((n) => n.classList.add("playing"));
}

function clearHighlights(): void {
  document.querySelectorAll(".cell.playing").forEach((n) => n.classList.remove("playing"));
  document.querySelectorAll(".bar.now").forEach((n) => n.classList.remove("now"));
}

function updateToolbar(): void {
  const runBtn = document.getElementById("run") as HTMLButtonElement;
  const stopBtn = document.getElementById("stop") as HTMLButtonElement;
  const saveBtn = document.getElementById("save") as HTMLButtonElement;
  if (!runBtn) return;
  const busy = runner.state !== "idle";
  runBtn.disabled = busy || program.errors.length > 0;
  stopBtn.disabled = !busy;
  saveBtn.disabled = program.errors.length > 0;
}

// ---- save / open ------------------------------------------------------------
async function saveWav(): Promise<void> {
  const { kit } = await ensureAudio();
  const bytes = encode(grid, kit, { bpm });
  const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "program.wav";
  a.click();
  URL.revokeObjectURL(a.href);
  consoleStatus = `— saved program.wav (${(bytes.length / 1024).toFixed(0)} KB, ♩=${bpm}, count-in + ${grid.length} bars)`;
  paintConsole();
}

async function openWav(file: File): Promise<void> {
  try {
    const { kit } = await ensureAudio();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = decode(bytes, kit);
    grid = result.grid.length
      ? result.grid
      : [{ steps: Array.from({ length: 16 }, () => [] as Step) }];
    bpm = Math.round(result.bpm);
    (document.getElementById("tempo") as HTMLInputElement).value = String(bpm);
    document.getElementById("tempoVal")!.textContent = `♩ = ${bpm}`;
    reparse();
    renderEditor();
    consoleText = "";
    consoleStatus = `— opened ${file.name}: ${grid.length} bars at ♩=${Math.round(result.bpm)}`;
    paintConsole();
  } catch (err) {
    consoleStatus = `— cannot open ${file.name}: ${err instanceof Error ? err.message : err}`;
    paintConsole();
  }
}

// ---- shell -------------------------------------------------------------------
function renderShell(): void {
  app.innerHTML = "";

  const header = el("header");
  header.appendChild(el("h1", undefined, "Cadence"));
  header.appendChild(el("p", "tag", "the source code is a drum performance"));
  app.appendChild(header);

  // toolbar
  const bar = el("div", "toolbar");
  const runBtn = el("button", "btn primary", "▶ run");
  runBtn.id = "run";
  runBtn.addEventListener("click", () => void runner.start());
  const stopBtn = el("button", "btn", "■ stop");
  stopBtn.id = "stop";
  stopBtn.addEventListener("click", () => runner.stop());

  const tempoWrap = el("span", "tempo");
  const tempoVal = el("span", "tempoval", `♩ = ${bpm}`);
  tempoVal.id = "tempoVal";
  const tempo = document.createElement("input");
  tempo.type = "range";
  tempo.id = "tempo";
  tempo.min = "40";
  tempo.max = "240";
  tempo.step = "5";
  tempo.value = String(bpm);
  tempo.addEventListener("input", () => {
    bpm = Number(tempo.value);
    tempoVal.textContent = `♩ = ${bpm}`;
  });
  tempoWrap.append(tempo, tempoVal);

  const inputQueue = document.createElement("input");
  inputQueue.type = "text";
  inputQueue.id = "inputQueue";
  inputQueue.placeholder = "IN queue, e.g. 5 1 0";
  inputQueue.title = "values consumed by IN instructions, in order";

  const examples = document.createElement("select");
  examples.id = "examples";
  examples.appendChild(new Option("examples…", ""));
  for (const name of Object.keys(EXAMPLES)) examples.appendChild(new Option(name, name));
  examples.addEventListener("change", () => {
    const name = examples.value;
    if (!name) return;
    grid = assemble(EXAMPLES[name]!);
    reparse();
    renderEditor();
    consoleText = "";
    consoleStatus = `— loaded example: ${name}`;
    paintConsole();
    examples.value = "";
  });

  const saveBtn = el("button", "btn", "⤓ save .wav");
  saveBtn.id = "save";
  saveBtn.addEventListener("click", () => void saveWav());

  const openBtn = el("button", "btn", "⤒ open .wav");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".wav,audio/wav";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) void openWav(f);
    fileInput.value = "";
  });
  openBtn.addEventListener("click", () => fileInput.click());

  bar.append(runBtn, stopBtn, tempoWrap, inputQueue, examples, saveBtn, openBtn, fileInput);
  app.appendChild(bar);

  // kit audition pads
  const kitRow = el("div", "kitrow");
  kitRow.appendChild(el("span", "kitlabel", "kit:"));
  for (const lane of [...LANES].reverse()) {
    const pad = el("button", "btn pad", lane.label);
    pad.addEventListener("click", async () => {
      const { audio } = await ensureAudio();
      audio.play(lane.sym);
    });
    kitRow.appendChild(pad);
  }
  const clickPad = el("button", "btn pad", "Stick (count-in)");
  clickPad.addEventListener("click", async () => {
    const { audio } = await ensureAudio();
    audio.play("CLICK");
  });
  const tonePad = el("button", "btn pad", "Tone C4→C5");
  tonePad.addEventListener("click", async () => {
    const { audio } = await ensureAudio();
    [60, 62, 64, 65, 67, 69, 71, 72].forEach((n, i) => audio.playTone(n, audio.now() + i * 0.18));
  });
  kitRow.append(clickPad, tonePad);
  app.appendChild(kitRow);

  const status = el("div", "status");
  status.id = "status";
  app.appendChild(status);

  const inputPrompt = el("div", "inputprompt");
  inputPrompt.id = "inputPrompt";
  app.appendChild(inputPrompt);

  const editor = el("div", "editor");
  editor.id = "editor";
  app.appendChild(editor);

  const consolePane = el("pre", "console");
  consolePane.id = "console";
  app.appendChild(consolePane);

  if (loadError) {
    consoleStatus = `— audio failed to load: ${loadError}`;
  }
  renderEditor();
  paintConsole();
}

renderShell();
// preload the kit in the background so the first Run is instant
KitAudio.load()
  .then((l) => {
    loaded = l;
  })
  .catch((err) => {
    loadError = err instanceof Error ? err.message : String(err);
    consoleStatus = `— audio failed to load: ${loadError}`;
    paintConsole();
  });
