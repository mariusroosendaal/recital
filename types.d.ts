// The shape of a scenario, for editors: put this above a scenario's export
//
//   /** @type {import("recitaljs").Scenario} */
//
// and editors suggest its keys, actions and options, and show what each does; with
// `// @ts-check` at the top of the file, a typo is underlined as you type. Fixed values, such
// as `in: "editor"`, are suggested but any string fits, so steps shared between scenarios,
// where TypeScript widens them to strings, still check.

/** `[x, y]`: CSS px of the viewport (1600×900 unless `viewport` sets it), or fractions of a box (an array, so pairs built in helpers fit too) */
export type Point = number[];

declare global {
  /** Figma's plugin API, in `eval` steps run in the editor (any: install @figma/plugin-typings for its own types) */
  const figma: any;
}

/** The cursor's shape over a target; otherwise it follows the element's CSS cursor */
export type CursorShape = "arrow" | "pointer" | "text" | "crosshair" | "move" | "resize-ew" | "resize-ns" | "hand-open" | "hand-closed" | (string & {});

interface TargetOptions {
  /** A point in the target's box, as fractions: `[0.5, 0.5]` (default) is its centre */
  at?: Point;
  /** px added to that point */
  offset?: Point;
  /** The cursor's shape there */
  cursor?: CursorShape;
  /** An iframe's selector: the target is looked up in it, such as an embedded checkout or editor */
  frame?: string;
}

/** An element of the page: any Playwright selector, such as `role=button[name='Save']` */
export interface UiTarget extends TargetOptions {
  ui: string;
}
/** A point, in CSS px of the viewport */
export interface PointTarget extends TargetOptions {
  point: Point;
}
/** Figma adapter: an element in the plugin's window; `":root"` is the window itself */
export interface PluginTarget extends TargetOptions {
  plugin: string;
}
/** Figma adapter: a layer under the stage, by its path of layer names, such as `"xl/header"` */
export interface CanvasTarget extends TargetOptions {
  canvas: string;
}
export type Target = UiTarget | PointTarget | PluginTarget | CanvasTarget;

/** Options any step can have */
export interface StepOptions {
  /** The step's name, for `narration`, `camera` and clips (`part · name` makes clips per part) */
  label?: string;
  /** ms to hold once the screen has stopped changing */
  hold?: number;
  /** Makes this step's move and hold faster (2) or slower (0.5) */
  speed?: number;
  /** The move's length in ms; otherwise it comes from the distance */
  ms?: number;
  /** A target to wait for after the step, before the hold */
  waitFor?: Target;
  /** ms to wait for `waitFor` (30 000) */
  timeout?: number;
  /** ms of the wait to keep in the video; the rest is cut */
  cut?: number;
  /** Run the step only if this target is visible */
  when?: Target;
  /** Run the step only if this target isn't visible */
  unless?: Target;
  /** `false`: don't wait for the screen to settle before the hold */
  settle?: boolean;
  /** On a `tab` step: ms of a cross-fade into the new tab */
  dissolve?: number;
  /** With `dissolve`: dip through this colour instead */
  through?: "white" | "black" | (string & {});
  /** ms between the cursor arriving and the click, or between scroll flicks */
  pause?: number;
}

export interface MoveStep extends StepOptions {
  /** Moves the cursor to the target */
  move: Target;
}
export interface ClickStep extends StepOptions {
  /** Moves the cursor to the target and clicks */
  click: Target;
  /** Keys held through the click, such as `["Shift"]` */
  modifiers?: string[];
}
export interface DragStep extends StepOptions {
  /** Drags from the target, `to` another or `by` px */
  drag: Target;
  to?: Target;
  by?: Point;
}
export interface CheckStep extends StepOptions {
  /** Clicks a checkbox only if it isn't already `value` */
  check: Target;
  /** The state wanted (true) */
  value?: boolean;
}
export interface TypeStep extends StepOptions {
  /** Types the text, a key at a time */
  type: string;
  /** Clicks this target first */
  into?: Target;
  /** Selects all and deletes it first */
  clear?: boolean;
  /** ms a key (75) */
  delay?: number;
}
export interface PasteStep extends StepOptions {
  /** Puts the text in at once, as pasting does */
  paste: string;
  into?: Target;
}
export interface PressStep extends StepOptions {
  /** A key or keys, such as `"Enter"` or `"Meta+A"` */
  press: string | string[];
  /** Figma adapter: `"editor"` sends the keys to the canvas even when the plugin had focus */
  in?: "editor" | (string & {});
}
export interface ChooseFilesStep extends StepOptions {
  /** Clicks a file picker and gives it `files` */
  chooseFiles: Target;
  files: string[];
}
export interface ScrollStep extends StepOptions {
  /** Scrolls the page: to a target, by px, or to `{ top }`, a scroll position or a list of stops, in trackpad-like flicks */
  scroll: Target | number | { top: number | number[] };
  /** For a target: where in the viewport it ends up, from the top (0.5) */
  to?: number;
  /** px a flick, about (1100) */
  flick?: number;
  /** Exactly this many flicks, or this many per stop */
  flicks?: number | number[];
}
export interface WheelStep extends StepOptions {
  /** Scrolls whatever is under the target, such as an inner list */
  wheel: Target;
  /** px (600) */
  by?: number;
  /** How long it takes, in ms (1500) */
  scrollMs?: number;
}
export interface TabStep extends StepOptions {
  /** Brings a tab from `tabs` (or `"main"`) to the front and carries on there */
  tab: string;
}
export interface WaitForStep extends Omit<StepOptions, "waitFor"> {
  /** Waits until the target shows, or with `state: "hidden"` goes */
  waitFor: Target;
  state?: "visible" | "hidden" | "attached" | "detached" | (string & {});
}
export interface HoldStep extends Omit<StepOptions, "hold"> {
  /** Waits this many ms */
  hold: number;
}
export interface CursorStep extends StepOptions {
  /** Places the cursor, without moving it */
  cursor: Point;
}
export interface EvalStep extends StepOptions {
  /** Runs a function in the page (in Figma, with the plugin API as `figma`) */
  eval: (arg?: any) => unknown;
  arg?: unknown;
}

export interface OpenPluginStep extends StepOptions {
  /** Figma adapter: runs the scenario's `plugin` through Quick actions and waits for its `ready`; `cut` keeps that much of the loading */
  openPlugin: true;
}
export interface StageStep extends StepOptions {
  /** Figma adapter: `keep` empties the stage frame but for these layers; `remove` deletes these from a stage page */
  stage: { keep?: string[]; remove?: string[] };
}
export interface View {
  /** A layer path, a list of them, or `"*"` for everything on the stage */
  layer?: string | string[];
  zoom?: number;
  /** Picks the zoom that fits the layer's width or height */
  fit?: "width" | "height" | (string & {});
  /** px around the layer with `fit` (40) */
  margin?: number;
  /** The point of the layer to place, as fractions of its box ([0.5, 0.5]) */
  anchor?: Point;
  /** Where on the canvas it goes, as fractions ([0.5, 0.5]) */
  to?: Point;
  /** Without `layer`: the canvas point at the centre */
  center?: Point;
}
export interface ViewStep extends StepOptions {
  /** Figma adapter: frames the canvas */
  view: View;
  /** ms to ease the camera there */
  animate?: number;
  /** Where the cursor goes during the move (off the nearest edge), or `false` to leave it */
  park?: Point | false;
}
export interface DeselectStep extends StepOptions {
  /** Figma adapter: clears the selection with a click on empty canvas; skipped when nothing is selected */
  deselect: true;
}
export interface WaitForImagesStep extends StepOptions {
  /** Figma adapter: waits until the page's image fills are downloaded and drawn */
  waitForImages: true;
}

export type Step =
  | MoveStep | ClickStep | DragStep | CheckStep | TypeStep | PasteStep | PressStep | ChooseFilesStep
  | ScrollStep | WheelStep | TabStep | WaitForStep | HoldStep | CursorStep | EvalStep
  | OpenPluginStep | StageStep | ViewStep | DeselectStep | WaitForImagesStep;

export interface NarrationLine {
  /** The label of the step the line starts at */
  at: string;
  /** The line, as the subtitle shows it */
  text: string;
  /** What's spoken, where `text` would be mispronounced */
  say?: string;
  /** Seconds more before the next narrated step */
  pause?: number;
}

export interface Narrator {
  /** Kokoro (local, the default) or ElevenLabs (ELEVENLABS_API_KEY in .env) */
  provider?: "kokoro" | "elevenlabs" | (string & {});
  /** Kokoro: one of its voices, such as `"af_heart"`; ElevenLabs: a voice in your account, by name */
  voice?: string;
  speed?: number;
  /** ElevenLabs (0.5) */
  stability?: number;
  /** ElevenLabs (0) */
  style?: number;
  /** ElevenLabs: for repeatable takes */
  seed?: number;
  /** ElevenLabs: `"eleven_multilingual_v2"` (default), or `"eleven_v3"`, which reads audio tags */
  model?: string;
  /** ElevenLabs: put before each line, such as `"[calm]"` */
  tag?: string;
  /** Settings for the last line alone, such as `{ speed: 0.92 }` */
  last?: Omit<Narrator, "provider" | "voice" | "last">;
}

export interface CameraShot {
  /** The label of the step the framing starts at */
  at: string;
  /** The point to centre, in CSS px of the viewport */
  center?: Point;
  /** 1 is the whole frame; up to 1.67 stays sharp */
  zoom?: number;
  /** The move's length in ms (900) */
  ms?: number;
}

export interface Scenario {
  /** The page the take starts on */
  url?: string;
  /** Figma adapter: the file, whose `node-id` is the stage (a frame, or the page) */
  file?: string;
  /** A built-in adapter by name, or your own (docs/adapters.md); otherwise `file` picks Figma's */
  adapter?: "figma" | (string & {}) | Adapter;
  /** Figma adapter: `name` for Quick actions, `ready`: a selector that exists once its UI has loaded */
  plugin?: { name: string; ready: string };
  /** Steps before the take, not recorded */
  setup?: Step[];
  /** The take */
  steps: Step[];
  /** Steps after the take, not recorded */
  teardown?: Step[];
  theme?: "light" | "dark" | (string & {});
  /** The page's size in CSS px: 1600×900 (default); `{ width: 390, height: 844 }` for a phone */
  viewport?: { width: number; height: number };
  /** Pixel ratio: 2 (default) records the viewport at twice its size, 3200×1800; 1.2 records 1920×1080 */
  scale?: number;
  /** Makes every move and hold faster (1.25) */
  speed?: number;
  /** Scales only the holds (0.5 halves them) */
  pauses?: number;
  /** ms before the first step (800) */
  leadIn?: number;
  /** ms after the last (1500) */
  tail?: number;
  /** Requests answered from local files, with CORS headers: `{ "<url glob>": "<file>" }`, or a function from the URL to the file */
  routes?: Record<string, string | ((url: string) => string)>;
  /** Other tabs, by name, for `tab` steps */
  tabs?: Record<string, string>;
  /** Lines spoken from the start of steps; also the subtitles */
  narration?: NarrationLine[];
  narrator?: Narrator;
  /** The voice of the final video, when it isn't the narrator's */
  voice?: string;
  /** The final video's name in output/final/, when it isn't the demo's */
  final?: string;
  /**
   * The cursor: `"macos"` (default; this Mac's own, made on first use, else `"minimal"`) and `"macos-large"`
   * (half as big again), `"minimal"` (our own, in macOS's manner), `"dot"`, or `"figma"` (Figma's own, the
   * Figma adapter's default)
   */
  cursors?: "macos" | "macos-large" | "minimal" | "dot" | "figma" | (string & {});
  /** Framings for `camera`, each from the start of a step */
  camera?: CameraShot[];
}

/**
 * The run's state, as adapters and `eval` see it. An adapter's `extend` adds its own, such as
 * Figma's `ctx.plugin()`.
 */
export interface Context {
  page: import("playwright").Page;
  /** The scenario's tabs, by name; `main` is the one it starts in */
  tabs: Record<string, import("playwright").Page>;
  scenario: Scenario;
  adapter: Adapter | null;
  /** Runs `wait`, keeping `cut` ms of it in the video and dropping the rest */
  keepOnly(cut: number | undefined, wait: () => Promise<unknown>): Promise<void>;
  [key: string]: any;
}

/**
 * Teaches recital an app that needs more than selectors: how to open it, its own targets and
 * actions. Every member is optional but `name`. docs/adapters.md has an example; src/figma.js
 * is a full one.
 */
export interface Adapter {
  name: string;
  /** Picks this adapter for a scenario that doesn't name one (built-in adapters only) */
  matches?(scenario: Scenario): boolean;
  /** Scenario keys it reads, such as Figma's `file` and `plugin` */
  keys?: string[];
  /** Step options its actions read */
  options?: string[];
  /** The cursor set, when the scenario doesn't choose one */
  cursors?: Scenario["cursors"];
  /** Where `demo login <adapter or scenario>` opens */
  login?: string;
  /** The page the take starts on, when it isn't the scenario's `url` */
  url?(scenario: Scenario): string | undefined;
  /** When the first page counts as loaded (`"load"`) */
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  /** Before the first page: routes, permissions */
  prepare?(context: import("playwright").BrowserContext): Promise<void>;
  /** Once the first page has loaded, until the app is ready */
  open?(page: import("playwright").Page, scenario: Scenario): Promise<void>;
  /** Before the browser closes */
  close?(page: import("playwright").Page): Promise<void>;
  /** Adds to the run's context */
  extend?(ctx: Context): void;
  /** Targets whose selector is looked up in a frame of its own: `{ <key>: selector }` */
  frames?: Record<string, (ctx: Context) => Promise<import("playwright").Frame>>;
  /** Targets with a box of their own, in CSS px of the viewport */
  boxes?: Record<string, (ctx: Context, target: any) => Promise<{ x: number; y: number; width: number; height: number }>>;
  /** Places `press` can send keys to with `in` */
  focus?: Record<string, (ctx: Context) => Promise<unknown>>;
  /** ms to hold after each of its actions */
  holds?: Record<string, number>;
  /** Its actions: `{ <action>: value, ...options }`; `false` means skipped, `{ waited: true }` that it used `waitFor` */
  actions?: Record<string, (ctx: Context, value: any, step: any) => Promise<void | false | { waited?: boolean }>>;
}
