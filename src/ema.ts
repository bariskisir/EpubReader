// Offline Turkish TTS with EMA Lightning running fully in the browser
// (onnxruntime-web WebGPU/WASM + ONNX, no server/API).
// Model files (~35MB fp32) download on first use from Hugging Face and are
// cached in Cache Storage afterwards. Engine is a port of
// https://github.com/ozcancelik/ema-lightning-web (tts.js / normalizer.js).

export const EMA_VOICE_OPTIONS = [
  { value: "ema-kalin", label: "Kalın" },
  { value: "ema-normal", label: "Normal" },
  { value: "ema-cocuk", label: "Çocuk" }
] as const;

export const EMA_LANGUAGE_OPTIONS = [{ value: "tr-TR", label: "Turkish" }] as const;

export const DEFAULT_EMA_VOICE = "ema-normal";

export const EMA_SAMPLE_RATE = 48000;

// Pitch shift in semitones per voice, matching the presets of the reference demo.
const EMA_VOICE_PITCH: Record<string, number> = {
  "ema-kalin": -2.5,
  "ema-normal": 0,
  "ema-cocuk": 3
};

const EMA_BASE_URL = "https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/";
const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const EMA_CACHE = "ema-models-v1";

export function isEmaVoiceId(value: string): boolean {
  return (EMA_VOICE_OPTIONS as readonly { value: string }[]).some((option) => option.value === value);
}

export function isEmaSupported(): boolean {
  return typeof WebAssembly !== "undefined";
}

// ---------- model file cache ----------

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("ema-models-") && key !== EMA_CACHE).map((key) => caches.delete(key)));
    cache = await caches.open(EMA_CACHE);
  } catch {
    cache = null;
  }
  try {
    const hit = await cache?.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    // Cache read failed: fall through to network.
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`The EMA model file could not be downloaded (HTTP ${response.status}).`);
  }
  try {
    await cache?.put(url, response.clone());
  } catch {
    // Storage full or unavailable: playback still works, just not cached.
  }
  return await response.arrayBuffer();
}

// ---------- normalizer-tr (Rust) compiled to WebAssembly ----------

type NormalizerFn = (text: string) => string;

async function loadNormalizer(source: ArrayBuffer): Promise<NormalizerFn> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const { instance } = await WebAssembly.instantiate(source, {});
  const wasm = instance.exports as unknown as {
    memory: WebAssembly.Memory;
    alloc(size: number): number;
    dealloc(ptr: number, size: number): void;
    normalize(ptr: number, len: number): void;
    result_ptr(): number;
    result_len(): number;
  };
  return (text: string) => {
    const input = encoder.encode(text);
    const ptr = wasm.alloc(input.length);
    new Uint8Array(wasm.memory.buffer, ptr, input.length).set(input);
    wasm.normalize(ptr, input.length);
    wasm.dealloc(ptr, input.length);
    return decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.result_ptr(), wasm.result_len()));
  };
}

// ---------- text frontend ----------

const TURKISH_LETTERS = new Set("çğıöşüÇĞİÖŞÜ");
const TYPOGRAPHY: Record<string, string> = {
  "’": "'",
  "‘": "'",
  "ʼ": "'",
  "´": "'",
  "`": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "«": '"',
  "»": '"',
  "–": "-",
  "—": "-",
  "−": "-",
  "…": "..."
};
const UNSAFE_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f؜‎‏‪-‮⁦-⁩]/g;
const BLOCK_BYTES = 8 * 1024;

function splitBlocks(text: string): string[] {
  const out: string[] = [];
  let block: string[] = [];
  let size = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const n = new TextEncoder().encode(word).length + 1;
    if (block.length && size + n > BLOCK_BYTES) {
      out.push(block.join(" "));
      block = [];
      size = 0;
    }
    block.push(word);
    size += n;
  }
  if (block.length) out.push(block.join(" "));
  return out;
}

function applyAlphabet(text: string, vocab: Set<string>): string {
  text = text.replace(UNSAFE_CHARS, " ");
  text = [...text].map((ch) => TYPOGRAPHY[ch] ?? ch).join("");
  text = text.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
  let out = "";
  for (const ch of text) {
    const base = TURKISH_LETTERS.has(ch) ? ch : ch.normalize("NFKD").replace(/\p{M}/gu, "");
    out += base && [...base].every((c) => vocab.has(c)) ? base : " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

function frontend(text: string, vocab: Set<string>, normalize: NormalizerFn): string {
  text = text.replace(UNSAFE_CHARS, " ");
  if (!text.trim()) return "";
  return applyAlphabet(splitBlocks(text).map(normalize).join(" "), vocab);
}

// ---------- chunker ----------

const LETTERS_PER_SECOND = 18;
const MAX_SECONDS = 10;
const MAX_LETTERS = 250;
const SENTENCE_PAUSE = 0.25;
const CLAUSE_PAUSE = 0.12;
const CUT_PATTERNS: [RegExp, number][] = [
  [/[.!?]+["')]*(?= )/g, SENTENCE_PAUSE],
  [/[,;:](?= )/g, CLAUSE_PAUSE],
  [/\S(?= )/g, CLAUSE_PAUSE]
];

function finishPiece(piece: string): string {
  if (/[.!?]$/.test(piece.replace(/["')]+$/, ""))) return piece;
  return piece.replace(/[,;:\- ]+$/, "") + ".";
}

function chunkText(text: string, speed: number): [string, number][] {
  const limit = Math.floor(Math.min(MAX_LETTERS, LETTERS_PER_SECOND * MAX_SECONDS * speed));
  const pieces: [string, number][] = [];
  let rest = text.trim();
  while (rest) {
    let cut = rest.length;
    let pause = 0;
    if (rest.length > limit) {
      cut = limit;
      const head = rest.slice(0, limit + 1);
      for (const [pattern, gap] of CUT_PATTERNS) {
        const ends = [...head.matchAll(pattern)].map((m) => (m.index ?? 0) + m[0].length);
        if (ends.length) {
          cut = ends[ends.length - 1];
          pause = gap;
          break;
        }
      }
    }
    const piece = rest.slice(0, cut).trim();
    rest = rest.slice(cut).trim();
    if (/\p{L}/u.test(piece)) pieces.push([finishPiece(piece), pause]);
  }
  if (pieces.length) pieces[pieces.length - 1][1] = 0;
  return pieces;
}

// ---------- seeded Gaussian noise ----------

function gaussianNoise(seed: number): (n: number) => Float32Array {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (n: number) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 2) {
      const r = Math.sqrt(-2 * Math.log(1 - uniform()));
      const th = 2 * Math.PI * uniform();
      out[i] = r * Math.cos(th);
      if (i + 1 < n) out[i + 1] = r * Math.sin(th);
    }
    return out;
  };
}

// ---------- frame planning ----------

const FIRST_WINDOW = 25;
const WINDOW = 100;
const CONTEXT = 8;
const MAX_WORD_FRAMES = 250;
const MAX_FRAMES = 3000;

function wordIndices(text: string): { cw: number[]; wstart: number[] } {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " " && (i === 0 || text[i - 1] === " ")) starts.push(i);
  }
  if (!starts.length) starts.push(0);
  const bounds = [0, ...starts.slice(1), text.length];
  const cw: number[] = [];
  const wstart: number[] = [];
  for (let w = 0; w + 1 < bounds.length; w++) {
    for (let i = bounds[w]; i < bounds[w + 1]; i++) {
      cw.push(w);
      wstart.push(bounds[w]);
    }
  }
  return { cw, wstart };
}

function planFrames(cw: number[], wstart: number[], dur: ArrayLike<number>, speed: number) {
  const L = cw.length;
  const nWords = cw[L - 1] + 1;
  const d = Float32Array.from(dur, (x) => x / speed);
  const sums = new Float64Array(nWords);
  for (let i = 0; i < L; i++) sums[cw[i]] += d[i];
  const counts = Array.from(sums, (s) => Math.min(MAX_WORD_FRAMES, Math.max(1, Math.round(s))));
  const T = Math.min(
    counts.reduce((a, b) => a + b, 0),
    MAX_FRAMES
  );
  const fw = new Int32Array(T);
  const fp = new Float32Array(T);
  for (let w = 0, f = 0; w < nWords; w++) {
    for (let j = 0; j < counts[w] && f < T; j++, f++) {
      fw[f] = w;
      fp[f] = j / counts[w];
    }
  }
  const c = Float32Array.from(d, (x) => Math.max(x, 1e-4));
  const done = new Float32Array(L);
  const total = new Float32Array(nWords);
  for (let i = 0, acc = 0; i < L; i++) {
    acc += c[i];
    done[i] = acc;
    total[cw[i]] += c[i];
  }
  const wlen = new Float32Array(nWords);
  for (const w of cw) wlen[w] += 1;
  const woff = new Float32Array(nWords);
  for (let w = 1; w < nWords; w++) woff[w] = woff[w - 1] + Math.max(wlen[w - 1], 1);
  const cg = new Float32Array(L);
  const fg = new Float32Array(T);
  for (let i = 0; i < L; i++) {
    const wordStart = done[wstart[i]] - c[wstart[i]];
    const cp = Math.min(1, Math.max(0, (done[i] - wordStart - 0.5 * c[i]) / Math.max(total[cw[i]], 1e-8)));
    cg[i] = woff[cw[i]] + cp * Math.max(wlen[cw[i]], 1);
  }
  for (let f = 0; f < T; f++) fg[f] = woff[fw[f]] + fp[f] * Math.max(wlen[fw[f]], 1);
  return { T, fw, cg, fg };
}

function windowSpans(frames: number, first: number): [number, number][] {
  const spans: [number, number][] = [];
  for (let s = 0; s < frames; ) {
    const e = Math.min(frames, s + (s === 0 ? first : WINDOW));
    spans.push([s, e]);
    s = e;
  }
  return spans;
}

// ---------- pitch shift (same as the reference demo) ----------

function pitchRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

// Plays a stream of chunks `ratio` times faster by linear interpolation,
// carrying the read position and the last sample across chunks so there
// are no clicks at the joins.
function makeResampler(ratio: number): (x: Float32Array) => Float32Array {
  if (ratio === 1) return (x) => x;
  let pos = 0;
  let prev = 0;
  return (x: Float32Array) => {
    const n = x.length;
    const y = new Float32Array(Math.ceil((n - pos) / ratio) + 1);
    let k = 0;
    for (; pos <= n - 1; pos += ratio) {
      const i = Math.floor(pos);
      const f = pos - i;
      const a = i < 0 ? prev : x[i];
      const b = i + 1 < n ? x[i + 1] : a;
      y[k++] = a + (b - a) * f;
    }
    pos -= n;
    prev = x[n - 1];
    return y.subarray(0, k);
  };
}

function wavBlobFromChunks(chunks: Float32Array[]): Blob {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + 2 * n);
  const v = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + 2 * n, true);
  writeStr(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, EMA_SAMPLE_RATE, true);
  v.setUint32(28, EMA_SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, "data");
  v.setUint32(40, 2 * n, true);
  let o = 44;
  for (const chunk of chunks) {
    for (const x of chunk) {
      v.setInt16(o, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true);
      o += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

// ---------- engine ----------

interface EmaMeta {
  vocab: string[];
  times: number[];
  latent_dim: number;
  hop: number;
  sample_rate: number;
}

interface OrtNamespace {
  Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
  InferenceSession: { create(buffer: ArrayBuffer, opts: unknown): Promise<OrtSession> };
  env: { wasm: { wasmPaths: string } };
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { getData(): Promise<Float32Array> }>>;
  release(): Promise<void>;
}

let ortNs: OrtNamespace | null = null;
let ortBackend: string | null = null;

async function loadOrt(backend: "webgpu" | "wasm"): Promise<OrtNamespace> {
  if (ortNs && ortBackend === backend) return ortNs;
  const url = ORT_CDN + (backend === "webgpu" ? "ort.webgpu.min.mjs" : "ort.wasm.min.mjs");
  const mod = (await import(/* @vite-ignore */ url)) as OrtNamespace | { default?: OrtNamespace };
  const ns = ("Tensor" in (mod as Record<string, unknown>) ? mod : (mod as { default: OrtNamespace }).default) as OrtNamespace;
  ns.env.wasm.wasmPaths = ORT_CDN;
  ortNs = ns;
  ortBackend = backend;
  return ns;
}

function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function preferredBackend(): "webgpu" | "wasm" {
  if (isIosDevice()) return "wasm";
  const nav = navigator as Navigator & { gpu?: unknown };
  return nav.gpu ? "webgpu" : "wasm";
}

class EmaEngine {
  private meta: EmaMeta;
  private text: OrtSession;
  private sound: OrtSession;
  private decoder: OrtSession;
  private normalize: NormalizerFn;
  private vocabSet: Set<string>;
  private stoi: Map<string, number>;
  private runQueue: Promise<void> = Promise.resolve();

  constructor(meta: EmaMeta, sessions: { text: OrtSession; sound: OrtSession; decoder: OrtSession }, normalize: NormalizerFn) {
    this.meta = meta;
    this.text = sessions.text;
    this.sound = sessions.sound;
    this.decoder = sessions.decoder;
    this.normalize = normalize;
    this.vocabSet = new Set(meta.vocab.filter((v) => v.length === 1));
    this.stoi = new Map(meta.vocab.map((ch, i) => [ch, i]));
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.runQueue.then(fn);
    this.runQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  pieces(text: string, speed: number): [string, number][] {
    return chunkText(frontend(text, this.vocabSet, this.normalize), speed);
  }

  async *stream(
    text: string,
    options: { speed?: number; seed?: number } = {}
  ): AsyncGenerator<Float32Array, void, void> {
    const { speed = 1, seed = 0 } = options;
    const ort = ortNs;
    if (!ort) throw new Error("The EMA engine is not loaded.");
    const i64 = (arr: ArrayLike<number>) =>
      new ort.Tensor("int64", BigInt64Array.from(Array.from(arr), (x) => BigInt(x)), [1, arr.length]);
    const f32 = (arr: Float32Array, dims: number[]) => new ort.Tensor("float32", arr, dims);
    const pieces = this.pieces(text, speed);
    const nSteps = this.meta.times.length;
    const D = this.meta.latent_dim;
    const hop = this.meta.hop;
    for (let k = 0; k < pieces.length; k++) {
      const [piece, pause] = pieces[k];
      const ids = [...piece].map((ch) => this.stoi.get(ch) ?? 1);
      const { cw, wstart } = wordIndices(piece);
      const { h, dur } = await this.enqueue(() => this.text.run({ ids: i64(ids) }));
      const durArr = await dur.getData();
      const { T, fw, cg, fg } = planFrames(cw, wstart, durArr, speed);
      const noise = gaussianNoise(seed * 1000003 + k)(nSteps * T * D);
      const { latents } = await this.enqueue(() =>
        this.sound.run({
          h,
          cg: f32(cg, [1, cg.length]),
          fg: f32(fg, [1, T]),
          cw: i64(cw),
          fw: i64(Array.from(fw)),
          noise: f32(noise, [1, nSteps, T, D])
        })
      );
      const lat = await latents.getData();
      for (const [s, e] of windowSpans(T, k === 0 ? FIRST_WINDOW : WINDOW)) {
        const a = Math.max(0, s - CONTEXT);
        const b = Math.min(T, e + CONTEXT);
        const n = b - a;
        const z = new Float32Array(D * n);
        for (let f = 0; f < n; f++) {
          for (let d = 0; d < D; d++) z[d * n + f] = lat[(a + f) * D + d];
        }
        const { audio } = await this.enqueue(() => this.decoder.run({ z: f32(z, [1, D, n]) }));
        const wav = (await audio.getData()).slice((s - a) * hop, (e - a) * hop);
        yield wav;
      }
      if (pause) yield new Float32Array(Math.round(pause * EMA_SAMPLE_RATE));
    }
  }

  async release(): Promise<void> {
    for (const s of [this.text, this.sound, this.decoder]) {
      await s?.release().catch(() => undefined);
    }
  }
}

let enginePromise: Promise<EmaEngine> | null = null;

async function loadEngine(): Promise<EmaEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const backend = preferredBackend();
      const tryBackends: ("webgpu" | "wasm")[] = backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"];
      let lastError: unknown = null;
      for (const current of tryBackends) {
        try {
          await loadOrt(current);
          const meta = (await (await fetch(EMA_BASE_URL + "meta.json")).json()) as EmaMeta;
          const opts =
            current === "webgpu"
              ? { executionProviders: ["webgpu", "wasm"], graphOptimizationLevel: "all" }
              : { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
          const ort = ortNs as OrtNamespace;
          const normalize = await loadNormalizer(await fetchBytes(EMA_BASE_URL + "normalizer.wasm"));
          const names = ["text", "sound", "decoder"] as const;
          const sessions = {} as Record<(typeof names)[number], OrtSession>;
          for (const name of names) {
            const buf = await fetchBytes(EMA_BASE_URL + name + ".onnx");
            sessions[name] = await ort.InferenceSession.create(buf, opts);
          }
          const engine = new EmaEngine(meta, sessions, normalize);
          // Compile shaders / warm up so the first real page starts fast.
          try {
            for await (const _ of engine.stream("Merhaba.")) {
              // warmup output is discarded
            }
          } catch {
            // Warmup failure is not fatal; real synthesis will surface errors.
          }
          return engine;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("The EMA engine could not be loaded.");
    })();
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

export async function generateEmaWav(text: string, voice: string): Promise<Blob> {
  const voiceId = isEmaVoiceId(voice) ? voice : DEFAULT_EMA_VOICE;
  const pitch = EMA_VOICE_PITCH[voiceId] ?? 0;
  const ratio = pitchRatio(pitch);
  const engine = await loadEngine();
  // Pitch is shifted by resampling; the model runs faster/slower to compensate
  // so the duration stays the same (same technique as the reference demo).
  const stream = engine.stream(text, { speed: 1 / ratio, seed: 0 });
  const shift = makeResampler(ratio);
  const chunks: Float32Array[] = [];
  for await (const raw of stream) {
    const out = shift(raw);
    if (out.length) chunks.push(out);
  }
  if (!chunks.length) {
    throw new Error("The EMA audio could not be generated.");
  }
  return wavBlobFromChunks(chunks);
}
