import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction
} from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  BookMarked,
  ChevronRight,
  LoaderCircle,
  Minus,
  PanelLeft,
  Pause,
  Play,
  Plus,
  Trash2,
  Upload,
  X
} from "lucide-react";
import "./styles.css";
import { trackAppStartup } from "./telemetry";
import {
  DEFAULT_PIPER_VOICE,
  PIPER_LANGUAGE_OPTIONS,
  PIPER_VOICE_OPTIONS,
  generatePiperWav,
  isPiperSupported,
  isPiperVoiceId
} from "./piper";
import {
  DEFAULT_EMA_VOICE,
  EMA_LANGUAGE_OPTIONS,
  EMA_VOICE_OPTIONS,
  generateEmaWav,
  isEmaSupported,
  isEmaVoiceId
} from "./ema";
import {
  getDefaultViewSettings,
  getMaxInlineSize,
  type DefaultFont,
  type ReaderThemeCode,
  type ViewSettings
} from "./reader/settings";
import { getStyles, transformStylesheet } from "./reader/style";
import {
  applyImageStyle,
  applyLinkHitArea,
  applyNamespacedAttributes,
  applyScrollModeClass,
  applyThemeModeClass
} from "./reader/doc";
import { viewPagination, type PaginationSide } from "./reader/pagination";
import {
  buildPageTable,
  currentPageNumber,
  totalPages as totalRealPages,
  type PageCounterRenderer,
  type PageTable
} from "./reader/page-count";

const LIBRARY_KEY = "epub-reader:library:v1";
const SETTINGS_KEY = "epub-reader:settings:v1";
const UPLOADED_BOOK_DB_NAME = "epub-reader:uploaded-books:v1";
const UPLOADED_BOOK_STORE_NAME = "files";
const MAX_SPEECH_CHUNK_LENGTH = 900;
const EPUB_OPEN_TIMEOUT_MS = 20000;
const SPEECH_PAGE_TURN_TIMEOUT_MS = 2500;
// Elle sayfa çevirme, konum değişimini bekler. Uzun tutmak hızlı basışta
// okuyucuyu "donmuş" gibi gösteriyor; bu yalnızca güvenlik ağı.
const MANUAL_PAGE_TURN_TIMEOUT_MS = 900;
// Elle çevirme sürerken konuşmanın sayfa takibi bunu kadar tekrar dener.
const SPEECH_ADVANCE_RETRY_MS = 120;
const MAX_SPEECH_ADVANCE_RETRIES = 25;
// Network TTS: a single chunk request must never hang forever, otherwise the
// reader sits on one page with no error and no page turn.
const DEEPGRAM_REQUEST_TIMEOUT_MS = 25000;
// Audio playback: play() may stay pending (autoplay policy) and 'ended' may
// never fire (stalled decode) — both look like "stuck on one page".
const SPEECH_AUDIO_PLAY_TIMEOUT_MS = 15000;
// Web Speech: speak() right after cancel() is swallowed by Chrome often
// enough that the first utterance never starts; defer it slightly.
const WEB_SPEECH_START_DELAY_MS = 150;
const DEEPGRAM_CACHED_PAGE_COUNT = 3;
const DEEPGRAM_PROGRESSIVE_SENTENCE_COUNT = 100;
const DEEPGRAM_PROGRESSIVE_GROUP_SIZES = [1, 1, 1, 2, 2, 2] as const;
// THIS IS FREE API KEY
const DEEPGRAM_FREE_KEY = "aff3b8751306da39c22baf23d81ea29b5f1ff9eb";
const DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak";
const SILENT_AUDIO_URL =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";
const DEFAULT_SPEECH_PROVIDER: SpeechProvider = "deepgram";
const DEFAULT_SPEECH_LANGUAGE = "en-US";
const DEFAULT_DEEPGRAM_MODEL = "aura-2-thalia-en";
const SPEECH_PROVIDER_OPTIONS = [
  { value: "deepgram", label: "Deepgram" },
  { value: "web-speech", label: "Web Speech" },
  { value: "ema", label: "Ema Lightning" },
  { value: "piper", label: "Piper (local)" }
] as const;
const DEEPGRAM_LANGUAGE_OPTIONS = [
  { value: "en-US", label: "English" },
  { value: "es-ES", label: "Spanish" },
  { value: "nl-NL", label: "Dutch" },
  { value: "de-DE", label: "German" },
  { value: "fr-FR", label: "French" },
  { value: "it-IT", label: "Italian" },
  { value: "ja-JP", label: "Japanese" }
] as const;
const WEB_SPEECH_LANGUAGE_OPTIONS = [
  ...DEEPGRAM_LANGUAGE_OPTIONS,
  { value: "tr-TR", label: "Turkish" },
  { value: "ru-RU", label: "Russian" },
  { value: "ar-SA", label: "Arabic" }
] as const;
const DEFAULT_DEEPGRAM_MODELS: Record<string, string> = {
  de: "aura-2-julius-de",
  en: DEFAULT_DEEPGRAM_MODEL,
  es: "aura-2-celeste-es",
  fr: "aura-2-agathe-fr",
  it: "aura-2-livia-it",
  ja: "aura-2-fujin-ja",
  nl: "aura-2-rhea-nl"
};
const DEEPGRAM_VOICES: Record<string, readonly string[]> = {
  en: [
    "amalthea",
    "andromeda",
    "apollo",
    "arcas",
    "aries",
    "asteria",
    "athena",
    "atlas",
    "aurora",
    "callista",
    "cora",
    "cordelia",
    "delia",
    "draco",
    "electra",
    "harmonia",
    "helena",
    "hera",
    "hermes",
    "hyperion",
    "iris",
    "janus",
    "juno",
    "jupiter",
    "luna",
    "mars",
    "minerva",
    "neptune",
    "odysseus",
    "ophelia",
    "orion",
    "orpheus",
    "pandora",
    "phoebe",
    "pluto",
    "saturn",
    "selene",
    "thalia",
    "theia",
    "vesta",
    "zeus"
  ],
  es: [
    "sirio",
    "nestor",
    "carina",
    "celeste",
    "alvaro",
    "diana",
    "aquila",
    "selena",
    "estrella",
    "javier",
    "agustina",
    "antonia",
    "gloria",
    "luciano",
    "olivia",
    "silvia",
    "valerio"
  ],
  nl: ["beatrix", "daphne", "cornelia", "sander", "hestia", "lars", "roman", "rhea", "leda"],
  fr: ["agathe", "hector"],
  de: ["elara", "aurelia", "lara", "julius", "fabian", "kara", "viktoria"],
  it: ["melia", "elio", "flavio", "maia", "cinzia", "cesare", "livia", "perseo", "dionisio", "demetra"],
  ja: ["uzume", "ebisu", "fujin", "izanami", "ama"]
};

const defaultSettings: ReaderSettings = {
  theme: "dark",
  themeName: "default",
  viewSettings: getDefaultViewSettings(),
  speechProvider: DEFAULT_SPEECH_PROVIDER,
  speechLanguage: DEFAULT_SPEECH_LANGUAGE,
  deepgramModel: DEFAULT_DEEPGRAM_MODEL,
  piperVoice: DEFAULT_PIPER_VOICE,
  emaVoice: DEFAULT_EMA_VOICE
};

// Eski sürümlerde yalnızca `fontSize` (yüzde) vardı. Kayıtlı ayarı yeni
// Readest ViewSettings modeline taşı; eksik alanları varsayılanlarla doldur.
function normalizeSettings(stored: Partial<ReaderSettings> & { fontSize?: number }): ReaderSettings {
  const defaults = getDefaultViewSettings();
  const storedView = stored.viewSettings as Partial<ViewSettings> | undefined;
  const migrated: Partial<ViewSettings> = {};
  if (!storedView && typeof stored.fontSize === "number") {
    migrated.defaultFontSize = Math.round(16 * (stored.fontSize / 100) * 10) / 10;
  }
  return {
    ...defaultSettings,
    ...stored,
    viewSettings: { ...defaults, ...migrated, ...(storedView || {}) }
  };
}

const PROGRESS_METHOD = "foliate-fraction-v1";

// Readest'teki 11 renk temasının baz renkleri (tek CSS'teki
// [data-theme="<ad>-<light|dark>"] bloklarıyla birebir aynı değerler).
// EPUB içeriğinin zemin/metin/bağlantı renkleri buradan gelir.
const THEME_BASE_COLORS: Record<string, { light: ThemeBaseColor; dark: ThemeBaseColor }> = {
  default: {
    light: { bg: "#ffffff", fg: "#171717", primary: "#0066cc" },
    dark: { bg: "#222222", fg: "#e0e0e0", primary: "#77bbee" }
  },
  gray: {
    light: { bg: "#e0e0e0", fg: "#222222", primary: "#4488cc" },
    dark: { bg: "#444444", fg: "#c6c6c6", primary: "#88ccee" }
  },
  sepia: {
    light: { bg: "#f1e8d0", fg: "#5b4636", primary: "#008b8b" },
    dark: { bg: "#342e25", fg: "#ffd595", primary: "#48d1cc" }
  },
  grass: {
    light: { bg: "#d7dbbd", fg: "#232c16", primary: "#177b4d" },
    dark: { bg: "#333627", fg: "#d8deba", primary: "#a6d608" }
  },
  cherry: {
    light: { bg: "#f0d1d5", fg: "#4e1609", primary: "#de3838" },
    dark: { bg: "#462f32", fg: "#e5c4c8", primary: "#ff646e" }
  },
  sky: {
    light: { bg: "#cedef5", fg: "#262d48", primary: "#2d53e5" },
    dark: { bg: "#282e47", fg: "#babee1", primary: "#ff646e" }
  },
  solarized: {
    light: { bg: "#fdf6e3", fg: "#586e75", primary: "#268bd2" },
    dark: { bg: "#002b36", fg: "#93a1a1", primary: "#268bd2" }
  },
  gruvbox: {
    light: { bg: "#fbf1c7", fg: "#3c3836", primary: "#076678" },
    dark: { bg: "#282828", fg: "#ebdbb2", primary: "#83a598" }
  },
  nord: {
    light: { bg: "#eceff4", fg: "#2e3440", primary: "#5e81ac" },
    dark: { bg: "#2e3440", fg: "#d8dee9", primary: "#88c0d0" }
  },
  contrast: {
    light: { bg: "#ffffff", fg: "#000000", primary: "#4488cc" },
    dark: { bg: "#000000", fg: "#ffffff", primary: "#88ccee" }
  },
  sunset: {
    light: { bg: "#fff7f0", fg: "#423126", primary: "#fe6b64" },
    dark: { bg: "#3c2b25", fg: "#f6e1d7", primary: "#ff9c94" }
  }
};

const THEME_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "gray", label: "Gray" },
  { value: "sepia", label: "Sepia" },
  { value: "grass", label: "Grass" },
  { value: "cherry", label: "Cherry" },
  { value: "sky", label: "Sky" },
  { value: "solarized", label: "Solarized" },
  { value: "gruvbox", label: "Gruvbox" },
  { value: "nord", label: "Nord" },
  { value: "contrast", label: "Contrast" },
  { value: "sunset", label: "Sunset" }
] as const;

interface ThemeBaseColor {
  bg: string;
  fg: string;
  primary: string;
}

function getReaderColors(themeName: string, mode: "light" | "dark"): ThemeBaseColor {
  const entry = THEME_BASE_COLORS[themeName] || THEME_BASE_COLORS.default!;
  return entry[mode];
}

type Theme = "light" | "dark";
type SpeechProvider = "deepgram" | "web-speech" | "piper" | "ema";
type BookSource = "url" | "file";

type ReaderStatus = "idle" | "loading" | "ready" | "error";
type SpeechMode = "idle" | "loading" | "playing" | "paused" | "unsupported" | "error";

interface ReaderSettings {
  theme: Theme;
  themeName?: string;
  /** Okuma görünümü: Readest'in ViewSettings modeli (font, düzen, paragraf). */
  viewSettings: ViewSettings;
  speechProvider?: SpeechProvider;
  speechLanguage?: string;
  deepgramModel?: string;
  piperVoice?: string;
  emaVoice?: string;
}

interface ReadingPosition {
  cfi: string;
  href: string;
  percentage: number | null;
  isPrecise: boolean;
  progressMethod: typeof PROGRESS_METHOD;
  updatedAt: string;
}

interface LibraryBook {
  id: string;
  url: string;
  source?: BookSource;
  fileStorageKey?: string;
  fileName?: string;
  fileSize?: number;
  title: string;
  author: string;
  addedAt: string;
  updatedAt: string;
  position: ReadingPosition | null;
}

interface BookInfo {
  title: string;
  author: string;
}

interface ReaderProgress {
  href: string;
  percentage: number | null;
  page: number | null;
  totalPages: number | null;
}

type PersistentState<T> = [T, Dispatch<SetStateAction<T>>];

interface VisibleSpeechSnapshot {
  text: string;
  languageHint: string;
  pageKey: string;
}

interface DeepgramCachedPage {
  pageKey: string;
  chunks: string[];
  nextProgressiveState: DeepgramProgressiveState;
}

interface DeepgramProgressiveState {
  sentenceCount: number;
  groupIndex: number;
  complete: boolean;
}

interface DeepgramCacheTask {
  cacheKey: string;
  text: string;
  resolve(audioUrl: string): void;
  reject(error: unknown): void;
}

interface ScreenWakeLockSentinel {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

interface BrowserWithScreenWakeLock {
  wakeLock?: {
    request(type: "screen"): Promise<ScreenWakeLockSentinel>;
  };
}

interface ResolvedBookSource {
  input: string | File;
  fileName?: string;
}

function destroyFoliateView(view: FoliateViewElement | null): void {
  if (!view) {
    return;
  }

  try {
    view.close();
  } catch {
    // Zaten kapanmış olabilir.
  }
  view.remove();
}

function guardFoliateDoc(doc: Document): void {
  const root = doc.documentElement;
  if (!root || root.dataset.readerInputGuards) {
    return;
  }

  root.dataset.readerInputGuards = "true";
  const preventDefault = (event: Event) => event.preventDefault();
  doc.addEventListener("selectstart", preventDefault);
  doc.addEventListener("gesturestart", preventDefault);
  doc.addEventListener("gesturechange", preventDefault);
  doc.defaultView?.addEventListener(
    "wheel",
    (event) => {
      if ((event as WheelEvent).ctrlKey) {
        event.preventDefault();
      }
    },
    { passive: false }
  );
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `book-${(hash >>> 0).toString(16)}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? (JSON.parse(rawValue) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function openUploadedBookDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(UPLOADED_BOOK_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOADED_BOOK_STORE_NAME)) {
        db.createObjectStore(UPLOADED_BOOK_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Uploaded EPUB storage could not be opened."));
    request.onblocked = () => reject(new Error("Uploaded EPUB storage is blocked by another tab."));
  });
}

async function saveUploadedBookBlob(storageKey: string, blob: Blob): Promise<void> {
  const db = await openUploadedBookDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(UPLOADED_BOOK_STORE_NAME, "readwrite");
    transaction.objectStore(UPLOADED_BOOK_STORE_NAME).put(blob, storageKey);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Uploaded EPUB could not be saved."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Uploaded EPUB save was aborted."));
    };
  });
}

async function getUploadedBookBlob(storageKey: string): Promise<Blob | null> {
  const db = await openUploadedBookDb();

  return new Promise((resolve, reject) => {
    let uploadedBlob: Blob | null = null;
    const transaction = db.transaction(UPLOADED_BOOK_STORE_NAME, "readonly");
    const request = transaction.objectStore(UPLOADED_BOOK_STORE_NAME).get(storageKey) as IDBRequest<Blob | undefined>;

    request.onsuccess = () => {
      uploadedBlob = request.result instanceof Blob ? request.result : null;
    };
    transaction.oncomplete = () => {
      db.close();
      resolve(uploadedBlob);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Uploaded EPUB could not be read."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Uploaded EPUB read was aborted."));
    };
  });
}

async function deleteUploadedBookBlob(storageKey: string): Promise<void> {
  const db = await openUploadedBookDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(UPLOADED_BOOK_STORE_NAME, "readwrite");
    transaction.objectStore(UPLOADED_BOOK_STORE_NAME).delete(storageKey);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Uploaded EPUB could not be deleted."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Uploaded EPUB delete was aborted."));
    };
  });
}

function convertKnownHostedUrl(url: URL): URL {
  if (url.hostname !== "github.com") {
    return url;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const [owner, repo, mode, branch, ...filePath] = segments;

  if (!owner || !repo || !branch || filePath.length === 0) {
    return url;
  }

  if (mode === "blob" || mode === "raw") {
    return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath.join("/")}`);
  }

  return url;
}

function normalizeBookUrl(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  return convertKnownHostedUrl(new URL(trimmedValue, window.location.href)).href;
}

function getQueryBookUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const rawUrl = params.get("epub") || params.get("book") || params.get("url") || "";

  try {
    return rawUrl ? normalizeBookUrl(rawUrl) : "";
  } catch {
    return "";
  }
}

function formatAuthor(author: string | string[] | null | undefined): string {
  if (Array.isArray(author)) {
    return author.filter(Boolean).join(", ");
  }

  return author || "";
}

function createBook(url: string): LibraryBook {
  const now = new Date().toISOString();

  return {
    id: hashText(url),
    url,
    source: "url",
    title: "",
    author: "",
    addedAt: now,
    updatedAt: now,
    position: null
  };
}

function createUploadedBook(file: File, storageKey: string): LibraryBook {
  const now = new Date().toISOString();
  const title = file.name.replace(/\.epub$/i, "") || "Uploaded EPUB";

  return {
    id: hashText(`file:${storageKey}`),
    url: file.name,
    source: "file",
    fileStorageKey: storageKey,
    fileName: file.name,
    fileSize: file.size,
    title,
    author: "",
    addedAt: now,
    updatedAt: now,
    position: null
  };
}

function getBookSource(book: LibraryBook): BookSource {
  return book.source || "url";
}

function getBookDescription(book: LibraryBook): string {
  return getBookSource(book) === "file" ? book.fileName || book.url || "Uploaded EPUB" : book.url;
}

async function resolveBookSource(book: LibraryBook): Promise<ResolvedBookSource> {
  if (getBookSource(book) !== "file") {
    let fileName = "book.epub";
    try {
      const pathname = new URL(book.url, window.location.href).pathname;
      const lastSegment = pathname.split("/").filter(Boolean).pop();
      if (lastSegment) {
        fileName = decodeURIComponent(lastSegment);
      }
    } catch {
      // Varsayılan dosya adı kullanılır.
    }
    return { input: book.url, fileName };
  }

  if (!book.fileStorageKey) {
    throw new Error("Uploaded EPUB file reference is missing.");
  }

  const blob = await getUploadedBookBlob(book.fileStorageKey);
  if (!blob) {
    throw new Error("Uploaded EPUB file is missing from browser storage.");
  }

  const fileName = book.fileName || "book.epub";
  return {
    // Foliate chooses the importer from both the bytes and `File.name`.  Keep a
    // real File here: a bare Blob/ArrayBuffer has no name and makes the
    // Readest/Foliate format detector fail before it can open an EPUB.
    input: new File([blob], fileName, { type: blob.type || "application/epub+zip" }),
    fileName
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

function toDisplayPercentage(value: number | string | null | undefined): number | null {
  if (value == null || Number.isNaN(Number(value))) {
    return null;
  }

  const numericValue = Number(value);
  return Math.min(100, Math.max(0, Math.round(numericValue * 10) / 10));
}

function formatProgress(value: number | string | null | undefined): string {
  const percentage = toDisplayPercentage(value);
  if (percentage == null) {
    return "";
  }

  return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(1)}%`;
}
/* Foliate (Readest motoru) okuyucu konumu: epubjs Location yerine geçer. */
interface ReaderLoc {
  cfi: string;
  href: string;
  atEnd: boolean;
  atStart: boolean;
}

interface FoliateSectionProgress {
  current: number;
  total: number;
}

interface FoliateLocationProgress {
  current: number;
  next: number;
  total: number;
}

interface FoliateRelocateDetail {
  cfi: string;
  fraction: number;
  index: number;
  range: Range | null;
  section?: FoliateSectionProgress;
  location?: FoliateLocationProgress;
}

interface FoliateRenderer {
  setStyles?(styles: string): void;
  setAttribute(name: string, value?: string): void;
  removeAttribute(name: string): void;
  getContents(): { doc: Document; index: number }[];
  /** Ekranda görünen bölüm indeksi. */
  primaryIndex: number;
  /** Şerit içindeki sayfa indeksi (0 tabanlı). */
  page: number;
  /** Birincil bölümün ekranda kaç sayfa tuttuğu. */
  pages: number;
  destroy?(): void;
  addEventListener(type: "stabilized", listener: EventListener): void;
  removeEventListener(type: "stabilized", listener: EventListener): void;
}

interface FoliateBook {
  metadata?: {
    title?: unknown;
    author?: unknown;
    language?: unknown;
  };
  sections: { id?: unknown; linear?: string; cfi?: string }[];
  rendition?: { layout?: string; spread?: string };
  dir?: string;
  toc?: unknown;
  transformTarget?: EventTarget;
}

interface FoliateViewElement extends HTMLElement {
  open(book: string | Blob): Promise<void>;
  close(): void;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number | { fraction: number }): Promise<unknown>;
  goToFraction(fraction: number): Promise<void>;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  getCFI(index: number, range: Range | null): string | null;
  getSectionFractions(): number[];
  renderer: FoliateRenderer;
  book: FoliateBook | null;
  lastLocation: unknown;
}

function toReaderLoc(detail: FoliateRelocateDetail | null): ReaderLoc | null {
  if (!detail || !detail.cfi) {
    return null;
  }

  const fraction = Number(detail.fraction) || 0;
  return {
    cfi: detail.cfi,
    href: "",
    atEnd: fraction >= 0.999,
    atStart: fraction <= 0.001
  };
}

function getLocationSpeechKey(location: ReaderLoc | null): string {
  return location?.cfi || "";
}

// Sayfa çevirmenin ilerleyip ilerlemediğini görmek için ucuz bir imza:
// görünen bölüm + o bölümdeki sayfa indeksi.
function getRendererSignature(view: FoliateViewElement | null): string {
  if (!view) {
    return "";
  }
  try {
    const renderer = view.renderer;
    return `${renderer.primaryIndex}:${renderer.page}`;
  } catch {
    return "";
  }
}

function getFoliateProgress(detail: FoliateRelocateDetail | null): {
  percentage: number | null;
  page: number | null;
  totalPages: number | null;
} {
  if (!detail) {
    return { percentage: null, page: null, totalPages: null };
  }

  const percentage = toDisplayPercentage((Number(detail.fraction) || 0) * 100);
  const loc = detail.location;
  if (loc && Number.isFinite(loc.total) && loc.total > 0) {
    const totalPages = Math.max(1, Math.floor(loc.total));
    const page = Math.min(totalPages, Math.max(1, Math.floor(Number(loc.current) || 0) + 1));
    return { percentage, page, totalPages };
  }

  const section = detail.section;
  if (section && section.total > 0) {
    return {
      percentage,
      page: Math.min(section.total, Math.max(1, section.current + 1)),
      totalPages: section.total
    };
  }

  return { percentage, page: null, totalPages: null };
}

function normalizeMetaText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeMetaText).filter(Boolean).join(", ");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const name = record.name;
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
    const direct = record.value;
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }
    for (const key of Object.keys(record)) {
      const entry = record[key];
      if (typeof entry === "string" && entry.trim()) {
        return entry.trim();
      }
    }
  }

  return "";
}

function toReaderThemeCode(settings: ReaderSettings): ReaderThemeCode {
  const mode = settings.theme === "light" ? "light" : "dark";
  const colors = getReaderColors(settings.themeName || "default", mode);
  return { bg: colors.bg, fg: colors.fg, primary: colors.primary, isDarkMode: mode === "dark" };
}

// Readest: getStyles(viewSettings, themeCode). Okuma görünümünün tamamı
// (font, paragraf aralığı, kenar boşlukları, renk) buradan gelir.
function buildFoliateStyles(settings: ReaderSettings): string {
  return getStyles(settings.viewSettings, toReaderThemeCode(settings));
}

function applyFoliateStyles(view: FoliateViewElement | null, settings: ReaderSettings): void {
  try {
    view?.renderer.setStyles?.(buildFoliateStyles(settings));
  } catch {
    // Stil enjeksiyonu kritik değildir; okuma devam eder.
  }
}

// Readest: FoliateViewer'ın `applyMarginAndGap` + renderer nitelikleri.
// Her nitelik paginator içinde bir `--_*` değişkenine eşlenir ve sütun /
// sayfa hesabını doğrudan belirler.
function applyFoliateLayout(view: FoliateViewElement | null, settings: ReaderSettings): void {
  if (!view) {
    return;
  }

  const vs = settings.viewSettings;
  try {
    const renderer = view.renderer;
    renderer.setAttribute("max-column-count", String(vs.maxColumnCount));
    renderer.setAttribute("max-inline-size", `${getMaxInlineSize(vs)}px`);
    renderer.setAttribute("max-block-size", `${vs.maxBlockSize}px`);
    renderer.setAttribute("gap", `${vs.gapPercent}%`);
    renderer.setAttribute("margin-top", `${vs.marginTopPx}px`);
    renderer.setAttribute("margin-bottom", `${vs.marginBottomPx}px`);
    renderer.setAttribute("margin-left", `${vs.marginLeftPx}px`);
    renderer.setAttribute("margin-right", `${vs.marginRightPx}px`);
    if (vs.columnGapPx > 0) {
      renderer.setAttribute("column-gap", `${vs.columnGapPx}px`);
    } else {
      renderer.removeAttribute("column-gap");
    }
    if (vs.animated) {
      renderer.setAttribute("animated", "");
    } else {
      renderer.removeAttribute("animated");
    }
    if (view.book?.rendition?.layout === "pre-paginated") {
      renderer.setAttribute("spread", vs.spreadMode);
    }
  } catch {
    // Eski motor uyumsuzsa varsayılan sayfa düzeni geçerli kalır.
  }
}
function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Rejects if audio.play() stays pending (e.g. autoplay policy) instead of
// hanging the whole read-aloud chain on one page forever.
async function playAudioWithTimeout(
  audio: HTMLAudioElement,
  timeoutMs: number,
  label: string
): Promise<void> {
  let timeoutId = 0;
  try {
    await Promise.race([
      audio.play(),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () =>
            reject(
              new Error(`${label} did not start playing within ${Math.round(timeoutMs / 1000)} seconds.`)
            ),
          timeoutMs
        );
      })
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// Polls audio.currentTime while playback should be alive. If time stops
// advancing (stalled decode, wedged pipeline) the caller force-advances
// instead of sitting on one page forever. Returns a cleanup function.
function watchAudioProgress(
  audio: HTMLAudioElement,
  isAlive: () => boolean,
  onStuck: () => void,
  stuckMs = 10000,
  pollMs = 2000
): () => void {
  let lastTime = -1;
  let stuckForMs = 0;
  const timer = window.setInterval(() => {
    if (!isAlive() || audio.ended || audio.paused) {
      window.clearInterval(timer);
      return;
    }
    const currentTime = audio.currentTime;
    if (currentTime === lastTime) {
      stuckForMs += pollMs;
    } else {
      stuckForMs = 0;
      lastTime = currentTime;
    }
    if (stuckForMs >= stuckMs) {
      window.clearInterval(timer);
      onStuck();
    }
  }, pollMs);
  return () => window.clearInterval(timer);
}

// Generous upper bound for one utterance: ~12 chars/sec + headroom.
function estimateUtteranceTimeoutMs(text: string): number {
  return Math.min(120000, Math.max(8000, 5000 + text.length * 90));
}

function isWebSpeechSupported(): boolean {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function isSpeechProviderSupported(provider: SpeechProvider): boolean {
  if (provider === "piper") {
    return isPiperSupported();
  }
  if (provider === "ema") {
    return isEmaSupported();
  }
  return provider === "deepgram" || isWebSpeechSupported();
}

function getSpeechProviderLabel(provider: SpeechProvider): string {
  if (provider === "piper") {
    return "Piper";
  }
  if (provider === "ema") {
    return "Ema Lightning";
  }
  return provider === "deepgram" ? "Deepgram" : "Web Speech API";
}

function getBaseLanguage(language: string): string {
  return normalizeLanguageTag(language).split("-")[0].toLowerCase();
}

function getDefaultDeepgramModel(language: string): string {
  return DEFAULT_DEEPGRAM_MODELS[getBaseLanguage(language)] || DEFAULT_DEEPGRAM_MODEL;
}

function getDeepgramModelOptions(language: string): { value: string; label: string }[] {
  const baseLanguage = getBaseLanguage(language);
  const voices = DEEPGRAM_VOICES[baseLanguage] || DEEPGRAM_VOICES.en;

  return voices.map((voice) => ({
    value: `aura-2-${voice}-${baseLanguage}`,
    label: voice.charAt(0).toUpperCase() + voice.slice(1)
  }));
}

function isDeepgramLanguageSupported(language: string): boolean {
  return getBaseLanguage(language) in DEEPGRAM_VOICES;
}

function isDeepgramModelForLanguage(model: string, language: string): boolean {
  return getDeepgramModelOptions(language).some((option) => option.value === model);
}

function normalizeLanguageTag(value: string | null | undefined): string {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return "";
  }

  try {
    return new Intl.Locale(normalizedValue).toString();
  } catch {
    return normalizedValue;
  }
}

function getLanguageHintFromElement(element: Element | null): string {
  const languageElement = element?.closest?.("[lang]");
  return normalizeLanguageTag(languageElement?.getAttribute("lang") || element?.ownerDocument?.documentElement.lang);
}

function isReadableTextNode(node: Node): boolean {
  const parentElement = node.parentElement;
  const tagName = parentElement?.tagName.toLowerCase();

  if (!parentElement || !node.textContent?.trim()) {
    return false;
  }

  if (tagName && ["script", "style", "noscript", "svg", "title", "meta"].includes(tagName)) {
    return false;
  }

  const view = parentElement.ownerDocument.defaultView;
  const computedStyle = view?.getComputedStyle(parentElement);
  return computedStyle?.display !== "none" && computedStyle?.visibility !== "hidden";
}

interface VisibleBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Görünür alan her zaman çağıran tarafından verilir. Foliate her bölümü,
// bölümün TÜM sütunlarını kaplayan bir iframe'e yerleştirir; iframe'in kendi
// innerWidth değeri "görünen sayfa" değil, bölümün tamamıdır (ör. 30k
// karakter). Bu yüzden kırpma, okuyucu alanının (ya da görünmez ön yükleme
// görünümünün kendi kutusunun) iframe koordinatlarına çevrilmesiyle yapılır.
// Mümkünse paginator'ın gerçek sayfa kutusu (#container) kullanılır: foliate-view
// öğesi kenar boşluklarını da kapsadığı için komşu bölümün ilk sütunu kırpmadan
// sızabiliyordu.
function getVisibleBounds(view: FoliateViewElement | null): VisibleBounds {
  if (view) {
    try {
      const rendererElement = view.renderer as unknown as HTMLElement | null;
      const container = rendererElement?.shadowRoot?.getElementById?.("container");
      if (container) {
        const containerRect = container.getBoundingClientRect();
        return {
          left: containerRect.left,
          top: containerRect.top,
          right: containerRect.right,
          bottom: containerRect.bottom
        };
      }
    } catch {
      // Eski/mock motor: foliate-view kutusuna düş.
    }

    const rect = view.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }

  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

function isTextNodeInViewport(node: Text, document: Document, bounds: VisibleBounds): boolean {
  const view = document.defaultView;
  if (!view) {
    return false;
  }

  let { left, top, right, bottom } = bounds;
  const frameElement = view.frameElement as HTMLElement | null;
  if (frameElement) {
    const frameRect = frameElement.getBoundingClientRect();
    left -= frameRect.left;
    right -= frameRect.left;
    top -= frameRect.top;
    bottom -= frameRect.top;
  }

  const range = document.createRange();
  try {
    range.selectNodeContents(node);
    return Array.from(range.getClientRects()).some(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > left &&
        rect.bottom > top &&
        rect.left < right &&
        rect.top < bottom
    );
  } finally {
    range.detach();
  }
}

function extractVisibleSpeechText(
  document: Document,
  bounds: VisibleBounds
): { text: string; languageHint: string } {
  const body = document.body;
  if (!body) {
    return { text: "", languageHint: normalizeLanguageTag(document.documentElement.lang) };
  }

  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!isReadableTextNode(node) || !isTextNodeInViewport(node as Text, document, bounds)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const parts: string[] = [];
  let languageHint = normalizeLanguageTag(document.documentElement.lang || body.getAttribute("lang"));
  let currentNode = walker.nextNode();

  while (currentNode) {
    const text = normalizeWhitespace(currentNode.textContent || "");
    if (text) {
      parts.push(text);
      if (!languageHint) {
        languageHint = getLanguageHintFromElement(currentNode.parentElement);
      }
    }
    currentNode = walker.nextNode();
  }

  return {
    text: normalizeWhitespace(parts.join(" ")),
    languageHint
  };
}
function snapshotFromRange(range: Range | null): { text: string; languageHint: string } {
  if (!range) {
    return { text: "", languageHint: "" };
  }

  try {
    const ancestor = range.commonAncestorContainer;
    const element =
      ancestor.nodeType === Node.ELEMENT_NODE ? (ancestor as Element) : ancestor.parentElement;
    return {
      text: normalizeWhitespace(range.toString() || ""),
      languageHint: getLanguageHintFromElement(element)
    };
  } catch {
    return { text: "", languageHint: "" };
  }
}

function snapshotFromDocuments(
  documents: Document[],
  pageKey: string,
  bounds: VisibleBounds
): VisibleSpeechSnapshot {
  const sections = documents.map((document) => extractVisibleSpeechText(document, bounds));
  return {
    text: normalizeWhitespace(sections.map((section) => section.text).filter(Boolean).join("\n\n")),
    languageHint: sections.find((section) => section.languageHint)?.languageHint || "",
    pageKey
  };
}

function createVisibleSpeechSnapshot(
  view: FoliateViewElement | null,
  detail: FoliateRelocateDetail | null
): VisibleSpeechSnapshot {
  const pageKey = detail?.cfi || "";
  if (detail?.range) {
    const text = snapshotFromRange(detail.range);
    if (text.text) {
      return { ...text, pageKey };
    }
  }

  let documents: Document[] = [];
  try {
    documents = (view?.renderer.getContents() || []).map((contents) => contents.doc);
  } catch {
    documents = [];
  }
  return snapshotFromDocuments(documents, pageKey, getVisibleBounds(view));
}

function selectVoiceForLanguage(language: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const requestedLanguage = language.toLowerCase();
  const requestedBaseLanguage = requestedLanguage.split("-")[0];

  return (
    voices.find((voice) => voice.lang.toLowerCase() === requestedLanguage) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith(`${requestedBaseLanguage}-`)) ||
    null
  );
}

function getSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    return Promise.resolve(voices);
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }, 900);

    function handleVoicesChanged() {
      window.clearTimeout(timeout);
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }

    window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
  });
}

function splitSpeechSentences(text: string): string[] {
  const sentences = normalizeWhitespace(text).match(/[^.!?\u3002\uff01\uff1f]+[.!?\u3002\uff01\uff1f]?/g) || [text];
  return sentences.flatMap((sentence) => {
    const normalizedSentence = normalizeWhitespace(sentence);
    if (!normalizedSentence) {
      return [];
    }

    if (normalizedSentence.length <= MAX_SPEECH_CHUNK_LENGTH) {
      return [normalizedSentence];
    }

    const parts: string[] = [];
    for (let index = 0; index < normalizedSentence.length; index += MAX_SPEECH_CHUNK_LENGTH) {
      parts.push(normalizedSentence.slice(index, index + MAX_SPEECH_CHUNK_LENGTH));
    }
    return parts;
  });
}

function groupSpeechSentences(sentences: string[], maxSentences: number): string[] {
  const chunks: string[] = [];
  let currentSentences: string[] = [];

  sentences.forEach((sentence) => {
    const nextChunk = [...currentSentences, sentence].join(" ");
    if (currentSentences.length < maxSentences && nextChunk.length <= MAX_SPEECH_CHUNK_LENGTH) {
      currentSentences.push(sentence);
      return;
    }

    if (currentSentences.length > 0) {
      chunks.push(currentSentences.join(" "));
    }
    currentSentences = [sentence];
  });

  if (currentSentences.length > 0) {
    chunks.push(currentSentences.join(" "));
  }

  return chunks;
}

function splitSpeechText(text: string): string[] {
  return groupSpeechSentences(splitSpeechSentences(text), Number.POSITIVE_INFINITY);
}

function createDeepgramCachedPage(
  pageKey: string,
  text: string,
  progressiveState: DeepgramProgressiveState
): DeepgramCachedPage {
  if (progressiveState.complete) {
    return {
      pageKey,
      chunks: splitDeepgramPageText(text),
      nextProgressiveState: progressiveState
    };
  }

  const sentences = splitSpeechSentences(text);
  const chunks: string[] = [];
  let sentenceIndex = 0;
  let groupIndex = progressiveState.groupIndex;

  while (sentenceIndex < sentences.length) {
    const groupSize = DEEPGRAM_PROGRESSIVE_GROUP_SIZES[groupIndex] || 5;
    const group = sentences.slice(sentenceIndex, sentenceIndex + groupSize);
    chunks.push(...groupSpeechSentences(group, groupSize));
    sentenceIndex += group.length;
    groupIndex += 1;
  }

  const sentenceCount = progressiveState.sentenceCount + sentences.length;
  return {
    pageKey,
    chunks,
    nextProgressiveState: {
      sentenceCount,
      groupIndex,
      complete: sentenceCount >= DEEPGRAM_PROGRESSIVE_SENTENCE_COUNT
    }
  };
}

function splitDeepgramPageText(text: string): string[] {
  const normalizedText = normalizeWhitespace(text);
  return normalizedText ? [normalizedText] : [];
}

function usePersistentState<T>(
  key: string,
  fallback: T,
  normalize?: (value: T) => T
): PersistentState<T> {
  const [value, setValue] = useState<T>(() => {
    const stored = readJson(key, fallback);
    return normalize ? normalize(stored) : stored;
  });

  useEffect(() => {
    writeJson(key, value);
  }, [key, value]);

  return [value, setValue];
}

function App() {
  const queryBookUrl = useMemo(() => getQueryBookUrl(), []);
  const [library, setLibrary] = usePersistentState<LibraryBook[]>(LIBRARY_KEY, []);
  const [settings, setSettings] = usePersistentState<ReaderSettings>(
    SETTINGS_KEY,
    defaultSettings,
    normalizeSettings
  );
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 1024
  );
  const [isSidebarPinned, setIsSidebarPinned] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [addDialogError, setAddDialogError] = useState("");
  const [isUploadingBook, setIsUploadingBook] = useState(false);
  const [readerError, setReaderError] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>("idle");
  const [speechMode, setSpeechMode] = useState<SpeechMode>(() =>
    isSpeechProviderSupported(settings.speechProvider || DEFAULT_SPEECH_PROVIDER) ? "idle" : "unsupported"
  );
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [areLocationsReady, setAreLocationsReady] = useState(false);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const hiddenViewRef = useRef<FoliateViewElement | null>(null);
  const deepgramCacheContainerRef = useRef<HTMLDivElement | null>(null);
  const activeBookRef = useRef<LibraryBook | null>(null);
  const pendingAddedBookIdsRef = useRef<Set<string>>(new Set());
  const settingsRef = useRef(settings);
  const queryBookHandledRef = useRef(false);
  const lastLocationRef = useRef<ReaderLoc | null>(null);
  const lastDetailRef = useRef<FoliateRelocateDetail | null>(null);
  // Gerçek sayfa sayısı: bölüm başına yeniden akıtılmış sayfa tablosu.
  const pageCounterContainerRef = useRef<HTMLDivElement | null>(null);
  const pageCounterViewRef = useRef<FoliateViewElement | null>(null);
  const pageTableRef = useRef<PageTable | null>(null);
  const bookInputRef = useRef<string | File | null>(null);
  const pageCountGenerationRef = useRef(0);
  const [pageCountProgress, setPageCountProgress] = useState<{ done: number; total: number } | null>(null);
  const hiddenDetailRef = useRef<FoliateRelocateDetail | null>(null);
  const speechChunksRef = useRef<string[]>([]);
  const speechChunkIndexRef = useRef(0);
  const speechProviderRef = useRef<SpeechProvider>(settings.speechProvider || DEFAULT_SPEECH_PROVIDER);
  const speechLanguageRef = useRef(settings.speechLanguage || DEFAULT_SPEECH_LANGUAGE);
  const deepgramModelRef = useRef(settings.deepgramModel || DEFAULT_DEEPGRAM_MODEL);
  const piperVoiceRef = useRef(settings.piperVoice || DEFAULT_PIPER_VOICE);
  const speechVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const speechPageKeyRef = useRef("");
  const speechShouldContinueRef = useRef(false);
  const speechPausedRef = useRef(false);
  const speechTokenRef = useRef(0);
  const speechPageAdvanceInFlightRef = useRef(false);
  const speechAdvanceRetryRef = useRef(0);
  // "primaryIndex:page" of the page being read aloud. Updated every time a
  // page starts; see the note in handleRelocate about why CFI is not used.
  const speechPageSignatureRef = useRef("");
  const speechPageTurnCleanupRef = useRef<(() => void) | null>(null);
  const deepgramAudioRef = useRef<HTMLAudioElement | null>(null);
  const piperAudioRef = useRef<HTMLAudioElement | null>(null);
  const piperAudioUrlsRef = useRef<Set<string>>(new Set());
  const piperAudioCacheRef = useRef<Map<string, Promise<string>>>(new Map());
  const piperGenerationRef = useRef(0);
  const emaVoiceRef = useRef(settings.emaVoice || DEFAULT_EMA_VOICE);
  const emaAudioRef = useRef<HTMLAudioElement | null>(null);
  const emaAudioUrlsRef = useRef<Set<string>>(new Set());
  const emaAudioCacheRef = useRef<Map<string, Promise<string>>>(new Map());
  const emaGenerationRef = useRef(0);
  const deepgramAudioUrlsRef = useRef<Set<string>>(new Set());
  const deepgramAudioCacheRef = useRef<Map<string, Promise<string>>>(new Map());
  const deepgramCachePagesRef = useRef<Map<string, DeepgramCachedPage>>(new Map());
  const deepgramCacheQueueRef = useRef<DeepgramCacheTask[]>([]);
  const deepgramCacheRunnerRef = useRef<Promise<void> | null>(null);
  const deepgramCacheGenerationRef = useRef(0);
  const deepgramAbortControllersRef = useRef<Set<AbortController>>(new Set());
  const deepgramProgressiveStateRef = useRef<DeepgramProgressiveState>({
    sentenceCount: 0,
    groupIndex: 0,
    complete: false
  });
  const wakeLockRef = useRef<ScreenWakeLockSentinel | null>(null);
  const pageHoldTimerRef = useRef<number | null>(null);
  const pageHoldIntervalRef = useRef<number | null>(null);
  const pageHoldDidRepeatRef = useRef(false);
  const manualPageNavigationInFlightRef = useRef(false);
  const pageNavigationOriginRef = useRef<"speech" | "manual" | null>(null);
  const pendingManualPageDirectionRef = useRef<"previous" | "next" | null>(null);
  // Bekleyen elle çevirme sayısı (işaretli: +1 ileri, -1 geri). Tek bir yön
  // yerine net sayaç tutulur; hızlı basışta tek çevirme "yutulmaz".
  const pendingManualTurnsRef = useRef(0);
  const manualPageNavigationGenerationRef = useRef(0);

  const activeBook = useMemo(
    () => library.find((book) => book.id === activeBookId) || null,
    [activeBookId, library]
  );

  useEffect(() => {
    activeBookRef.current = activeBook;
  }, [activeBook]);

  useEffect(() => {
    void trackAppStartup();
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    const themeName = settings.themeName || "default";
    const mode = settings.theme === "light" ? "light" : "dark";
    const dataTheme = `${themeName}-${mode}`;
    document.documentElement.setAttribute("data-theme", dataTheme);
    document.documentElement.setAttribute("data-page", "reader");
    // Remove a value left by older versions that offered an e-ink mode.
    document.documentElement.removeAttribute("data-eink");
    const nextProvider = settings.speechProvider || DEFAULT_SPEECH_PROVIDER;
    const storedLanguage = settings.speechLanguage || DEFAULT_SPEECH_LANGUAGE;
    const nextLanguage =
      nextProvider === "piper" || nextProvider === "ema"
        ? "tr-TR"
        : nextProvider === "deepgram" && !isDeepgramLanguageSupported(storedLanguage)
          ? DEFAULT_SPEECH_LANGUAGE
          : storedLanguage;
    const nextDeepgramModel = isDeepgramModelForLanguage(settings.deepgramModel || "", nextLanguage)
      ? settings.deepgramModel || DEFAULT_DEEPGRAM_MODEL
      : getDefaultDeepgramModel(nextLanguage);
    const nextPiperVoice = isPiperVoiceId(settings.piperVoice || "")
      ? (settings.piperVoice as string)
      : DEFAULT_PIPER_VOICE;
    const nextEmaVoice = isEmaVoiceId(settings.emaVoice || "")
      ? (settings.emaVoice as string)
      : DEFAULT_EMA_VOICE;
    speechProviderRef.current = nextProvider;
    speechLanguageRef.current = nextLanguage;
    deepgramModelRef.current = nextDeepgramModel;
    piperVoiceRef.current = nextPiperVoice;
    emaVoiceRef.current = nextEmaVoice;
    if (isWebSpeechSupported()) {
      speechVoiceRef.current = selectVoiceForLanguage(nextLanguage, window.speechSynthesis.getVoices());
      void getSpeechVoices().then((voices) => {
        if (speechLanguageRef.current === nextLanguage) {
          speechVoiceRef.current = selectVoiceForLanguage(nextLanguage, voices);
        }
      });
    }

    if (
      settings.speechProvider !== nextProvider ||
      settings.speechLanguage !== nextLanguage ||
      settings.deepgramModel !== nextDeepgramModel ||
      settings.piperVoice !== nextPiperVoice ||
      settings.emaVoice !== nextEmaVoice ||
      !settings.themeName
    ) {
      setSettings((currentSettings) => ({
        ...currentSettings,
        themeName: currentSettings.themeName || "default",
        speechProvider: nextProvider,
        speechLanguage: nextLanguage,
        deepgramModel: nextDeepgramModel,
        piperVoice: nextPiperVoice,
        emaVoice: nextEmaVoice
      }));
    }
  }, [settings, setSettings]);

  // Arka planda konuşma yok: sekme gizlenince sesi durdur. Web Speech
  // duraklatılabilir (kullanıcı dönünce devam eder); ağ üzerinden gelen
  // sesler (Deepgram/Piper/Ema) tamamen durdurulur.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden" || !speechShouldContinueRef.current) {
        return;
      }
      if (speechProviderRef.current === "web-speech") {
        speechPausedRef.current = true;
        try {
          if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.pause();
          }
        } catch {
          // Duraklatma best-effort; bayrak yine de parça akışını durdurur.
        }
        setSpeechMode("paused");
        void releaseSpeechWakeLock();
      } else {
        stopSpeech();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    const preventZoomKeys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      if (["+", "=", "-", "_", "0"].includes(event.key)) {
        event.preventDefault();
      }
    };
    const preventWheelZoom = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };
    const preventGesture = (event: Event) => event.preventDefault();

    window.addEventListener("keydown", preventZoomKeys);
    window.addEventListener("wheel", preventWheelZoom, { passive: false });
    document.addEventListener("gesturestart", preventGesture);
    document.addEventListener("gesturechange", preventGesture);

    return () => {
      window.removeEventListener("keydown", preventZoomKeys);
      window.removeEventListener("wheel", preventWheelZoom);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
    };
  }, []);

  function clearSpeechPageTurnWait(): void {
    speechPageTurnCleanupRef.current?.();
    speechPageTurnCleanupRef.current = null;
  }

  async function releaseSpeechWakeLock(): Promise<void> {
    const wakeLock = wakeLockRef.current;
    if (!wakeLock) {
      return;
    }

    wakeLockRef.current = null;
    try {
      await wakeLock.release();
    } catch {
      // The browser may already have released it.
    }
  }

  async function requestSpeechWakeLock(): Promise<void> {
    const wakeLock = (navigator as unknown as BrowserWithScreenWakeLock).wakeLock;
    if (!wakeLock || wakeLockRef.current) {
      return;
    }

    try {
      const sentinel = await wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
        }
      });
    } catch {
      // Wake Lock is best-effort and unavailable in some mobile browsers.
    }
  }

  function clearDeepgramCache(): void {
    deepgramCacheGenerationRef.current += 1;
    deepgramAbortControllersRef.current.forEach((controller) => controller.abort());
    deepgramAbortControllersRef.current.clear();
    const abortError = new DOMException("Speech cache was cleared.", "AbortError");
    deepgramCacheQueueRef.current.splice(0).forEach((task) => task.reject(abortError));
    deepgramCacheRunnerRef.current = null;
    deepgramAudioCacheRef.current.clear();
    deepgramCachePagesRef.current.clear();
    [...deepgramAudioUrlsRef.current].forEach((audioUrl) => {
      URL.revokeObjectURL(audioUrl);
      deepgramAudioUrlsRef.current.delete(audioUrl);
    });
  }

  function clearDeepgramPlayback(): void {
    clearDeepgramCache();

    const audio = deepgramAudioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
      deepgramAudioRef.current = null;
    }
  }

  function getDeepgramAudioCacheKey(pageKey: string, chunkIndex: number): string {
    return `${deepgramModelRef.current}\n${pageKey}\n${chunkIndex}`;
  }

  function startDeepgramCacheRunner(): void {
    if (deepgramCacheRunnerRef.current) {
      return;
    }

    const generation = deepgramCacheGenerationRef.current;
    const runner = (async () => {
      while (deepgramCacheQueueRef.current.length > 0 && generation === deepgramCacheGenerationRef.current) {
        const task = deepgramCacheQueueRef.current.shift();
        if (!task) {
          continue;
        }

        const controller = new AbortController();
        deepgramAbortControllersRef.current.add(controller);
        // A hung request must surface as an error, not a silent eternal
        // "loading" state with no page turn. User-initiated aborts still
        // produce AbortError and stay silent.
        let requestTimedOut = false;
        const requestTimeoutId = window.setTimeout(() => {
          requestTimedOut = true;
          controller.abort();
        }, DEEPGRAM_REQUEST_TIMEOUT_MS);

        try {
          const model = deepgramModelRef.current || getDefaultDeepgramModel(speechLanguageRef.current);
          const response = await fetch(`${DEEPGRAM_SPEAK_URL}?model=${encodeURIComponent(model)}&encoding=mp3`, {
            method: "POST",
            headers: {
              Accept: "audio/mpeg",
              Authorization: `Token ${DEEPGRAM_FREE_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ text: task.text }),
            signal: controller.signal
          });

          if (!response.ok) {
            const errorBody = (await response.text()).trim();
            throw new Error(
              `Deepgram TTS request failed (${response.status})${errorBody ? `: ${errorBody.slice(0, 180)}` : ""}`
            );
          }

          const audioUrl = URL.createObjectURL(await response.blob());
          if (generation !== deepgramCacheGenerationRef.current) {
            URL.revokeObjectURL(audioUrl);
            throw new DOMException("Speech cache was cleared.", "AbortError");
          }

          deepgramAudioUrlsRef.current.add(audioUrl);
          task.resolve(audioUrl);
        } catch (error) {
          if (generation === deepgramCacheGenerationRef.current) {
            deepgramAudioCacheRef.current.delete(task.cacheKey);
          }
          task.reject(
            requestTimedOut
              ? new Error(
                  `Deepgram speech request timed out after ${Math.round(DEEPGRAM_REQUEST_TIMEOUT_MS / 1000)} seconds. Check your connection and try again.`
                )
              : error
          );
        } finally {
          window.clearTimeout(requestTimeoutId);
          deepgramAbortControllersRef.current.delete(controller);
        }
      }
    })();
    deepgramCacheRunnerRef.current = runner;
    void runner.finally(() => {
      if (deepgramCacheRunnerRef.current === runner) {
        deepgramCacheRunnerRef.current = null;
      }
      if (!deepgramCacheRunnerRef.current && deepgramCacheQueueRef.current.length > 0) {
        startDeepgramCacheRunner();
      }
    });
  }

  function cacheDeepgramChunk(
    pageKey: string,
    chunkIndex: number,
    text: string,
    prioritize = false
  ): Promise<string> {
    const cacheKey = getDeepgramAudioCacheKey(pageKey, chunkIndex);
    const existingPromise = deepgramAudioCacheRef.current.get(cacheKey);
    if (existingPromise) {
      if (prioritize) {
        const queuedIndex = deepgramCacheQueueRef.current.findIndex((task) => task.cacheKey === cacheKey);
        if (queuedIndex > 0) {
          const [task] = deepgramCacheQueueRef.current.splice(queuedIndex, 1);
          deepgramCacheQueueRef.current.unshift(task);
        }
      }
      return existingPromise;
    }

    const promise = new Promise<string>((resolve, reject) => {
      const task = { cacheKey, text, resolve, reject };
      if (prioritize) {
        deepgramCacheQueueRef.current.unshift(task);
      } else {
        deepgramCacheQueueRef.current.push(task);
      }
      startDeepgramCacheRunner();
    });
    deepgramAudioCacheRef.current.set(cacheKey, promise);
    return promise;
  }

  function cacheDeepgramPage(page: DeepgramCachedPage, startIndex = 0): void {
    deepgramCachePagesRef.current.set(page.pageKey, page);
    page.chunks.slice(startIndex).forEach((chunk, offset) => {
      void cacheDeepgramChunk(page.pageKey, startIndex + offset, chunk).catch(() => undefined);
    });
  }

  function getDeepgramAudioElement(): HTMLAudioElement {
    const audio = deepgramAudioRef.current || document.createElement("audio");
    deepgramAudioRef.current = audio;
    audio.autoplay = true;
    audio.controls = false;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.setAttribute("aria-hidden", "true");
    audio.style.position = "fixed";
    audio.style.width = "1px";
    audio.style.height = "1px";
    audio.style.opacity = "0";
    audio.style.pointerEvents = "none";
    if (!audio.isConnected) {
      document.body.appendChild(audio);
    }
    return audio;
  }

  function primeDeepgramAudio(): HTMLAudioElement {
    const audio = getDeepgramAudioElement();
    audio.src = SILENT_AUDIO_URL;
    audio.load();
    void audio.play().catch(() => {
      // The real playback attempt below will surface a useful browser error.
    });
    return audio;
  }

  function getPiperAudioCacheKey(pageKey: string, chunkIndex: number): string {
    return `${piperVoiceRef.current}\n${pageKey}\n${chunkIndex}`;
  }

  function getPiperAudioElement(): HTMLAudioElement {
    const audio = piperAudioRef.current || document.createElement("audio");
    piperAudioRef.current = audio;
    audio.autoplay = true;
    audio.controls = false;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.setAttribute("aria-hidden", "true");
    audio.style.position = "fixed";
    audio.style.width = "1px";
    audio.style.height = "1px";
    audio.style.opacity = "0";
    audio.style.pointerEvents = "none";
    if (!audio.isConnected) {
      document.body.appendChild(audio);
    }
    return audio;
  }

  function primePiperAudio(): HTMLAudioElement {
    const audio = getPiperAudioElement();
    audio.src = SILENT_AUDIO_URL;
    audio.load();
    void audio.play().catch(() => {
      // The real playback attempt below will surface a useful browser error.
    });
    return audio;
  }

  function clearPiperPlayback(): void {
    piperGenerationRef.current += 1;
    piperAudioCacheRef.current.clear();
    [...piperAudioUrlsRef.current].forEach((audioUrl) => {
      URL.revokeObjectURL(audioUrl);
      piperAudioUrlsRef.current.delete(audioUrl);
    });

    const audio = piperAudioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
      piperAudioRef.current = null;
    }
  }

  function cachePiperChunk(pageKey: string, chunkIndex: number, text: string): Promise<string> {
    const cacheKey = getPiperAudioCacheKey(pageKey, chunkIndex);
    const existingPromise = piperAudioCacheRef.current.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const generation = piperGenerationRef.current;
    const promise = (async () => {
      const blob = await generatePiperWav(text, piperVoiceRef.current);
      if (generation !== piperGenerationRef.current) {
        throw new DOMException("Speech cache was cleared.", "AbortError");
      }
      const audioUrl = URL.createObjectURL(blob);
      piperAudioUrlsRef.current.add(audioUrl);
      return audioUrl;
    })().catch((error: unknown) => {
      piperAudioCacheRef.current.delete(cacheKey);
      if (generation !== piperGenerationRef.current && !(error instanceof DOMException)) {
        throw new DOMException("Speech cache was cleared.", "AbortError");
      }
      throw error;
    });
    piperAudioCacheRef.current.set(cacheKey, promise);
    return promise;
  }

  function prefetchPiperChunks(pageKey: string, chunks: string[], startIndex = 0): void {
    chunks.slice(startIndex).forEach((chunk, offset) => {
      void cachePiperChunk(pageKey, startIndex + offset, chunk).catch(() => undefined);
    });
  }

  function getEmaAudioCacheKey(pageKey: string, chunkIndex: number): string {
    return `${emaVoiceRef.current}\n${pageKey}\n${chunkIndex}`;
  }

  function getEmaAudioElement(): HTMLAudioElement {
    const audio = emaAudioRef.current || document.createElement("audio");
    emaAudioRef.current = audio;
    audio.autoplay = true;
    audio.controls = false;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.setAttribute("aria-hidden", "true");
    audio.style.position = "fixed";
    audio.style.width = "1px";
    audio.style.height = "1px";
    audio.style.opacity = "0";
    audio.style.pointerEvents = "none";
    if (!audio.isConnected) {
      document.body.appendChild(audio);
    }
    return audio;
  }

  function primeEmaAudio(): HTMLAudioElement {
    const audio = getEmaAudioElement();
    audio.src = SILENT_AUDIO_URL;
    audio.load();
    void audio.play().catch(() => {
      // The real playback attempt below will surface a useful browser error.
    });
    return audio;
  }

  function clearEmaPlayback(): void {
    emaGenerationRef.current += 1;
    emaAudioCacheRef.current.clear();
    [...emaAudioUrlsRef.current].forEach((audioUrl) => {
      URL.revokeObjectURL(audioUrl);
      emaAudioUrlsRef.current.delete(audioUrl);
    });

    const audio = emaAudioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
      emaAudioRef.current = null;
    }
  }

  function cacheEmaChunk(pageKey: string, chunkIndex: number, text: string): Promise<string> {
    const cacheKey = getEmaAudioCacheKey(pageKey, chunkIndex);
    const existingPromise = emaAudioCacheRef.current.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const generation = emaGenerationRef.current;
    const promise = (async () => {
      const blob = await generateEmaWav(text, emaVoiceRef.current);
      if (generation !== emaGenerationRef.current) {
        throw new DOMException("Speech cache was cleared.", "AbortError");
      }
      const audioUrl = URL.createObjectURL(blob);
      emaAudioUrlsRef.current.add(audioUrl);
      return audioUrl;
    })().catch((error: unknown) => {
      emaAudioCacheRef.current.delete(cacheKey);
      if (generation !== emaGenerationRef.current && !(error instanceof DOMException)) {
        throw new DOMException("Speech cache was cleared.", "AbortError");
      }
      throw error;
    });
    emaAudioCacheRef.current.set(cacheKey, promise);
    return promise;
  }

  function prefetchEmaChunks(pageKey: string, chunks: string[], startIndex = 0): void {
    chunks.slice(startIndex).forEach((chunk, offset) => {
      void cacheEmaChunk(pageKey, startIndex + offset, chunk).catch(() => undefined);
    });
  }

  function isSpeechPaused(): boolean {
    return speechPausedRef.current;
  }

  function stopSpeech(
    nextMode: SpeechMode = isSpeechProviderSupported(speechProviderRef.current) ? "idle" : "unsupported"
  ): void {
    speechTokenRef.current += 1;
    speechShouldContinueRef.current = false;
    speechPausedRef.current = false;
    speechChunksRef.current = [];
    speechChunkIndexRef.current = 0;
    speechPageKeyRef.current = "";
    speechPageSignatureRef.current = "";
    deepgramProgressiveStateRef.current = {
      sentenceCount: 0,
      groupIndex: 0,
      complete: false
    };
    if (!speechPageAdvanceInFlightRef.current) {
      clearSpeechPageTurnWait();
    }
    clearDeepgramPlayback();
    clearPiperPlayback();
    clearEmaPlayback();

    if (isWebSpeechSupported()) {
      window.speechSynthesis.cancel();
    }

    void releaseSpeechWakeLock();
    if (nextMode !== "error") {
      setSpeechError("");
    }
    setSpeechMode(nextMode);
  }

  function resetSpeechForManualPageChange(): void {
    if (
      speechMode === "idle" &&
      speechChunksRef.current.length === 0 &&
      !speechShouldContinueRef.current &&
      !deepgramAudioRef.current &&
      !piperAudioRef.current &&
      !emaAudioRef.current &&
      deepgramCacheQueueRef.current.length === 0 &&
      deepgramAudioCacheRef.current.size === 0 &&
      piperAudioCacheRef.current.size === 0 &&
      emaAudioCacheRef.current.size === 0 &&
      deepgramAbortControllersRef.current.size === 0 &&
      !window.speechSynthesis?.speaking &&
      !window.speechSynthesis?.paused
    ) {
      return;
    }

    stopSpeech();
  }

  function getCurrentSpeechLocation(): ReaderLoc | null {
    return lastLocationRef.current;
  }

  function moveToNextSpeechPage(view: FoliateViewElement, previousPageKey: string): Promise<ReaderLoc | null> {
    clearSpeechPageTurnWait();

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: number | null = null;

      const cleanup = () => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        view.removeEventListener("relocate", handleRelocated);
        if (speechPageTurnCleanupRef.current === cleanup) {
          speechPageTurnCleanupRef.current = null;
        }
      };
      const finish = (location: ReaderLoc | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(location);
      };
      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const hasPageChanged = (location: ReaderLoc | null) =>
        Boolean(location && (location.atEnd || getLocationSpeechKey(location) !== previousPageKey));
      const handleRelocated = (event: Event) => {
        const location = toReaderLoc((event as CustomEvent<FoliateRelocateDetail>).detail);
        if (hasPageChanged(location)) {
          finish(location);
        }
      };

      speechPageTurnCleanupRef.current = cleanup;
      view.addEventListener("relocate", handleRelocated);
      timeoutId = window.setTimeout(() => {
        const location = lastLocationRef.current;
        finish(hasPageChanged(location) ? location : null);
      }, SPEECH_PAGE_TURN_TIMEOUT_MS);

      view
        .next()
        .then(() => {
          const location = lastLocationRef.current;
          if (hasPageChanged(location)) {
            finish(location);
          }
        })
        .catch(fail);
    });
  }

  // Elle çevirme sürerken konuşma sayfa takibi için kısa aralıklarla tekrar
// dener (sınırlı sayıda; sonsuz döngüye girmesin).
function scheduleSpeechPageAdvance(): void {
    if (speechAdvanceRetryRef.current >= MAX_SPEECH_ADVANCE_RETRIES) {
      return;
    }
    speechAdvanceRetryRef.current += 1;
    window.setTimeout(() => {
      if (!speechShouldContinueRef.current || isSpeechPaused()) {
        return;
      }
      advanceAfterSpeechPage();
    }, SPEECH_ADVANCE_RETRY_MS);
  }

  function advanceAfterSpeechPage(): void {
    const view = viewRef.current;
    const currentLocation = getCurrentSpeechLocation();
    const completedPageKey = speechPageKeyRef.current;

    if (!view || currentLocation?.atEnd) {
      stopSpeech("idle");
      return;
    }
    // Bu iki kontrol, önbellek/ilerleme durumuna dokunmadan önce yapılır:
    // aksi hâlde yeniden denemede aynı sayfa iki kez silinir.
    if (speechPageAdvanceInFlightRef.current) {
      return;
    }
    if (manualPageNavigationInFlightRef.current) {
      // Elle çevirme sürüyorsa bekle ve sonra tekrar dene. Önceden sessizce
      // dönmek, konuşma biten sayfadan sonra hiç çevirme yapılmamasına ve
      // okumanın o sayfada kilitlenmesine yol açıyordu.
      scheduleSpeechPageAdvance();
      return;
    }

    const completedDeepgramPage = deepgramCachePagesRef.current.get(completedPageKey);
    if (speechProviderRef.current === "deepgram" && completedDeepgramPage) {
      deepgramProgressiveStateRef.current = completedDeepgramPage.nextProgressiveState;
    }
    deepgramCachePagesRef.current.delete(completedPageKey);

    const token = speechTokenRef.current;
    const navigationGeneration = manualPageNavigationGenerationRef.current;
    speechPageAdvanceInFlightRef.current = true;
    manualPageNavigationInFlightRef.current = true;
    pageNavigationOriginRef.current = "speech";
    clearSpeechPageTurnWait();

    void moveToNextSpeechPage(view, completedPageKey)
      .then((location) => {
        speechPageAdvanceInFlightRef.current = false;
        finishPageNavigation(view, navigationGeneration);
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
          return;
        }

        if (!location || getLocationSpeechKey(location) === completedPageKey) {
          if (!location?.atEnd) {
            setSpeechError("The next EPUB page could not be loaded.");
          }
          stopSpeech(location?.atEnd ? "idle" : "error");
          return;
        }

        speechAdvanceRetryRef.current = 0;
        startSpeechForCurrentPage(location, completedPageKey);
      })
      .catch((error) => {
        speechPageAdvanceInFlightRef.current = false;
        finishPageNavigation(view, navigationGeneration);
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
          return;
        }

        console.error(error);
        stopSpeech("error");
      });
  }

  function speakWebSpeechChunks(startIndex = 0): void {
    if (!isWebSpeechSupported()) {
      setSpeechMode("unsupported");
      return;
    }

    const chunks = speechChunksRef.current;
    if (chunks.length === 0) {
      setSpeechError("There is no readable text on this page.");
      setSpeechMode("error");
      return;
    }

    const token = speechTokenRef.current + 1;
    speechTokenRef.current = token;
    speechChunkIndexRef.current = startIndex;
    clearSpeechPageTurnWait();
    void requestSpeechWakeLock();

    // Chunks that already needed a watchdog retry in this page session.
    const retriedChunks = new Set<number>();

    const speakAt = (index: number) => {
      if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
        return;
      }

      if (index >= chunks.length) {
        advanceAfterSpeechPage();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = speechLanguageRef.current || DEFAULT_SPEECH_LANGUAGE;
      if (speechVoiceRef.current) {
        utterance.voice = speechVoiceRef.current;
      }

      let utteranceSettled = false;
      let watchdogId = 0;
      const clearUtteranceWatchdog = () => {
        utteranceSettled = true;
        if (watchdogId) {
          window.clearTimeout(watchdogId);
          watchdogId = 0;
        }
      };

      utterance.onend = () => {
        clearUtteranceWatchdog();
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
          return;
        }

        speechChunkIndexRef.current = index + 1;
        speakAt(index + 1);
      };

      utterance.onerror = (event) => {
        clearUtteranceWatchdog();
        if (token !== speechTokenRef.current || event.error === "interrupted" || event.error === "canceled") {
          return;
        }

        setSpeechError("The browser speech engine reported an error. Play was stopped.");
        stopSpeech("error");
      };

      // The engine sometimes swallows an utterance entirely (no end, no
      // error, "speaking" forever) — the classic stuck-on-one-page. Retry
      // once, then fail loudly instead of hanging silently. Boundary events
      // prove the utterance is alive, so they re-arm the timer.
      const armWatchdog = () => {
        if (watchdogId) {
          window.clearTimeout(watchdogId);
        }
        watchdogId = window.setTimeout(() => {
          if (utteranceSettled || token !== speechTokenRef.current || !speechShouldContinueRef.current) {
            return;
          }
          try {
            window.speechSynthesis.cancel();
          } catch {
            // Engine already wedged; the retry/stop below still runs.
          }
          if (!retriedChunks.has(index)) {
            retriedChunks.add(index);
            window.setTimeout(() => {
              if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
                return;
              }
              speakAt(index);
            }, 200);
          } else {
            setSpeechError("The browser speech engine stopped responding. Play was stopped.");
            stopSpeech("error");
          }
        }, estimateUtteranceTimeoutMs(chunks[index]));
      };
      utterance.onboundary = () => {
        if (!utteranceSettled && token === speechTokenRef.current && speechShouldContinueRef.current) {
          armWatchdog();
        }
      };
      armWatchdog();

      setSpeechMode("playing");
      window.speechSynthesis.speak(utterance);
    };

    window.speechSynthesis.cancel();
    // Speak-after-cancel in the same task is dropped by Chrome often enough
    // to matter; a short delay makes the start reliable.
    window.setTimeout(() => {
      if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
        return;
      }
      speakAt(startIndex);
    }, WEB_SPEECH_START_DELAY_MS);
  }

  function moveHiddenViewAndWait(action: () => Promise<unknown>): Promise<FoliateRelocateDetail | null> {
    const hiddenView = hiddenViewRef.current;
    if (!hiddenView) {
      return Promise.resolve(hiddenDetailRef.current);
    }

    return new Promise((resolve) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        done(hiddenDetailRef.current);
      }, SPEECH_PAGE_TURN_TIMEOUT_MS);
      const done = (detail: FoliateRelocateDetail | null) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        hiddenView.removeEventListener("relocate", handleRelocated);
        resolve(detail);
      };
      const handleRelocated = (event: Event) => {
        done((event as CustomEvent<FoliateRelocateDetail>).detail || null);
      };

      hiddenView.addEventListener("relocate", handleRelocated);
      action().catch(() => {
        done(hiddenDetailRef.current);
      });
    });
  }

  async function cacheDeepgramCurrentAndNextPages(
    currentPage: DeepgramCachedPage,
    currentLocation: ReaderLoc | null,
    token: number,
    currentStartIndex = 1
  ): Promise<void> {
    cacheDeepgramPage(currentPage, currentStartIndex);

    const hiddenView = hiddenViewRef.current;
    const startCfi = currentLocation?.cfi;
    if (!hiddenView || !startCfi) {
      return;
    }

    try {
      let detail = await moveHiddenViewAndWait(() => hiddenView.goTo(startCfi));
      let progressiveState = currentPage.nextProgressiveState;
      for (let pageOffset = 1; pageOffset < DEEPGRAM_CACHED_PAGE_COUNT; pageOffset += 1) {
        const currentLoc = detail ? toReaderLoc(detail) : null;
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current || !detail || currentLoc?.atEnd) {
          return;
        }

        detail = await moveHiddenViewAndWait(() => hiddenView.next());
        const snapshot = createVisibleSpeechSnapshot(hiddenView, detail);
        if (!snapshot.text || !snapshot.pageKey || snapshot.pageKey === currentPage.pageKey) {
          continue;
        }

        const page = createDeepgramCachedPage(snapshot.pageKey, snapshot.text, progressiveState);
        cacheDeepgramPage(page);
        progressiveState = page.nextProgressiveState;
      }
    } catch (error) {
      console.warn("Could not prepare upcoming Deepgram speech pages.", error);
    }
  }

  function speakDeepgramChunks(startIndex = 0): void {
    const chunks = speechChunksRef.current;
    if (chunks.length === 0) {
      setSpeechError("There is no readable text on this page.");
      setSpeechMode("error");
      return;
    }

    const token = speechTokenRef.current + 1;
    speechTokenRef.current = token;
    speechChunkIndexRef.current = startIndex;
    clearSpeechPageTurnWait();
    void requestSpeechWakeLock();
    const pageKey = speechPageKeyRef.current;
    const currentPage = deepgramCachePagesRef.current.get(pageKey);
    if (!currentPage) {
      setSpeechError("The Deepgram page cache could not be prepared.");
      stopSpeech("error");
      return;
    }

    const playAt = async (index: number): Promise<void> => {
      if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
        return;
      }

      if (index >= chunks.length) {
        advanceAfterSpeechPage();
        return;
      }

      speechChunkIndexRef.current = index;
      setSpeechMode("loading");

      try {
        const audioUrl = await cacheDeepgramChunk(pageKey, index, chunks[index], true);
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
          return;
        }

        const audio = getDeepgramAudioElement();
        audio.pause();
        audio.muted = false;
        deepgramAudioRef.current = audio;

        let stopAudioWatch: (() => void) | null = null;
        const releaseCompletedAudio = () => {
          stopAudioWatch?.();
          stopAudioWatch = null;
          audio.onended = null;
          audio.onerror = null;
          deepgramAudioCacheRef.current.delete(getDeepgramAudioCacheKey(pageKey, index));
          if (deepgramAudioUrlsRef.current.delete(audioUrl)) {
            URL.revokeObjectURL(audioUrl);
          }
        };

        audio.onended = () => {
          releaseCompletedAudio();
          if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
            return;
          }

          speechChunkIndexRef.current = index + 1;
          void playAt(index + 1);
        };

        audio.onerror = () => {
          releaseCompletedAudio();
          if (token === speechTokenRef.current) {
            setSpeechError("The buffered Deepgram audio could not be played.");
            stopSpeech("error");
          }
        };

        if (isSpeechPaused()) {
          setSpeechMode("paused");
          return;
        }

        audio.src = audioUrl;
        audio.load();
        setSpeechMode("playing");
        await playAudioWithTimeout(audio, SPEECH_AUDIO_PLAY_TIMEOUT_MS, "Deepgram audio");
        // If 'ended' never fires (stalled decode), force-advance instead of
        // sitting on one page forever.
        stopAudioWatch = watchAudioProgress(
          audio,
          () => token === speechTokenRef.current && speechShouldContinueRef.current,
          () => {
            releaseCompletedAudio();
            if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
              return;
            }
            speechChunkIndexRef.current = index + 1;
            void playAt(index + 1);
          }
        );
        if (index === startIndex) {
          void cacheDeepgramCurrentAndNextPages(currentPage, getCurrentSpeechLocation(), token, index + 1);
        }
      } catch (error) {
        if ((error instanceof DOMException && error.name === "AbortError") || token !== speechTokenRef.current) {
          return;
        }

        console.error(error);
        setSpeechError(error instanceof Error ? error.message : "Deepgram speech playback failed.");
        stopSpeech("error");
      }
    };

    void playAt(startIndex);
  }

  function speakPiperChunks(startIndex = 0): void {
    const chunks = speechChunksRef.current;
    if (chunks.length === 0) {
      setSpeechError("There is no readable text on this page.");
      setSpeechMode("error");
      return;
    }

    const token = speechTokenRef.current + 1;
    speechTokenRef.current = token;
    speechChunkIndexRef.current = startIndex;
    clearSpeechPageTurnWait();
    void requestSpeechWakeLock();
    const pageKey = speechPageKeyRef.current;
    prefetchPiperChunks(pageKey, chunks, startIndex);

    const playAt = async (index: number): Promise<void> => {
      if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
        return;
      }

      if (index >= chunks.length) {
        advanceAfterSpeechPage();
        return;
      }

      speechChunkIndexRef.current = index;
      setSpeechMode("loading");

      try {
        const audioUrl = await cachePiperChunk(pageKey, index, chunks[index]);
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
          return;
        }

        const audio = getPiperAudioElement();
        audio.pause();
        audio.muted = false;
        piperAudioRef.current = audio;

        const releaseCompletedAudio = () => {
          audio.onended = null;
          audio.onerror = null;
          piperAudioCacheRef.current.delete(getPiperAudioCacheKey(pageKey, index));
          if (piperAudioUrlsRef.current.delete(audioUrl)) {
            URL.revokeObjectURL(audioUrl);
          }
        };

        audio.onended = () => {
          releaseCompletedAudio();
          if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
            return;
          }

          speechChunkIndexRef.current = index + 1;
          void playAt(index + 1);
        };

        audio.onerror = () => {
          releaseCompletedAudio();
          if (token === speechTokenRef.current) {
            setSpeechError("The Piper audio could not be played.");
            stopSpeech("error");
          }
        };

        if (isSpeechPaused()) {
          setSpeechMode("paused");
          return;
        }

        audio.src = audioUrl;
        audio.load();
        setSpeechMode("playing");
        await playAudioWithTimeout(audio, SPEECH_AUDIO_PLAY_TIMEOUT_MS, "Piper audio");
      } catch (error) {
        if ((error instanceof DOMException && error.name === "AbortError") || token !== speechTokenRef.current) {
          return;
        }

        console.error(error);
        setSpeechError(error instanceof Error ? error.message : "Piper speech playback failed.");
        stopSpeech("error");
      }
    };

    void playAt(startIndex);
  }

  function speakEmaChunks(startIndex = 0): void {
    const chunks = speechChunksRef.current;
    if (chunks.length === 0) {
      setSpeechError("There is no readable text on this page.");
      setSpeechMode("error");
      return;
    }

    const token = speechTokenRef.current + 1;
    speechTokenRef.current = token;
    speechChunkIndexRef.current = startIndex;
    clearSpeechPageTurnWait();
    void requestSpeechWakeLock();
    const pageKey = speechPageKeyRef.current;
    prefetchEmaChunks(pageKey, chunks, startIndex);

    const playAt = async (index: number): Promise<void> => {
      if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
        return;
      }

      if (index >= chunks.length) {
        advanceAfterSpeechPage();
        return;
      }

      speechChunkIndexRef.current = index;
      setSpeechMode("loading");

      try {
        const audioUrl = await cacheEmaChunk(pageKey, index, chunks[index]);
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
          return;
        }

        const audio = getEmaAudioElement();
        audio.pause();
        audio.muted = false;
        emaAudioRef.current = audio;

        const releaseCompletedAudio = () => {
          audio.onended = null;
          audio.onerror = null;
          emaAudioCacheRef.current.delete(getEmaAudioCacheKey(pageKey, index));
          if (emaAudioUrlsRef.current.delete(audioUrl)) {
            URL.revokeObjectURL(audioUrl);
          }
        };

        audio.onended = () => {
          releaseCompletedAudio();
          if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
            return;
          }

          speechChunkIndexRef.current = index + 1;
          void playAt(index + 1);
        };

        audio.onerror = () => {
          releaseCompletedAudio();
          if (token === speechTokenRef.current) {
            setSpeechError("The Ema audio could not be played.");
            stopSpeech("error");
          }
        };

        if (isSpeechPaused()) {
          setSpeechMode("paused");
          return;
        }

        audio.src = audioUrl;
        audio.load();
        setSpeechMode("playing");
        await playAudioWithTimeout(audio, SPEECH_AUDIO_PLAY_TIMEOUT_MS, "Ema audio");
      } catch (error) {
        if ((error instanceof DOMException && error.name === "AbortError") || token !== speechTokenRef.current) {
          return;
        }

        console.error(error);
        setSpeechError(error instanceof Error ? error.message : "Ema speech playback failed.");
        stopSpeech("error");
      }
    };

    void playAt(startIndex);
  }

  function speakSpeechChunks(startIndex = 0): void {
    if (speechProviderRef.current === "deepgram") {
      speakDeepgramChunks(startIndex);
      return;
    }

    if (speechProviderRef.current === "piper") {
      speakPiperChunks(startIndex);
      return;
    }

    if (speechProviderRef.current === "ema") {
      speakEmaChunks(startIndex);
      return;
    }

    speakWebSpeechChunks(startIndex);
  }

  function startSpeechForCurrentPage(
    location: ReaderLoc | null = getCurrentSpeechLocation(),
    previousPageKey = ""
  ): void {
    const view = viewRef.current;
    if (!view) {
      stopSpeech("idle");
      return;
    }

    const snapshot = createVisibleSpeechSnapshot(view, lastDetailRef.current);
    const pageKey = snapshot.pageKey || getLocationSpeechKey(location);
    if (previousPageKey && (!pageKey || pageKey === previousPageKey)) {
      setSpeechError("The reader did not finish changing pages.");
      stopSpeech("error");
      return;
    }

    speechPageKeyRef.current = pageKey;
    speechPageSignatureRef.current = getRendererSignature(view);
    if (!snapshot.text) {
      if (location?.atEnd) {
        stopSpeech("idle");
        return;
      }

      advanceAfterSpeechPage();
      return;
    }

    if (speechProviderRef.current === "deepgram") {
      const page =
        deepgramCachePagesRef.current.get(pageKey) ||
        createDeepgramCachedPage(pageKey, snapshot.text, deepgramProgressiveStateRef.current);
      deepgramCachePagesRef.current.set(pageKey, page);
      speechChunksRef.current = page.chunks;
    } else {
      speechChunksRef.current = splitSpeechText(snapshot.text);
    }
    speechChunkIndexRef.current = 0;
    speakSpeechChunks(0);
  }

  async function toggleSpeech(): Promise<void> {
    const provider = speechProviderRef.current;
    if (!isSpeechProviderSupported(provider)) {
      setSpeechMode("unsupported");
      return;
    }

    if (speechMode === "loading") {
      stopSpeech();
      return;
    }

    if (speechMode === "playing") {
      if (provider === "web-speech") {
        speechPausedRef.current = true;
        // pause() on an idle engine wedges Chrome's queue; only pause while
        // something is actually being spoken.
        try {
          if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.pause();
          }
        } catch {
          // Pausing is best-effort; the paused flag still stops chunk flow.
        }
        setSpeechMode("paused");
        void releaseSpeechWakeLock();
        return;
      } else {
        stopSpeech();
        return;
      }
    }

    if (speechMode === "paused") {
      if (provider === "web-speech") {
        speechShouldContinueRef.current = true;
        speechPausedRef.current = false;
        if (window.speechSynthesis.paused) {
          try {
            window.speechSynthesis.resume();
          } catch {
            // A wedged engine ignores resume(); restart below instead.
            window.speechSynthesis.cancel();
            speakSpeechChunks(speechChunkIndexRef.current);
            return;
          }
        } else {
          // Not paused but mode says paused: the engine is wedged. Restart
          // the current chunk instead of resuming into the wedge.
          window.speechSynthesis.cancel();
          speakSpeechChunks(speechChunkIndexRef.current);
          return;
        }
        setSpeechMode("playing");
        void requestSpeechWakeLock();
        return;
      } else {
        stopSpeech();
      }
    }

    const activeBookForSpeech = activeBookRef.current;
    const view = viewRef.current;
    if (!activeBookForSpeech || !view || readerStatus !== "ready") {
      return;
    }

    let playRequestToken = speechTokenRef.current;
    if (provider !== "web-speech") {
      stopSpeech();
      playRequestToken = speechTokenRef.current;
    }

    setSpeechMode(provider === "web-speech" ? "playing" : "loading");
    setSpeechError("");
    speechShouldContinueRef.current = true;
    speechPausedRef.current = false;
    if (provider === "deepgram") {
      primeDeepgramAudio();
      if (playRequestToken !== speechTokenRef.current || !speechShouldContinueRef.current) {
        return;
      }
    }
    if (provider === "piper") {
      primePiperAudio();
      if (playRequestToken !== speechTokenRef.current || !speechShouldContinueRef.current) {
        return;
      }
    }
    if (provider === "ema") {
      primeEmaAudio();
      if (playRequestToken !== speechTokenRef.current || !speechShouldContinueRef.current) {
        return;
      }
    }

    const currentLocation = getCurrentSpeechLocation();
    const currentSnapshot = createVisibleSpeechSnapshot(view, lastDetailRef.current);
    if (!currentSnapshot.text) {
      if (currentLocation?.atEnd) {
        stopSpeech("idle");
        return;
      }
      // Görünen sayfada okunacak metin yok (ör. yalnızca kapak görseli):
      // hata vermek yerine sonraki metinli sayfadan başla.
      speechPageKeyRef.current = currentSnapshot.pageKey || getLocationSpeechKey(currentLocation);
      speechPageSignatureRef.current = getRendererSignature(view);
      advanceAfterSpeechPage();
      return;
    }

    const initialLanguage = speechLanguageRef.current || DEFAULT_SPEECH_LANGUAGE;
    const currentPageKey = currentSnapshot.pageKey;

    speechLanguageRef.current = initialLanguage;
    if (provider === "web-speech") {
      speechVoiceRef.current = selectVoiceForLanguage(initialLanguage, window.speechSynthesis.getVoices());
    }
    if (provider === "deepgram") {
      const currentPage = createDeepgramCachedPage(
        currentPageKey,
        currentSnapshot.text,
        deepgramProgressiveStateRef.current
      );
      deepgramCachePagesRef.current.set(currentPageKey, currentPage);
      speechChunksRef.current = currentPage.chunks;
    } else {
      speechChunksRef.current = splitSpeechText(currentSnapshot.text);
    }
    speechChunkIndexRef.current = 0;
    speechPageKeyRef.current = currentPageKey;
    speechPageSignatureRef.current = getRendererSignature(view);
    speakSpeechChunks(0);
  }

  const upsertBook = useCallback((bookUrl: string, openBook = true): string => {
    const normalizedUrl = normalizeBookUrl(bookUrl);
    const existingId = hashText(normalizedUrl);

    setLibrary((currentLibrary) => {
      const existingBook = currentLibrary.find((book) => book.id === existingId);
      if (existingBook) {
        return currentLibrary.map((book) =>
          book.id === existingId ? { ...book, updatedAt: new Date().toISOString() } : book
        );
      }

      if (openBook) {
        pendingAddedBookIdsRef.current.add(existingId);
      }
      return [createBook(normalizedUrl), ...currentLibrary];
    });

    if (openBook) {
      setActiveBookId(existingId);
      setIsAddOpen(false);
    }

    return existingId;
  }, [setLibrary]);

  const upsertUploadedBook = useCallback(async (file: File, openBook = true): Promise<string> => {
    const storageKey = `upload-${hashText(`${file.name}:${file.size}:${file.lastModified}`)}`;
    const uploadedBook = createUploadedBook(file, storageKey);

    await saveUploadedBookBlob(storageKey, file);

    setLibrary((currentLibrary) => {
      const existingBook = currentLibrary.find((book) => book.id === uploadedBook.id);
      if (existingBook) {
        return currentLibrary.map((book) =>
          book.id === uploadedBook.id
            ? {
                ...book,
                url: uploadedBook.url,
                source: "file",
                fileStorageKey: storageKey,
                fileName: file.name,
                fileSize: file.size,
                updatedAt: new Date().toISOString()
              }
            : book
        );
      }

      if (openBook) {
        pendingAddedBookIdsRef.current.add(uploadedBook.id);
      }
      return [uploadedBook, ...currentLibrary];
    });

    if (openBook) {
      setActiveBookId(uploadedBook.id);
      setIsAddOpen(false);
    }

    return uploadedBook.id;
  }, [setLibrary]);

  const openAddDialog = () => {
    setAddDialogError("");
    setIsAddOpen(true);
  };

  const removePendingAddedBook = useCallback((book: LibraryBook): void => {
    if (!pendingAddedBookIdsRef.current.has(book.id)) {
      return;
    }

    pendingAddedBookIdsRef.current.delete(book.id);
    if (book.source === "file" && book.fileStorageKey) {
      void deleteUploadedBookBlob(book.fileStorageKey);
    }

    setLibrary((currentLibrary) => currentLibrary.filter((storedBook) => storedBook.id !== book.id));
    setActiveBookId((currentBookId) => (currentBookId === book.id ? null : currentBookId));
    setBookInfo(null);
    setProgress(null);
  }, [setLibrary]);

  useEffect(() => {
    if (queryBookUrl && !queryBookHandledRef.current) {
      queryBookHandledRef.current = true;
      try {
        upsertBook(queryBookUrl, true);
      } catch {
        setReaderError("The epub query string is not a valid EPUB URL.");
      }
      return;
    }

    if (queryBookUrl) {
      return;
    }

    const lastOpenedBook = [...library].sort((first, second) =>
      (second.updatedAt || "").localeCompare(first.updatedAt || "")
    )[0];

    if (!activeBookId && lastOpenedBook) {
      setActiveBookId(lastOpenedBook.id);
      setIsAddOpen(false);
    }
  }, [activeBookId, library, queryBookUrl, upsertBook]);

  useEffect(() => {
    // Readest: ayar değişince stil + düzen nitelikleri yeniden uygulanır.
    for (const view of [viewRef.current, hiddenViewRef.current]) {
      applyFoliateStyles(view, settings);
      applyFoliateLayout(view, settings);
      if (view) {
        for (const { doc } of view.renderer.getContents?.() ?? []) {
          applyThemeModeClass(doc, settings.theme !== "light");
        }
      }
    }
  }, [settings]);

  // Gerçek sayfa tablosunu (bölüm başına yeniden akıtılmış sayfa sayısı)
  // arka planda hesaplar. Konum (location) sayacı fonta göre değişmediği
  // için footer'daki "N / M" değerini bu tablo belirler.
  const refreshRealPage = useCallback(() => {
    const view = viewRef.current;
    const table = pageTableRef.current;
    if (!view || !table) {
      return;
    }
    const total = totalRealPages(table);
    const page = currentPageNumber(view.renderer as unknown as PageCounterRenderer, table);
    if (page == null || total <= 0) {
      return;
    }
    setProgress((current) =>
      current ? { ...current, page, totalPages: total } : current
    );
  }, []);

  useEffect(() => {
    if (readerStatus !== "ready" || !activeBook) {
      return undefined;
    }
    const container = pageCounterContainerRef.current;
    const viewer = viewerRef.current;
    const input = bookInputRef.current;
    if (!container || !viewer || !input) {
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        destroyFoliateView(pageCounterViewRef.current);
        pageCounterViewRef.current = null;
        container.replaceChildren();
        // Sayaç görünür okuyucuyla birebir aynı boyutta olmalı; sayfa sayısı
        // sütun genişliğine bağlıdır.
        const rect = viewer.getBoundingClientRect();
        container.style.width = `${Math.max(1, Math.round(rect.width))}px`;
        container.style.height = `${Math.max(1, Math.round(rect.height))}px`;

        const counterView = document.createElement(
          "foliate-view"
        ) as unknown as FoliateViewElement;
        container.append(counterView);
        pageCounterViewRef.current = counterView;
        applyFoliateLayout(counterView, settingsRef.current);
        try {
          await withTimeout(counterView.open(input), EPUB_OPEN_TIMEOUT_MS, "Page counting timed out.");
          applyFoliateLayout(counterView, settingsRef.current);
          applyFoliateStyles(counterView, settingsRef.current);
          const table = await buildPageTable(
            counterView as unknown as Parameters<typeof buildPageTable>[0],
            () => !cancelled,
            (done, total) => setPageCountProgress({ done, total })
          );
          if (cancelled) {
            return;
          }
          pageTableRef.current = table;
          setPageCountProgress(null);
          refreshRealPage();
        } catch {
          setPageCountProgress(null);
        }
      })();
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // Yarıda kalan bir sayımın göstergesi ekranda asılı kalmasın.
      setPageCountProgress(null);
    };
  }, [activeBookId, readerStatus, settings, refreshRealPage]);

  useEffect(() => {
    if (!activeBook) {
      setBookInfo(null);
      setProgress(null);
      setAreLocationsReady(false);
      pageTableRef.current = null;
      setPageCountProgress(null);
      lastLocationRef.current = null;
      lastDetailRef.current = null;
      hiddenDetailRef.current = null;
      viewRef.current = null;
      hiddenViewRef.current = null;
      viewerRef.current?.replaceChildren();
      deepgramCacheContainerRef.current?.replaceChildren();
      return undefined;
    }

    if (!viewerRef.current || !deepgramCacheContainerRef.current) {
      return undefined;
    }

    let cancelled = false;
    const container = viewerRef.current;
    const cacheContainer = deepgramCacheContainerRef.current;

    setReaderError("");
    setReaderStatus("loading");
    setBookInfo(null);
    setProgress(null);
    setAreLocationsReady(false);
    lastLocationRef.current = null;
    lastDetailRef.current = null;
    hiddenDetailRef.current = null;
    pageTableRef.current = null;
    setPageCountProgress(null);
    stopSpeech();
    manualPageNavigationGenerationRef.current += 1;
    manualPageNavigationInFlightRef.current = false;
    pageNavigationOriginRef.current = null;
    pendingManualPageDirectionRef.current = null;
    pendingManualTurnsRef.current = 0;
    container.replaceChildren();
    cacheContainer.replaceChildren();

    destroyFoliateView(viewRef.current);
    viewRef.current = null;
    destroyFoliateView(hiddenViewRef.current);
    hiddenViewRef.current = null;

    let openedView: FoliateViewElement | null = null;
    let openedHiddenView: FoliateViewElement | null = null;
    let handleKeyDown: ((event: KeyboardEvent) => void) | null = null;
    let openFailed = false;
    let didRelocate = false;

    const failOpen = (message = "This EPUB could not be opened. Check that the file or URL is valid and reachable.") => {
      if (cancelled) {
        return;
      }

      openFailed = true;
      removePendingAddedBook(activeBook);
      setReaderStatus("error");
      setReaderError(message);
    };

    const failOpenWithCause = (error: unknown, fallback: string) => {
      const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
      failOpen(`${fallback}${detail}`.slice(0, 300));
    };

    const saveReadingLocation = (detail: FoliateRelocateDetail) => {
      if (!activeBookRef.current) {
        return;
      }

      const { percentage } = getFoliateProgress(detail);
      // Gerçek, yeniden akıtılmış sayfa sayacı hazırsa onu kullan; hazır değilse
      // Foliate'in konum (location) tahminine düş.
      const table = pageTableRef.current;
      const realTotal = table ? totalRealPages(table) : 0;
      const realPage = table && openedView ? currentPageNumber(openedView.renderer as unknown as PageCounterRenderer, table) : null;
      const { page, totalPages } =
        realPage != null && realTotal > 0
          ? { page: realPage, totalPages: realTotal }
          : getFoliateProgress(detail);
      const currentBookId = activeBookRef.current.id;

      setLibrary((currentLibrary) =>
        currentLibrary.map((storedBook) =>
          storedBook.id === currentBookId
            ? {
                ...storedBook,
                updatedAt: new Date().toISOString(),
                position: {
                  cfi: detail.cfi,
                  href: "",
                  percentage,
                  isPrecise: percentage != null,
                  progressMethod: PROGRESS_METHOD,
                  updatedAt: new Date().toISOString()
                }
              }
            : storedBook
        )
      );

      setProgress({ href: "", percentage: percentage ?? null, page, totalPages });
    };

    const handleRelocate = (event: Event) => {
      const detail = (event as CustomEvent<FoliateRelocateDetail>).detail;
      if (!detail || !detail.cfi || viewRef.current !== openedView) {
        return;
      }

      didRelocate = true;
      lastLocationRef.current = toReaderLoc(detail);
      lastDetailRef.current = detail;
      setAreLocationsReady(true);
      // NOTE: compare the visible page signature, NOT the CFI string. The
      // paginator emits 'relocate' for background work too (adjacent-section
      // preload, resize re-renders), each time with a freshly computed range
      // whose CFI string can differ while the visible page is unchanged.
      // Killing speech on CFI mismatch stopped read-aloud by itself a few
      // seconds into every page. Real user turns already stop speech
      // explicitly via resetSpeechForManualPageChange(); this is only a
      // backstop for programmatic jumps outside an advance.
      if (
        speechShouldContinueRef.current &&
        !speechPageAdvanceInFlightRef.current &&
        openedView
      ) {
        const currentSignature = getRendererSignature(openedView);
        if (
          speechPageSignatureRef.current &&
          currentSignature &&
          currentSignature !== speechPageSignatureRef.current
        ) {
          stopSpeech();
        }
      }
      saveReadingLocation(detail);
    };

    const handleHiddenRelocate = (event: Event) => {
      const detail = (event as CustomEvent<FoliateRelocateDetail>).detail;
      if (detail?.cfi && hiddenViewRef.current === openedHiddenView) {
        hiddenDetailRef.current = detail;
      }
    };

    // Readest: FoliateViewer.docLoadHandler — belge yüklenince çalışan düzeltmeler.
    const handleDocLoad = (event: Event) => {
      const doc = (event as CustomEvent<{ doc: Document }>).detail?.doc;
      if (!doc) {
        return;
      }
      guardFoliateDoc(doc);
      applyNamespacedAttributes(doc);
      applyLinkHitArea(doc);
      applyImageStyle(doc);
      applyScrollModeClass(doc, false);
      applyThemeModeClass(doc, settingsRef.current.theme !== "light");
    };

    // Readest: book.transformTarget 'data' olayı — yayıncının CSS'ini ve
    // XHTML içeriğini iframe'e girmeden önce düzeltir.
    const handleTransformData = (event: Event) => {
      const detail = (event as CustomEvent<{ data: unknown; type: string }>).detail;
      if (!detail) {
        return;
      }
      const view = openedView;
      detail.data = Promise.resolve(detail.data)
        .then((data) => {
          if (detail.type === "text/css" && typeof data === "string") {
            return transformStylesheet(
              data,
              settingsRef.current.viewSettings.vertical,
              view?.book?.rendition?.layout === "pre-paginated"
            );
          }
          return data;
        })
        .catch(() => "");
    };

    void (async () => {
      try {
        await import("./foliate/view.js");
        if (cancelled) {
          return;
        }

        const source = await resolveBookSource(activeBook);
        if (cancelled) {
          return;
        }

        const input = source.input;
        bookInputRef.current = input;

        const viewElement = document.createElement("foliate-view") as unknown as FoliateViewElement;
        container.append(viewElement);
        openedView = viewElement;
        viewRef.current = viewElement;
        viewElement.addEventListener("relocate", handleRelocate);
        viewElement.addEventListener("load", handleDocLoad);

        await withTimeout(viewElement.open(input), EPUB_OPEN_TIMEOUT_MS, "EPUB opening timed out.");
        if (cancelled || viewRef.current !== viewElement) {
          return;
        }

        const metadata = viewElement.book?.metadata;
        const title = normalizeMetaText(metadata?.title) || activeBook.title || "Untitled EPUB";
        const author = normalizeMetaText(metadata?.author) || activeBook.author;
        setBookInfo({ title, author });
        setLibrary((currentLibrary) =>
          currentLibrary.map((storedBook) =>
            storedBook.id === activeBook.id
              ? { ...storedBook, title, author, updatedAt: new Date().toISOString() }
              : storedBook
          )
        );

        applyFoliateStyles(viewElement, settingsRef.current);
        applyFoliateLayout(viewElement, settingsRef.current);
        viewElement.book?.transformTarget?.addEventListener("data", handleTransformData);

        // Readest's paginator emits this after the iframe is laid out and its
        // column/spread count is final.  Do not expose a half-paginated reader
        // while the initial navigation is still settling.
        const handleStabilized = () => {
          if (!cancelled && viewRef.current === viewElement && didRelocate) {
            pendingAddedBookIdsRef.current.delete(activeBook.id);
            setReaderStatus("ready");
            setAreLocationsReady(true);
          }
        };
        viewElement.renderer.addEventListener("stabilized", handleStabilized);

        // Readest positions the first render either at the saved CFI or, when
        // there is none, at the start of the text (`goToFraction(0)`), then lets
        // the paginator settle.  `init` also records the initial history entry.
        const startCfi = activeBook.position?.cfi || undefined;
        try {
          if (startCfi) {
            await withTimeout(viewElement.init({ lastLocation: startCfi }), EPUB_OPEN_TIMEOUT_MS, "EPUB opening timed out.");
          } else {
            await withTimeout(viewElement.goToFraction(0), EPUB_OPEN_TIMEOUT_MS, "EPUB opening timed out.");
          }
        } catch (error) {
          // A stale saved CFI must not fail the whole open; fall back to start.
          if (startCfi) {
            try {
              await withTimeout(viewElement.goToFraction(0), EPUB_OPEN_TIMEOUT_MS, "EPUB opening timed out.");
            } catch (fallbackError) {
              failOpenWithCause(fallbackError, "This EPUB could not be opened. Check that the file is valid and the URL allows browser access.");
              return;
            }
          } else {
            failOpenWithCause(error, "This EPUB could not be opened. Check that the file is valid and the URL allows browser access.");
            return;
          }
        }

        // Some fixed-layout EPUBs do not emit `stabilized`; their initial
        // relocation is already their final page layout.
        if (!cancelled && !openFailed && viewElement.book?.rendition?.layout === "pre-paginated") {
          handleStabilized();
        }

        // The off-screen view only preloads text for Deepgram.  It must never
        // block opening or turn an otherwise valid book into a reader error.
        const hiddenElement = document.createElement("foliate-view") as unknown as FoliateViewElement;
        cacheContainer.append(hiddenElement);
        openedHiddenView = hiddenElement;
        hiddenViewRef.current = hiddenElement;
        hiddenElement.addEventListener("relocate", handleHiddenRelocate);
        hiddenElement.addEventListener("load", handleDocLoad);
        try {
          // Match the visible view's column math so cached page text lines up.
          applyFoliateLayout(hiddenElement, settingsRef.current);
          await withTimeout(hiddenElement.open(input), EPUB_OPEN_TIMEOUT_MS, "Hidden EPUB preload timed out.");
          if (!cancelled && hiddenViewRef.current === hiddenElement) {
            applyFoliateStyles(hiddenElement, settingsRef.current);
          }
        } catch (error) {
          console.warn("EPUB text preload was unavailable; reading remains available.", error);
          destroyFoliateView(hiddenElement);
          if (hiddenViewRef.current === hiddenElement) {
            hiddenViewRef.current = null;
          }
        }

        handleKeyDown = (event: KeyboardEvent) => {
          if (!openedView) {
            return;
          }

          if (event.key === "ArrowLeft") {
            navigateManually("previous");
          }
          if (event.key === "ArrowRight") {
            navigateManually("next");
          }
        };

        window.addEventListener("keydown", handleKeyDown);
      } catch (error) {
        failOpenWithCause(error, "This EPUB could not be opened. Check that the file is valid and the URL allows browser access.");
      }
    })();

    return () => {
      cancelled = true;
      manualPageNavigationGenerationRef.current += 1;
      manualPageNavigationInFlightRef.current = false;
      pageNavigationOriginRef.current = null;
      pendingManualTurnsRef.current = 0;
      pendingManualPageDirectionRef.current = null;
      speechPageAdvanceInFlightRef.current = false;
      clearSpeechPageTurnWait();
      clearPageHoldNavigation();
      stopSpeech();
      if (handleKeyDown) {
        window.removeEventListener("keydown", handleKeyDown);
      }
      destroyFoliateView(openedView);
      destroyFoliateView(openedHiddenView);
      if (viewRef.current === openedView) {
        viewRef.current = null;
      }
      if (hiddenViewRef.current === openedHiddenView) {
        hiddenViewRef.current = null;
      }
    };  }, [activeBook?.id, removePendingAddedBook]);

  const addBookFromInput = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      setAddDialogError("");
      upsertBook(urlInput, true);
      setUrlInput("");
    } catch {
      setAddDialogError("Enter a valid absolute or relative EPUB URL.");
    }
  };

  const addBookFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] || null;
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".epub") && file.type !== "application/epub+zip") {
      setAddDialogError("Choose a .epub file.");
      return;
    }

    setIsUploadingBook(true);
    setAddDialogError("");
    try {
      await upsertUploadedBook(file, true);
      setUrlInput("");
    } catch {
      setAddDialogError("This EPUB could not be saved in the browser.");
    } finally {
      setIsUploadingBook(false);
    }
  };

  const showSidebar = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setIsSidebarPinned(false);
    }
    setIsSidebarOpen(true);
  };

  const openBook = (bookId: string) => {
    setActiveBookId(bookId);
    setIsAddOpen(false);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  const removeBook = (bookId: string) => {
    const removedBook = library.find((book) => book.id === bookId);
    if (removedBook?.source === "file" && removedBook.fileStorageKey) {
      void deleteUploadedBookBlob(removedBook.fileStorageKey);
    }

    setLibrary((currentLibrary) => currentLibrary.filter((book) => book.id !== bookId));
    if (activeBookId === bookId) {
      const nextBook = library.find((book) => book.id !== bookId);
      setActiveBookId(nextBook?.id ?? null);
      if (!nextBook) {
        setBookInfo(null);
        setProgress(null);
        setReaderStatus("idle");
        setReaderError("");
      }
    }
  };

  function finishPageNavigation(view: FoliateViewElement, generation: number): void {
    // Kilitler her zaman temizlenmeli. Önceden aşağıdaki guard'da erken
    // dönüldüğünde `manualPageNavigationInFlightRef` true kalıyordu ve
    // konuşmanın sayfa takibi (advanceAfterSpeechPage) bir daha asla
    // çevirme yapamıyordu.
    manualPageNavigationInFlightRef.current = false;
    pageNavigationOriginRef.current = null;

    if (
      generation !== manualPageNavigationGenerationRef.current ||
      viewRef.current !== view
    ) {
      return;
    }

    // Konuşma sürerken sayfa takibi var; elle kuyruğu boşaltmak konuşmanın
    // okuduğu sayfayı kaydırır ve konuşmayı keser.
    if (speechShouldContinueRef.current) {
      return;
    }

    const pendingDirection = pendingManualPageDirectionRef.current;
    pendingManualPageDirectionRef.current = null;
    if (pendingDirection) {
      navigateManually(pendingDirection);
      return;
    }
    // Kuyrukta başka çevirme varsa sıradakini başlat. Coalescing: basılan tuş
    // sayısı kadar çevirme yapılır ama her turda yalnızca biri işlenir, bu
    // yüzden okuyucu animasyonu boğulmadan hızı korur.
    if (pendingManualTurnsRef.current !== 0) {
      const direction = pendingManualTurnsRef.current > 0 ? "next" : "previous";
      pendingManualTurnsRef.current += pendingManualTurnsRef.current > 0 ? -1 : 1;
      navigateManually(direction);
    }
  }

  function moveManualPageAndWaitForRelocation(
    view: FoliateViewElement,
    direction: "previous" | "next"
  ): Promise<void> {
    const previousPageKey = getLocationSpeechKey(lastLocationRef.current);
    // CFI bölüm sınırında değişmeyebilir; bölüm+sayfa imzası da izlenir ki
    // çevirme gerçekten bitmeden kilitli kalmayalım.
    const previousSignature = getRendererSignature(view);

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: number | null = null;

      const cleanup = () => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        view.removeEventListener("relocate", handleRelocated);
      };
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };
      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const hasNavigationFinished = (location: ReaderLoc | null) =>
        Boolean(
          location &&
            (getLocationSpeechKey(location) !== previousPageKey ||
              (direction === "next" ? location.atEnd : location.atStart))
        );
      const handleRelocated = (event: Event) => {
        const detail = (event as CustomEvent<FoliateRelocateDetail>).detail;
        if (hasNavigationFinished(toReaderLoc(detail))) {
          finish();
          return;
        }
        // Konum aynı kaldıysa imza değişmiş olabilir (yeni bölüm/sayfa).
        if (getRendererSignature(view) !== previousSignature) {
          finish();
        }
      };

      view.addEventListener("relocate", handleRelocated);
      timeoutId = window.setTimeout(finish, MANUAL_PAGE_TURN_TIMEOUT_MS);
      // Readest: sayfa çevirme viewPagination üzerinden yapılır.
      const navigation =
        viewPagination(
          view as unknown as Parameters<typeof viewPagination>[0],
          (direction === "previous" ? "left" : "right") as PaginationSide,
          "page",
          { rtl: view.book?.dir === "rtl", zoomLevel: 100, zoomMode: "fit-page" }
        ) ?? Promise.resolve();
      navigation
        .then(() => {
          if (hasNavigationFinished(lastLocationRef.current)) {
            finish();
            return;
          }
          if (getRendererSignature(view) !== previousSignature) {
            finish();
          }
        })
        .catch(() => {
          // Motor bu çevirmeyi reddettiyse (ör. bölüm yüklenemedi) kilitli
          // kalıp donmamak için turu başarısız sayıp kuyruğu boşalt.
          fail(new Error("Page turn was rejected by the renderer."));
        });
    });
  }

  function navigateManually(direction: "previous" | "next"): void {
    resetSpeechForManualPageChange();
    const view = viewRef.current;
    if (!view || !lastLocationRef.current) {
      return;
    }

    if (manualPageNavigationInFlightRef.current) {
      if (pageNavigationOriginRef.current !== "speech" || direction === "previous") {
        pendingManualPageDirectionRef.current = direction;
        pendingManualTurnsRef.current += direction === "next" ? 1 : -1;
      }
      return;
    }

    const generation = manualPageNavigationGenerationRef.current;
    manualPageNavigationInFlightRef.current = true;
    pageNavigationOriginRef.current = "manual";
    void moveManualPageAndWaitForRelocation(view, direction)
      .catch((error) => {
        console.error("EPUB page navigation failed.", error);
      })
      .finally(() => {
        finishPageNavigation(view, generation);
      });
  }

  const goToPreviousPage = () => navigateManually("previous");
  const goToNextPage = () => navigateManually("next");

  function clearPageHoldNavigation(): void {
    if (pageHoldTimerRef.current != null) {
      window.clearTimeout(pageHoldTimerRef.current);
      pageHoldTimerRef.current = null;
    }

    if (pageHoldIntervalRef.current != null) {
      window.clearInterval(pageHoldIntervalRef.current);
      pageHoldIntervalRef.current = null;
    }
  }

  function startPageHoldNavigation(direction: "previous" | "next"): void {
    clearPageHoldNavigation();
    pageHoldDidRepeatRef.current = false;
    pageHoldTimerRef.current = window.setTimeout(() => {
      pageHoldDidRepeatRef.current = true;
      const turnPage = direction === "previous" ? goToPreviousPage : goToNextPage;
      turnPage();
      pageHoldIntervalRef.current = window.setInterval(turnPage, 90);
    }, 260);
  }

  function finishPageHoldNavigation(): void {
    clearPageHoldNavigation();
  }

  function clickPageZone(direction: "previous" | "next"): void {
    if (pageHoldDidRepeatRef.current) {
      pageHoldDidRepeatRef.current = false;
      return;
    }

    if (direction === "previous") {
      goToPreviousPage();
      return;
    }

    goToNextPage();
  }

  const goToProgress = (nextProgress: number) => {
    const view = viewRef.current;
    if (!view || readerStatus !== "ready") {
      return;
    }

    const clampedProgress = Math.min(100, Math.max(0, nextProgress));
    resetSpeechForManualPageChange();
    void view.goToFraction(clampedProgress / 100).catch((error) => {
      console.error("EPUB progress navigation failed.", error);
    });
  };

  const updateViewSettings = (patch: Partial<ViewSettings>) => {
    resetSpeechForManualPageChange();
    setSettings((currentSettings) => ({
      ...currentSettings,
      viewSettings: { ...currentSettings.viewSettings, ...patch }
    }));
  };

  const updateFontSize = (delta: number) => {
    updateViewSettings({
      defaultFontSize: Math.min(
        36,
        Math.max(
          10,
          Math.round((settings.viewSettings.defaultFontSize + delta / 10) * 10) / 10
        )
      )
    });
  };

  const formatFontSize = (px: number) => `${Number.isInteger(px) ? px : px.toFixed(1)}px`;

  const toggleTheme = () => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      theme: currentSettings.theme === "light" ? "dark" : "light"
    }));
  };

  const updateThemeName = (themeName: string) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      themeName
    }));
  };

  const updateSpeechLanguage = (language: string) => {
    speechLanguageRef.current = language;
    const deepgramModel =
      speechProviderRef.current === "deepgram" ? getDefaultDeepgramModel(language) : deepgramModelRef.current;
    deepgramModelRef.current = deepgramModel;
    if (isWebSpeechSupported()) {
      speechVoiceRef.current = selectVoiceForLanguage(language, window.speechSynthesis.getVoices());
      void getSpeechVoices().then((voices) => {
        if (speechLanguageRef.current === language) {
          speechVoiceRef.current = selectVoiceForLanguage(language, voices);
        }
      });
    }
    setSettings((currentSettings) => ({
      ...currentSettings,
      speechLanguage: language,
      deepgramModel
    }));
    if (speechMode === "loading" || speechMode === "playing" || speechMode === "paused") {
      stopSpeech();
    }
  };

  const updateSpeechProvider = (provider: SpeechProvider) => {
    if (speechMode === "loading" || speechMode === "playing" || speechMode === "paused") {
      stopSpeech();
    }
    const currentLanguage = speechLanguageRef.current || DEFAULT_SPEECH_LANGUAGE;
    const language =
      provider === "piper" || provider === "ema"
        ? "tr-TR"
        : provider === "deepgram" && !isDeepgramLanguageSupported(currentLanguage)
          ? DEFAULT_SPEECH_LANGUAGE
          : currentLanguage;
    const deepgramModel = isDeepgramModelForLanguage(deepgramModelRef.current, language)
      ? deepgramModelRef.current
      : getDefaultDeepgramModel(language);
    speechProviderRef.current = provider;
    speechLanguageRef.current = language;
    deepgramModelRef.current = deepgramModel;
    setSpeechMode(isSpeechProviderSupported(provider) ? "idle" : "unsupported");
    setSettings((currentSettings) => ({
      ...currentSettings,
      speechProvider: provider,
      speechLanguage: language,
      deepgramModel
    }));
  };

  const updateDeepgramModel = (model: string) => {
    if (!isDeepgramModelForLanguage(model, speechLanguageRef.current)) {
      return;
    }
    deepgramModelRef.current = model;
    setSettings((currentSettings) => ({
      ...currentSettings,
      deepgramModel: model
    }));
    if (speechMode === "loading" || speechMode === "playing" || speechMode === "paused") {
      stopSpeech();
    }
  };

  const updatePiperVoice = (voice: string) => {
    if (!isPiperVoiceId(voice)) {
      return;
    }
    piperVoiceRef.current = voice;
    setSettings((currentSettings) => ({
      ...currentSettings,
      piperVoice: voice
    }));
    if (speechMode === "loading" || speechMode === "playing" || speechMode === "paused") {
      stopSpeech();
    }
  };

  const updateEmaVoice = (voice: string) => {
    if (!isEmaVoiceId(voice)) {
      return;
    }
    emaVoiceRef.current = voice;
    setSettings((currentSettings) => ({
      ...currentSettings,
      emaVoice: voice
    }));
    if (speechMode === "loading" || speechMode === "playing" || speechMode === "paused") {
      stopSpeech();
    }
  };

  const readerTitle = bookInfo?.title || activeBook?.title || "EPUB Reader";
  const readerAuthor = bookInfo?.author || activeBook?.author || "";
  const selectedSpeechProvider = settings.speechProvider || DEFAULT_SPEECH_PROVIDER;
  const selectedSpeechLanguage = settings.speechLanguage || DEFAULT_SPEECH_LANGUAGE;
  const selectedDeepgramModel = isDeepgramModelForLanguage(settings.deepgramModel || "", selectedSpeechLanguage)
    ? settings.deepgramModel || DEFAULT_DEEPGRAM_MODEL
    : getDefaultDeepgramModel(selectedSpeechLanguage);
  const speechLanguageOptions =
    selectedSpeechProvider === "piper"
      ? PIPER_LANGUAGE_OPTIONS
      : selectedSpeechProvider === "ema"
        ? EMA_LANGUAGE_OPTIONS
        : selectedSpeechProvider === "deepgram"
          ? DEEPGRAM_LANGUAGE_OPTIONS
          : WEB_SPEECH_LANGUAGE_OPTIONS;
  const selectedPiperVoice = isPiperVoiceId(settings.piperVoice || "")
    ? (settings.piperVoice as string)
    : DEFAULT_PIPER_VOICE;
  const selectedEmaVoice = isEmaVoiceId(settings.emaVoice || "")
    ? (settings.emaVoice as string)
    : DEFAULT_EMA_VOICE;
  const deepgramModelOptions = getDeepgramModelOptions(selectedSpeechLanguage);
  const currentProgress = areLocationsReady
    ? progress?.percentage ??
      (activeBook?.position?.isPrecise && activeBook.position.progressMethod === PROGRESS_METHOD
        ? activeBook.position.percentage
        : null)
    : null;
  const formattedProgress = formatProgress(currentProgress);
  const pageLabel =
    progress?.page && progress.totalPages
      ? `${progress.page}/${progress.totalPages}`
      : progress?.page
        ? `${progress.page}`
        : "0/0";
  const sliderValue = Math.round((currentProgress ?? 0) * 10);
  const isSpeechActive = speechMode === "playing";
  const isSpeechLoading = speechMode === "loading";
  const speechButtonTitle =
    speechMode === "unsupported"
      ? `${getSpeechProviderLabel(selectedSpeechProvider)} is not supported in this browser`
      : speechMode === "error"
        ? `Read aloud failed (${selectedSpeechProvider}, ${selectedSpeechLanguage})`
      : speechMode === "loading"
        ? `Loading speech (${selectedSpeechProvider}, ${selectedSpeechLanguage})`
        : speechMode === "playing"
          ? `${selectedSpeechProvider === "web-speech" ? "Pause" : "Stop"} read aloud (${selectedSpeechProvider}, ${selectedSpeechLanguage})`
          : `Read this page aloud (${selectedSpeechProvider}, ${selectedSpeechLanguage})`;
  const isSpeechButtonDisabled =
    !activeBook ||
    readerStatus !== "ready" ||
    !isSpeechProviderSupported(selectedSpeechProvider) ||
    speechMode === "unsupported";

  const themeName = settings.themeName || "default";
  const isDark = settings.theme !== "light";
  const filteredLibrary = library;

  useEffect(() => {
    document.title = formattedProgress ? `${formattedProgress} - ${readerTitle}` : readerTitle;
  }, [formattedProgress, readerTitle]);
  return (
    <div className="app">
      {isSidebarOpen && !isSidebarPinned && (
        <button
          type="button"
          className="sidebar-overlay"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}
      <aside
        aria-label="Sidebar"
        className={`sidebar${isSidebarOpen ? " open" : ""}${isSidebarPinned ? "" : " floating"}`}
      >
        <div className="sidebar-header" dir="ltr">
          <span className="sidebar-actions">
            <button
              type="button"
              title="Close sidebar"
              onClick={() => setIsSidebarOpen(false)}
              className="icon-btn mobile-only"
            >
              <X aria-hidden="true" size={19} />
            </button>
            <button
              type="button"
              title="Collapse sidebar"
              onClick={() => setIsSidebarOpen(false)}
              className="icon-btn desktop-only"
            >
              <PanelLeft aria-hidden="true" size={18} />
            </button>
          </span>
        </div>

        {activeBook && (
          <div className="current-book">
            <div className="current-book-row">
              <span className="current-book-icon">
                <BookMarked aria-hidden="true" size={17} />
              </span>
              <span className="current-book-meta">
                <span className="current-book-title">
                  {bookInfo?.title || activeBook.title || "Untitled EPUB"}
                </span>
                <span className="current-book-sub">
                  {bookInfo?.author || activeBook.author || getBookDescription(activeBook)}
                </span>
              </span>
              {formattedProgress && <span className="progress-pill">{formattedProgress}</span>}
            </div>
          </div>
        )}

        <div className="sidebar-scroll">
          <section className="panel" aria-label="Library">
            <div className="boxed-list">
              <div className="boxed-list-rows">
                {filteredLibrary.length === 0 && (
                  <div className="empty-note">No saved books yet.</div>
                )}
                {filteredLibrary.map((book) => {
                  const bookProgress =
                    book.id === activeBookId
                      ? areLocationsReady
                        ? progress?.percentage ??
                          (book.position?.isPrecise && book.position.progressMethod === PROGRESS_METHOD
                            ? book.position.percentage
                            : null)
                        : null
                      : book.position?.isPrecise && book.position.progressMethod === PROGRESS_METHOD
                        ? book.position.percentage
                        : null;
                  return (
                    <div key={book.id} className={`book-row${book.id === activeBookId ? " active" : ""}`}>
                      <button type="button" onClick={() => openBook(book.id)} className="book-open">
                        <span className="book-open-title">{book.title || "Untitled EPUB"}</span>
                        <span className="book-open-sub">{book.author || getBookDescription(book)}</span>
                        {formatProgress(bookProgress) && (
                          <span className="book-open-progress">{formatProgress(bookProgress)} read</span>
                        )}
                      </button>
                      <span className="book-row-side">
                        <ChevronRight aria-hidden="true" size={16} />
                        <button
                          type="button"
                          onClick={() => removeBook(book.id)}
                          title="Remove book"
                          aria-label={`Remove ${book.title || "book"}`}
                          className="mini-btn danger"
                        >
                          <Trash2 aria-hidden="true" size={16} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <button type="button" onClick={openAddDialog} className="list-extension">
              <span className="list-extension-chip">
                <Plus aria-hidden="true" size={14} />
              </span>
              <span className="list-extension-label">Add EPUB</span>
            </button>
          </section>

          <section className="panel" aria-label="Read aloud">
            <h2 className="panel-title">Read aloud</h2>
            <div className="boxed-list">
              <div className="boxed-list-rows">
                <div className="setting-row">
                  <span className="row-label">Provider</span>
                  <select
                    value={selectedSpeechProvider}
                    onChange={(event) => updateSpeechProvider(event.currentTarget.value as SpeechProvider)}
                    className="chrome-select"
                    aria-label="Read aloud provider"
                  >
                    {SPEECH_PROVIDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="setting-row">
                  <span className="row-label">Language</span>
                  <select
                    value={selectedSpeechLanguage}
                    onChange={(event) => updateSpeechLanguage(event.currentTarget.value)}
                    className="chrome-select"
                    aria-label="Read aloud language"
                  >
                    {speechLanguageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedSpeechProvider === "ema" && (
                  <div className="setting-row">
                    <span className="row-label">Voice</span>
                    <select
                      value={selectedEmaVoice}
                      onChange={(event) => updateEmaVoice(event.currentTarget.value)}
                      className="chrome-select"
                      aria-label="Ema voice"
                    >
                      {EMA_VOICE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {selectedSpeechProvider === "piper" && (
                  <div className="setting-row">
                    <span className="row-label">Voice</span>
                    <select
                      value={selectedPiperVoice}
                      onChange={(event) => updatePiperVoice(event.currentTarget.value)}
                      className="chrome-select"
                      aria-label="Piper voice"
                    >
                      {PIPER_VOICE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {selectedSpeechProvider === "deepgram" && (
                  <div className="setting-row">
                    <span className="row-label">Voice</span>
                    <select
                      value={selectedDeepgramModel}
                      onChange={(event) => updateDeepgramModel(event.currentTarget.value)}
                      className="chrome-select"
                      aria-label="Deepgram voice model"
                    >
                      {deepgramModelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </section>

<section className="panel" aria-label="Appearance">
            <h2 className="panel-title">Appearance</h2>
            <div className="boxed-list">
              <div className="boxed-list-rows">
                <div className="setting-row">
                  <span className="row-label">Color theme</span>
                  <select
                    value={themeName}
                    onChange={(event) => updateThemeName(event.currentTarget.value)}
                    className="chrome-select"
                    aria-label="Color theme"
                  >
                    {THEME_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="setting-row">
                  <span className="row-label">Dark mode</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={isDark}
                    onChange={toggleTheme}
                    aria-label="Dark mode"
                  />
                </label>
                <div className="setting-row">
                  <span className="row-label">Font size</span>
                  <span className="row-control">
                    <button
                      type="button"
                      onClick={() => updateFontSize(-5)}
                      title="Smaller text"
                      className="icon-btn"
                    >
                      <Minus aria-hidden="true" size={15} />
                    </button>
                    <span className="font-value">{formatFontSize(settings.viewSettings.defaultFontSize)}</span>
                    <button
                      type="button"
                      onClick={() => updateFontSize(5)}
                      title="Larger text"
                      className="icon-btn"
                    >
                      <Plus aria-hidden="true" size={15} />
                    </button>
                  </span>
                </div>
                <div className="setting-row">
                  <span className="row-label">Font</span>
                  <select
                    value={settings.viewSettings.defaultFont}
                    onChange={(event) =>
                      updateViewSettings({ defaultFont: event.currentTarget.value as DefaultFont })
                    }
                    className="chrome-select"
                    aria-label="Font"
                  >
                    <option value="Serif">Serif</option>
                    <option value="Sans-serif">Sans</option>
                  </select>
                </div>
                <div className="setting-row">
                  <span className="row-label">Line height</span>
                  <select
                    value={String(settings.viewSettings.lineHeight)}
                    onChange={(event) =>
                      updateViewSettings({ lineHeight: Number(event.currentTarget.value) })
                    }
                    className="chrome-select"
                    aria-label="Line height"
                  >
                    <option value="1.2">Tight</option>
                    <option value="1.4">Normal</option>
                    <option value="1.6">Relaxed</option>
                    <option value="1.8">Loose</option>
                  </select>
                </div>
                <div className="setting-row">
                  <span className="row-label">Columns</span>
                  <select
                    value={String(settings.viewSettings.maxColumnCount)}
                    onChange={(event) =>
                      updateViewSettings({ maxColumnCount: Number(event.currentTarget.value) })
                    }
                    className="chrome-select"
                    aria-label="Columns"
                  >
                    <option value="1">Single</option>
                    <option value="2">Two-page</option>
                  </select>
                </div>
                <div className="setting-row">
                  <span className="row-label">Side margin</span>
                  <select
                    value={String(settings.viewSettings.marginLeftPx)}
                    onChange={(event) =>
                      updateViewSettings({
                        marginLeftPx: Number(event.currentTarget.value),
                        marginRightPx: Number(event.currentTarget.value)
                      })
                    }
                    className="chrome-select"
                    aria-label="Side margin"
                  >
                    <option value="8">Narrow</option>
                    <option value="16">Normal</option>
                    <option value="32">Wide</option>
                  </select>
                </div>
                <label className="setting-row">
                  <span className="row-label">Page turn animation</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.viewSettings.animated}
                    onChange={(event) =>
                      updateViewSettings({ animated: event.currentTarget.checked })
                    }
                    aria-label="Page turn animation"
                  />
                </label>
                <label className="setting-row">
                  <span className="row-label">Justify text</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.viewSettings.fullJustification}
                    onChange={(event) =>
                      updateViewSettings({ fullJustification: event.currentTarget.checked })
                    }
                    aria-label="Justify text"
                  />
                </label>
                <label className="setting-row">
                  <span className="row-label">Hyphenation</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.viewSettings.hyphenation}
                    onChange={(event) =>
                      updateViewSettings({ hyphenation: event.currentTarget.checked })
                    }
                    aria-label="Hyphenation"
                  />
                </label>
              </div>
            </div>
          </section>
        </div>
      </aside>

      <div className="main-col">
        <div role="banner" aria-label="Header Bar" className="header-bar">
          <div className="header-start">
            {!isSidebarOpen && (
              <button
                type="button"
                title="Open sidebar"
                onClick={showSidebar}
                className="icon-btn"
              >
                <PanelLeft aria-hidden="true" size={18} />
              </button>
            )}
            <button
              type="button"
              title={speechButtonTitle}
              aria-label={speechButtonTitle}
              onClick={() => void toggleSpeech()}
              disabled={isSpeechButtonDisabled}
              className={`icon-btn${isSpeechActive ? " active" : ""}`}
            >
              {isSpeechLoading ? (
                <LoaderCircle aria-hidden="true" size={18} className="spin" />
              ) : speechMode === "playing" ? (
                <Pause aria-hidden="true" size={18} />
              ) : (
                <Play aria-hidden="true" size={18} />
              )}
            </button>
          </div>

          <div role="contentinfo" aria-label={`Title - ${readerTitle}`} className="header-title">
            <span aria-hidden="true">{readerTitle}</span>
          </div>

          <div className="header-end">
            <span className="page-label">{pageLabel}</span>
          </div>
        </div>

        {speechError && (
          <div className="toast-error" role="alert">
            {speechError}
          </div>
        )}

        <section className="reader-shell" aria-label="Book reader">
          {!activeBook && (
            <div className="empty-state">
              <BookOpen aria-hidden="true" size={44} />
              <h2>No EPUB selected</h2>
              <p>Add a book from the sidebar, upload an EPUB file, or open this page with an epub query string.</p>
              <code>?epub=https://example.com/book.epub</code>
              <button type="button" className="cta-button" onClick={openAddDialog}>
                Add EPUB
              </button>
            </div>
          )}
          {readerStatus === "loading" && activeBook && <div className="loading-state">Opening EPUB...</div>}
          {readerError && <div className="error-state">{readerError}</div>}
          <div ref={viewerRef} className="viewer" />

          {activeBook && (
            <button
              type="button"
              className="page-zone left"
              onClick={() => clickPageZone("previous")}
              onPointerDown={() => startPageHoldNavigation("previous")}
              onPointerUp={finishPageHoldNavigation}
              onPointerCancel={finishPageHoldNavigation}
              onPointerLeave={finishPageHoldNavigation}
              aria-label="Previous page"
            />
          )}
          {activeBook && (
            <button
              type="button"
              className="page-zone right"
              onClick={() => clickPageZone("next")}
              onPointerDown={() => startPageHoldNavigation("next")}
              onPointerUp={finishPageHoldNavigation}
              onPointerCancel={finishPageHoldNavigation}
              onPointerLeave={finishPageHoldNavigation}
              aria-label="Next page"
            />
          )}
        </section>

        <div className="footer-bar" aria-label="Reading progress">
          <span className="page-label" style={{ display: "inline" }}>{pageLabel}</span>
          {pageCountProgress && (
            <span className="page-counting" aria-live="polite">
              counting {pageCountProgress.done}/{pageCountProgress.total}
            </span>
          )}
          <input
            className="progress-range"
            type="range"
            min="0"
            max="1000"
            step="1"
            value={sliderValue}
            onChange={(event) => goToProgress(Number(event.currentTarget.value) / 10)}
            disabled={!activeBook || readerStatus !== "ready" || !areLocationsReady}
            aria-label="Reading progress"
          />
          {formattedProgress && <span className="progress-pill">{formattedProgress}</span>}
        </div>

        <div ref={deepgramCacheContainerRef} className="cache-viewer" aria-hidden="true" />
        <div ref={pageCounterContainerRef} className="page-counter-viewer" aria-hidden="true" />
      </div>

      {isAddOpen && (
        <div className="modal-layer" role="presentation">
          <form className="modal-box" onSubmit={addBookFromInput}>
            <div className="modal-header">
              <h2>Add EPUB</h2>
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => setIsAddOpen(false)}
                title="Close add dialog"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="modal-body">
              <h3>Add a book to your library</h3>
              <p className="muted">Paste an EPUB link or upload a file from your device.</p>
              {addDialogError && (
                <div className="dialog-error" role="alert">
                  {addDialogError}
                </div>
              )}
              <label className="field-label" htmlFor="book-url">EPUB URL</label>
              <input
                id="book-url"
                className="text-input"
                type="url"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://example.com/book.epub"
                autoFocus
                required
              />
              <button type="submit" className="contrast-button">
                Add and open
              </button>
              <div className="dialog-divider" aria-hidden="true">
                or
              </div>
              <label className={`upload-label${isUploadingBook ? " disabled" : ""}`} htmlFor="book-file">
                {isUploadingBook ? (
                  <LoaderCircle aria-hidden="true" size={18} className="spin" />
                ) : (
                  <Upload aria-hidden="true" size={18} />
                )}
                <span>{isUploadingBook ? "Saving EPUB..." : "Upload EPUB file"}</span>
              </label>
              <input
                ref={fileInputRef}
                id="book-file"
                className="file-input"
                type="file"
                accept=".epub,application/epub+zip"
                onChange={(event) => void addBookFromFile(event)}
                disabled={isUploadingBook}
              />
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found.");
}

createRoot(rootElement).render(<App />);
