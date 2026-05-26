import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import ePub from "epubjs";
import type Book from "epubjs/types/book";
import type Contents from "epubjs/types/contents";
import type { Location } from "epubjs/types/rendition";
import type Rendition from "epubjs/types/rendition";
import {
  BookOpen,
  Library,
  Menu,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  Sun,
  Trash2,
  X
} from "lucide-react";
import "./styles.css";

const LIBRARY_KEY = "epub-reader:library:v1";
const SETTINGS_KEY = "epub-reader:settings:v1";
const MAX_SPEECH_CHUNK_LENGTH = 900;
const DEFAULT_SPEECH_LANGUAGE = "en-US";
const SPEECH_LANGUAGE_OPTIONS = [
  { value: "en-US", label: "English" },
  { value: "tr-TR", label: "Turkish" },
  { value: "de-DE", label: "German" },
  { value: "fr-FR", label: "French" },
  { value: "es-ES", label: "Spanish" },
  { value: "it-IT", label: "Italian" },
  { value: "ru-RU", label: "Russian" },
  { value: "ar-SA", label: "Arabic" }
] as const;

const defaultSettings: ReaderSettings = {
  fontSize: 100,
  theme: "dark",
  speechLanguage: DEFAULT_SPEECH_LANGUAGE
};

const PROGRESS_METHOD = "displayed-pages-v1";

const readerThemeColors = {
  light: {
    background: "#faf8f2",
    text: "#191815",
    link: "#7b3f1d"
  },
  dark: {
    background: "#16181b",
    text: "#ece7dd",
    link: "#d8a465"
  }
} as const;

type Theme = keyof typeof readerThemeColors;

type ReaderStatus = "idle" | "loading" | "ready" | "error";
type SpeechMode = "idle" | "playing" | "paused" | "unsupported" | "error";

interface ReaderSettings {
  fontSize: number;
  theme: Theme;
  speechLanguage?: string;
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

interface RuntimeSpine {
  length?: number;
}

interface VisibleSpeechSnapshot {
  text: string;
  languageHint: string;
  pageKey: string;
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
  const rawUrl = params.get("url") || params.get("book") || params.get("epub") || "";

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
    title: "",
    author: "",
    addedAt: now,
    updatedAt: now,
    position: null
  };
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

function getDisplayedPagePercentage(book: Book, location: Location): number | null {
  const start = location?.start;
  const spineLength = Number((book.spine as RuntimeSpine).length || 0);
  const sectionIndex = Number(start?.index);
  const page = Number(start?.displayed?.page || 1);
  const totalPages = Number(start?.displayed?.total || 1);

  if (!spineLength || Number.isNaN(sectionIndex)) {
    return null;
  }

  if (location?.atEnd) {
    return 100;
  }

  const sectionProgress = totalPages > 0 ? (Math.max(page, 1) - 1) / totalPages : 0;
  return toDisplayPercentage(((sectionIndex + sectionProgress) / spineLength) * 100);
}

function getReadingPercentage(book: Book, location: Location): number | null {
  const cfi = location?.start?.cfi;
  const generatedLocationCount = book.locations?.length?.() || 0;

  if (cfi && generatedLocationCount > 0) {
    return toDisplayPercentage(book.locations.percentageFromCfi(cfi) * 100);
  }

  return getDisplayedPagePercentage(book, location);
}

function getReadingPageInfo(
  book: Book,
  location: Location,
  percentage: number | null
): { page: number | null; totalPages: number | null } {
  const generatedLocationCount = book.locations?.length?.() || 0;

  if (generatedLocationCount > 0) {
    if (location?.atEnd) {
      return { page: generatedLocationCount, totalPages: generatedLocationCount };
    }

    const normalizedPercentage = Math.min(100, Math.max(0, percentage ?? 0));
    const page = Math.floor((normalizedPercentage / 100) * generatedLocationCount) + 1;
    return { page: Math.min(generatedLocationCount, Math.max(1, page)), totalPages: generatedLocationCount };
  }

  return {
    page: location?.start?.displayed?.page || null,
    totalPages: location?.start?.displayed?.total || null
  };
}

function applyContentStyles(contents: Contents, settings: ReaderSettings): void {
  const colors = readerThemeColors[settings.theme] || readerThemeColors.light;
  const documentElement = contents.document?.documentElement;
  const body = contents.document?.body;
  const preventDefault = (event: Event) => event.preventDefault();

  contents.css("font-size", `${settings.fontSize}%`, true);
  contents.css("font-family", "Georgia, Cambria, 'Times New Roman', serif", true);
  contents.css("line-height", "1.65", true);
  contents.css("color", colors.text, true);
  contents.css("background", colors.background, true);
  contents.css("background-color", colors.background, true);
  contents.css("user-select", "none", true);
  contents.css("-webkit-user-select", "none", true);
  contents.css("-webkit-touch-callout", "none", true);

  if (documentElement) {
    documentElement.style.setProperty("background", colors.background, "important");
    documentElement.style.setProperty("color", colors.text, "important");
    documentElement.style.setProperty("user-select", "none", "important");
    documentElement.style.setProperty("-webkit-user-select", "none", "important");
    documentElement.style.setProperty("-webkit-touch-callout", "none", "important");
  }

  if (body) {
    body.style.setProperty("background", colors.background, "important");
    body.style.setProperty("color", colors.text, "important");
    body.style.setProperty("user-select", "none", "important");
    body.style.setProperty("-webkit-user-select", "none", "important");
    body.style.setProperty("-webkit-touch-callout", "none", "important");
  }

  contents.document?.querySelectorAll?.("a").forEach((link) => {
    link.style.setProperty("color", colors.link, "important");
  });

  if (contents.document?.documentElement && !contents.document.documentElement.dataset.readerInputGuards) {
    contents.document.documentElement.dataset.readerInputGuards = "true";
    contents.document.addEventListener("selectstart", preventDefault);
    contents.document.addEventListener("gesturestart", preventDefault);
    contents.document.addEventListener("gesturechange", preventDefault);
    contents.window?.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey) {
          event.preventDefault();
        }
      },
      { passive: false }
    );
  }
}

function getRenditionContents(rendition: Rendition): Contents[] {
  const contents = rendition.getContents() as Contents | Contents[];
  return Array.isArray(contents) ? contents : [contents];
}

function applyReaderPreferences(rendition: Rendition | null, settings: ReaderSettings): void {
  if (!rendition) {
    return;
  }

  rendition.themes.fontSize(`${settings.fontSize}%`);
  rendition.themes.select(settings.theme);
  getRenditionContents(rendition).forEach((contents) => applyContentStyles(contents, settings));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isSpeechSupported(): boolean {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
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

function isTextNodeInViewport(node: Text, document: Document): boolean {
  const view = document.defaultView;
  if (!view) {
    return false;
  }

  const viewportWidth = view.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = view.innerHeight || document.documentElement.clientHeight;
  const range = document.createRange();

  try {
    range.selectNodeContents(node);
    return Array.from(range.getClientRects()).some(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < viewportWidth &&
        rect.top < viewportHeight
    );
  } finally {
    range.detach();
  }
}

function extractVisibleSpeechText(document: Document): { text: string; languageHint: string } {
  const body = document.body;
  if (!body) {
    return { text: "", languageHint: normalizeLanguageTag(document.documentElement.lang) };
  }

  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!isReadableTextNode(node) || !isTextNodeInViewport(node as Text, document)) {
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

function getElementFromNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function extractLocationSpeechText(rendition: Rendition, location: Location | null): { text: string; languageHint: string } {
  const startCfi = location?.start?.cfi;
  const endCfi = location?.end?.cfi;
  if (!startCfi || !endCfi) {
    return { text: "", languageHint: "" };
  }

  try {
    const startRange = rendition.getRange(startCfi);
    const endRange = rendition.getRange(endCfi);
    const startDocument = startRange.startContainer.ownerDocument;
    const endDocument = endRange.endContainer.ownerDocument;

    if (!startDocument || startDocument !== endDocument) {
      return { text: "", languageHint: "" };
    }

    const pageRange = startDocument.createRange();
    try {
      pageRange.setStart(startRange.startContainer, startRange.startOffset);
      pageRange.setEnd(endRange.endContainer, endRange.endOffset);
    } catch {
      pageRange.detach();
      return { text: "", languageHint: "" };
    }

    const languageHint = getLanguageHintFromElement(getElementFromNode(pageRange.commonAncestorContainer));
    const text = normalizeWhitespace(pageRange.cloneContents().textContent || "");
    pageRange.detach();

    return { text, languageHint };
  } catch {
    return { text: "", languageHint: "" };
  }
}

function getLocationSpeechKey(location: Location | null): string {
  const start = location?.start;
  if (!start) {
    return "";
  }

  return [start.href || "", start.displayed?.page || "", start.displayed?.total || "", start.cfi || ""].join(":");
}

function createVisibleSpeechSnapshot(rendition: Rendition, location: Location | null): VisibleSpeechSnapshot {
  if (location) {
    const locationText = extractLocationSpeechText(rendition, location);
    return {
      text: locationText.text,
      languageHint: locationText.languageHint,
      pageKey: getLocationSpeechKey(location)
    };
  }

  const sections = getRenditionContents(rendition).map((contents) => extractVisibleSpeechText(contents.document));
  const languageHint = sections.find((section) => section.languageHint)?.languageHint || "";

  return {
    text: normalizeWhitespace(sections.map((section) => section.text).filter(Boolean).join("\n\n")),
    languageHint,
    pageKey: getLocationSpeechKey(location)
  };
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

function splitSpeechText(text: string): string[] {
  const sentences = normalizeWhitespace(text).match(/[^.!?\u3002\uff01\uff1f]+[.!?\u3002\uff01\uff1f]?/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";

  sentences.forEach((sentence) => {
    const normalizedSentence = normalizeWhitespace(sentence);
    if (!normalizedSentence) {
      return;
    }

    if (`${currentChunk} ${normalizedSentence}`.trim().length <= MAX_SPEECH_CHUNK_LENGTH) {
      currentChunk = `${currentChunk} ${normalizedSentence}`.trim();
      return;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    if (normalizedSentence.length <= MAX_SPEECH_CHUNK_LENGTH) {
      currentChunk = normalizedSentence;
      return;
    }

    for (let index = 0; index < normalizedSentence.length; index += MAX_SPEECH_CHUNK_LENGTH) {
      chunks.push(normalizedSentence.slice(index, index + MAX_SPEECH_CHUNK_LENGTH));
    }
    currentChunk = "";
  });

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function usePersistentState<T>(key: string, fallback: T): PersistentState<T> {
  const [value, setValue] = useState(() => readJson(key, fallback));

  useEffect(() => {
    writeJson(key, value);
  }, [key, value]);

  return [value, setValue];
}

function App() {
  const queryBookUrl = useMemo(() => getQueryBookUrl(), []);
  const [library, setLibrary] = usePersistentState<LibraryBook[]>(LIBRARY_KEY, []);
  const [settings, setSettings] = usePersistentState<ReaderSettings>(SETTINGS_KEY, defaultSettings);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [isToolbarOpen, setIsToolbarOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(!queryBookUrl);
  const [urlInput, setUrlInput] = useState("");
  const [readerError, setReaderError] = useState("");
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>("idle");
  const [speechMode, setSpeechMode] = useState<SpeechMode>(() => (isSpeechSupported() ? "idle" : "unsupported"));
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [areLocationsReady, setAreLocationsReady] = useState(false);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const activeBookRef = useRef<LibraryBook | null>(null);
  const settingsRef = useRef(settings);
  const queryBookHandledRef = useRef(false);
  const lastLocationRef = useRef<Location | null>(null);
  const speechChunksRef = useRef<string[]>([]);
  const speechChunkIndexRef = useRef(0);
  const speechLanguageRef = useRef(settings.speechLanguage || DEFAULT_SPEECH_LANGUAGE);
  const speechVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const speechPageKeyRef = useRef("");
  const speechShouldContinueRef = useRef(false);
  const speechTokenRef = useRef(0);
  const speechPageAdvanceTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<ScreenWakeLockSentinel | null>(null);
  const pageHoldTimerRef = useRef<number | null>(null);
  const pageHoldIntervalRef = useRef<number | null>(null);
  const pageHoldDidRepeatRef = useRef(false);

  const activeBook = useMemo(
    () => library.find((book) => book.id === activeBookId) || null,
    [activeBookId, library]
  );

  useEffect(() => {
    activeBookRef.current = activeBook;
  }, [activeBook]);

  useEffect(() => {
    settingsRef.current = settings;
    const nextLanguage = settings.speechLanguage || DEFAULT_SPEECH_LANGUAGE;
    speechLanguageRef.current = nextLanguage;
    if (isSpeechSupported()) {
      speechVoiceRef.current = selectVoiceForLanguage(nextLanguage, window.speechSynthesis.getVoices());
      void getSpeechVoices().then((voices) => {
        if (speechLanguageRef.current === nextLanguage) {
          speechVoiceRef.current = selectVoiceForLanguage(nextLanguage, voices);
        }
      });
    }
  }, [settings]);

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

  function clearSpeechPageAdvanceTimer(): void {
    if (speechPageAdvanceTimerRef.current == null) {
      return;
    }

    window.clearTimeout(speechPageAdvanceTimerRef.current);
    speechPageAdvanceTimerRef.current = null;
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

  function stopSpeech(nextMode: SpeechMode = isSpeechSupported() ? "idle" : "unsupported"): void {
    speechTokenRef.current += 1;
    speechShouldContinueRef.current = false;
    speechChunksRef.current = [];
    speechChunkIndexRef.current = 0;
    speechPageKeyRef.current = "";
    clearSpeechPageAdvanceTimer();

    if (isSpeechSupported()) {
      window.speechSynthesis.cancel();
    }

    void releaseSpeechWakeLock();
    setSpeechMode(nextMode);
  }

  function resetSpeechForManualPageChange(): void {
    if (
      speechMode === "idle" &&
      speechChunksRef.current.length === 0 &&
      !speechShouldContinueRef.current &&
      !window.speechSynthesis?.speaking &&
      !window.speechSynthesis?.paused
    ) {
      return;
    }

    stopSpeech();
  }

  function getCurrentSpeechLocation(): Location | null {
    return lastLocationRef.current || renditionRef.current?.location || null;
  }

  function speakSpeechChunks(startIndex = 0): void {
    if (!isSpeechSupported()) {
      setSpeechMode("unsupported");
      return;
    }

    const chunks = speechChunksRef.current;
    if (chunks.length === 0) {
      setSpeechMode("error");
      return;
    }

    const token = speechTokenRef.current + 1;
    speechTokenRef.current = token;
    speechChunkIndexRef.current = startIndex;
    clearSpeechPageAdvanceTimer();
    void requestSpeechWakeLock();

    const speakAt = (index: number) => {
      if (token !== speechTokenRef.current || !speechShouldContinueRef.current) {
        return;
      }

      if (index >= chunks.length) {
        const rendition = renditionRef.current;
        const currentLocation = getCurrentSpeechLocation();
        if (!rendition || currentLocation?.atEnd) {
          stopSpeech("idle");
          return;
        }

        rendition.next().then(() => {
          if (token !== speechTokenRef.current || !speechShouldContinueRef.current || window.speechSynthesis.paused) {
            return;
          }

          speechPageAdvanceTimerRef.current = window.setTimeout(() => {
            if (token === speechTokenRef.current && speechShouldContinueRef.current && !window.speechSynthesis.paused) {
              startSpeechForCurrentPage();
            }
          }, 180);
        });
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = speechLanguageRef.current || DEFAULT_SPEECH_LANGUAGE;
      if (speechVoiceRef.current) {
        utterance.voice = speechVoiceRef.current;
      }

      utterance.onend = () => {
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current || window.speechSynthesis.paused) {
          return;
        }

        speechChunkIndexRef.current = index + 1;
        speakAt(index + 1);
      };

      utterance.onerror = (event) => {
        if (token !== speechTokenRef.current || event.error === "interrupted" || event.error === "canceled") {
          return;
        }

        stopSpeech("error");
      };

      setSpeechMode("playing");
      window.speechSynthesis.speak(utterance);
    };

    window.speechSynthesis.cancel();
    speakAt(startIndex);
  }

  function startSpeechForCurrentPage(): void {
    const rendition = renditionRef.current;
    if (!rendition) {
      stopSpeech("idle");
      return;
    }

    const currentLocation = getCurrentSpeechLocation();
    const snapshot = createVisibleSpeechSnapshot(rendition, currentLocation);
    if (!snapshot.text) {
      if (currentLocation?.atEnd) {
        stopSpeech("idle");
        return;
      }

      rendition.next().then(() => {
        if (speechShouldContinueRef.current && !window.speechSynthesis.paused) {
          startSpeechForCurrentPage();
        }
      });
      return;
    }

    speechChunksRef.current = splitSpeechText(snapshot.text);
    speechChunkIndexRef.current = 0;
    speechPageKeyRef.current = snapshot.pageKey;
    speakSpeechChunks(0);
  }

  async function toggleSpeech(): Promise<void> {
    if (!isSpeechSupported()) {
      setSpeechMode("unsupported");
      return;
    }

    if (speechMode === "playing") {
      window.speechSynthesis.pause();
      setSpeechMode("paused");
      void releaseSpeechWakeLock();
      return;
    }

    if (speechMode === "paused") {
      speechShouldContinueRef.current = true;
      window.speechSynthesis.resume();
      window.speechSynthesis.cancel();
      speechChunksRef.current = [];
      speechChunkIndexRef.current = 0;
      speechPageKeyRef.current = "";

      if (speechLanguageRef.current) {
        setSpeechMode("playing");
        startSpeechForCurrentPage();
        void requestSpeechWakeLock();
        return;
      }
    }

    const activeBookForSpeech = activeBookRef.current;
    const rendition = renditionRef.current;
    if (!activeBookForSpeech || !rendition || readerStatus !== "ready") {
      return;
    }

    setSpeechMode("playing");
    speechShouldContinueRef.current = true;

    const currentLocation = getCurrentSpeechLocation();
    const currentSnapshot = createVisibleSpeechSnapshot(rendition, currentLocation);
    if (!currentSnapshot.text) {
      stopSpeech("error");
      return;
    }

    const initialLanguage = speechLanguageRef.current || DEFAULT_SPEECH_LANGUAGE;
    const currentPageKey = currentSnapshot.pageKey;

    speechLanguageRef.current = initialLanguage;
    speechVoiceRef.current = selectVoiceForLanguage(initialLanguage, window.speechSynthesis.getVoices());
    speechChunksRef.current = splitSpeechText(currentSnapshot.text);
    speechChunkIndexRef.current = 0;
    speechPageKeyRef.current = currentPageKey;
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

      return [createBook(normalizedUrl), ...currentLibrary];
    });

    if (openBook) {
      setActiveBookId(existingId);
      setIsAddOpen(false);
      setIsLibraryOpen(false);
    }

    return existingId;
  }, [setLibrary]);

  useEffect(() => {
    if (queryBookUrl && !queryBookHandledRef.current) {
      queryBookHandledRef.current = true;
      try {
        upsertBook(queryBookUrl, true);
      } catch {
        setReaderError("The URL query parameter is not a valid EPUB URL.");
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
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }

    applyReaderPreferences(rendition, settings);
  }, [settings]);

  useEffect(() => {
    if (!activeBook || !viewerRef.current) {
      return undefined;
    }

    let cancelled = false;
    const container = viewerRef.current;
    const previousBook = bookRef.current;

    setReaderError("");
    setReaderStatus("loading");
    setBookInfo(null);
    setProgress(null);
    setAreLocationsReady(false);
    lastLocationRef.current = null;
    stopSpeech();
    container.replaceChildren();

    if (renditionRef.current) {
      renditionRef.current.destroy();
      renditionRef.current = null;
    }

    if (previousBook) {
      previousBook.destroy();
      bookRef.current = null;
    }

    const book = ePub(activeBook.url);
    bookRef.current = book;

    const rendition = book.renderTo(container, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      spread: "auto",
      minSpreadWidth: 900
    });

    renditionRef.current = rendition;
    rendition.hooks.content.register((contents: Contents) => {
      applyContentStyles(contents, settingsRef.current);
    });

    rendition.themes.register("light", {
      html: {
        background: readerThemeColors.light.background,
        color: readerThemeColors.light.text
      },
      body: {
        background: readerThemeColors.light.background,
        color: readerThemeColors.light.text,
        "font-family": "Georgia, Cambria, 'Times New Roman', serif",
        "line-height": "1.65"
      },
      a: { color: readerThemeColors.light.link }
    });
    rendition.themes.register("dark", {
      html: {
        background: readerThemeColors.dark.background,
        color: readerThemeColors.dark.text
      },
      body: {
        background: readerThemeColors.dark.background,
        color: readerThemeColors.dark.text,
        "font-family": "Georgia, Cambria, 'Times New Roman', serif",
        "line-height": "1.65"
      },
      a: { color: readerThemeColors.dark.link }
    });
    applyReaderPreferences(rendition, settingsRef.current);

    const saveReadingLocation = (location: Location) => {
      if (!activeBookRef.current) {
        return;
      }

      const cfi = location?.start?.cfi;
      if (!cfi) {
        return;
      }

      const href = location?.start?.href || "";
      const percentage = getReadingPercentage(book, location);
      const pageInfo = getReadingPageInfo(book, location, percentage);
      const currentBookId = activeBookRef.current.id;

      setLibrary((currentLibrary) =>
        currentLibrary.map((storedBook) =>
          storedBook.id === currentBookId
            ? {
                ...storedBook,
                updatedAt: new Date().toISOString(),
                position: {
                  cfi,
                  href,
                  percentage,
                  isPrecise: percentage != null,
                  progressMethod: PROGRESS_METHOD,
                  updatedAt: new Date().toISOString()
                }
              }
            : storedBook
        )
      );

      setProgress({ href, percentage: percentage ?? null, page: pageInfo.page, totalPages: pageInfo.totalPages });
    };

    rendition.on("relocated", (location: Location) => {
      lastLocationRef.current = location;
      saveReadingLocation(location);

      if (speechShouldContinueRef.current && !window.speechSynthesis.paused) {
        const pageKey = getLocationSpeechKey(location);
        if (pageKey && pageKey !== speechPageKeyRef.current) {
          speechPageAdvanceTimerRef.current = window.setTimeout(() => {
            startSpeechForCurrentPage();
          }, 120);
        }
      }
    });

    Promise.allSettled([book.loaded.metadata, book.ready]).then(([metadataResult]) => {
      if (cancelled) {
        return;
      }

      if (metadataResult.status === "fulfilled") {
        const metadata = metadataResult.value || {};
        const title = metadata.title || activeBook.title || "Untitled EPUB";
        const author = formatAuthor(metadata.creator) || activeBook.author;
        setBookInfo({ title, author });

        setLibrary((currentLibrary) =>
          currentLibrary.map((storedBook) =>
            storedBook.id === activeBook.id
              ? { ...storedBook, title, author, updatedAt: new Date().toISOString() }
              : storedBook
          )
        );
      }
    });

    book.ready
      .then(async () => {
        if (!cancelled) {
          try {
            await book.locations.generate(1000);
          } catch {
            // Displayed page data is still available if generated locations fail.
          }
        }

        if (!cancelled) {
          setAreLocationsReady(true);
          rendition.reportLocation();
        }
      })
      .catch(() => undefined);

    rendition
      .display(activeBook.position?.cfi || undefined)
      .then(() => {
        if (!cancelled) {
          setReaderStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReaderStatus("error");
          setReaderError(
            "This EPUB could not be opened. Check that the URL is reachable and allows browser CORS requests."
          );
        }
      });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        resetSpeechForManualPageChange();
        rendition.prev();
      }
      if (event.key === "ArrowRight") {
        resetSpeechForManualPageChange();
        rendition.next();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelled = true;
      clearPageHoldNavigation();
      stopSpeech();
      window.removeEventListener("keydown", handleKeyDown);
      rendition.destroy();
      book.destroy();
      if (renditionRef.current === rendition) {
        renditionRef.current = null;
      }
      if (bookRef.current === book) {
        bookRef.current = null;
      }
    };
  }, [activeBook?.id]);

  const addBookFromInput = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      upsertBook(urlInput, true);
      setUrlInput("");
    } catch {
      setReaderError("Enter a valid absolute or relative EPUB URL.");
    }
  };

  const openBook = (bookId: string) => {
    setActiveBookId(bookId);
    setIsLibraryOpen(false);
    setIsAddOpen(false);
  };

  const removeBook = (bookId: string) => {
    setLibrary((currentLibrary) => currentLibrary.filter((book) => book.id !== bookId));
    if (activeBookId === bookId) {
      const nextBook = library.find((book) => book.id !== bookId);
      setActiveBookId(nextBook?.id ?? null);
      setIsAddOpen(!nextBook);
    }
  };

  const goToPreviousPage = () => {
    resetSpeechForManualPageChange();
    renditionRef.current?.prev();
  };
  const goToNextPage = () => {
    resetSpeechForManualPageChange();
    renditionRef.current?.next();
  };

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
    const book = bookRef.current;
    const rendition = renditionRef.current;
    if (!book || !rendition || readerStatus !== "ready") {
      return;
    }

    const clampedProgress = Math.min(100, Math.max(0, nextProgress));
    const generatedLocationCount = book.locations?.length?.() || 0;
    resetSpeechForManualPageChange();

    if (generatedLocationCount > 0) {
      rendition.display(book.locations.cfiFromPercentage(clampedProgress / 100));
    }
  };

  const updateFontSize = (delta: number) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      fontSize: Math.min(150, Math.max(75, currentSettings.fontSize + delta))
    }));
  };

  const toggleTheme = () => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      theme: currentSettings.theme === "light" ? "dark" : "light"
    }));
  };

  const updateSpeechLanguage = (language: string) => {
    speechLanguageRef.current = language;
    if (isSpeechSupported()) {
      speechVoiceRef.current = selectVoiceForLanguage(language, window.speechSynthesis.getVoices());
      void getSpeechVoices().then((voices) => {
        if (speechLanguageRef.current === language) {
          speechVoiceRef.current = selectVoiceForLanguage(language, voices);
        }
      });
    }
    setSettings((currentSettings) => ({
      ...currentSettings,
      speechLanguage: language
    }));
    if (speechMode === "playing" || speechMode === "paused") {
      stopSpeech();
    }
  };

  const readerTitle = bookInfo?.title || activeBook?.title || "EPUB Reader";
  const readerAuthor = bookInfo?.author || activeBook?.author || "";
  const selectedSpeechLanguage = settings.speechLanguage || DEFAULT_SPEECH_LANGUAGE;
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
  const speechButtonTitle =
    speechMode === "unsupported"
      ? "Read aloud is not supported in this browser"
      : speechMode === "playing"
        ? `Pause read aloud (${selectedSpeechLanguage})`
        : `Read this page aloud (${selectedSpeechLanguage})`;
  const isSpeechButtonDisabled = !activeBook || readerStatus !== "ready" || speechMode === "unsupported";

  useEffect(() => {
    document.title = formattedProgress ? `${formattedProgress} - ${readerTitle}` : readerTitle;
  }, [formattedProgress, readerTitle]);

  return (
    <main className={`app theme-${settings.theme}`}>
      <button
        type="button"
        className={`floating-menu-button ${isToolbarOpen ? "toolbar-open" : ""}`}
        onClick={() => setIsToolbarOpen(true)}
        title="Open menu"
      >
        <Menu aria-hidden="true" size={21} />
      </button>

      <header className={`reader-toolbar ${isToolbarOpen ? "open" : ""}`}>
        <button type="button" className="toolbar-close-button" onClick={() => setIsToolbarOpen(false)} title="Close menu">
          <X aria-hidden="true" size={19} />
        </button>

        <div className="title-block">
          <BookOpen aria-hidden="true" size={20} />
          <div>
            <div className="title-line">
              <h1>{readerTitle}</h1>
              {formattedProgress && <span className="progress-pill">{formattedProgress}</span>}
            </div>
            <p>{readerAuthor || activeBook?.url || "Add an EPUB URL to start reading"}</p>
          </div>
        </div>

        <div className="toolbar-actions" aria-label="Reader controls">
          <button
            type="button"
            className={`icon-button speech-button ${isSpeechActive ? "active" : ""}`}
            onClick={() => void toggleSpeech()}
            title={speechButtonTitle}
            aria-label={speechButtonTitle}
            disabled={isSpeechButtonDisabled}
          >
            {speechMode === "playing" ? <Pause aria-hidden="true" size={19} /> : <Play aria-hidden="true" size={19} />}
          </button>
          <button type="button" className="icon-button" onClick={() => setIsLibraryOpen(true)} title="Library">
            <Library aria-hidden="true" size={19} />
          </button>
          <button type="button" className="icon-button" onClick={() => setIsAddOpen(true)} title="Add EPUB">
            <Plus aria-hidden="true" size={20} />
          </button>
          <select
            className="language-select"
            value={selectedSpeechLanguage}
            onChange={(event) => updateSpeechLanguage(event.currentTarget.value)}
            title="Read aloud language"
            aria-label="Read aloud language"
          >
            {SPEECH_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="control-group" aria-label="Font size">
            <button type="button" className="icon-button" onClick={() => updateFontSize(-5)} title="Smaller text">
              <Minus aria-hidden="true" size={18} />
            </button>
            <span className="font-indicator">{settings.fontSize}%</span>
            <button type="button" className="icon-button" onClick={() => updateFontSize(5)} title="Larger text">
              <Plus aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="page-control" aria-label="Page navigation">
            <span className="page-count">{pageLabel}</span>
            <input
              className="page-slider"
              type="range"
              min="0"
              max="1000"
              step="1"
              value={sliderValue}
              onChange={(event) => goToProgress(Number(event.currentTarget.value) / 10)}
              disabled={!activeBook || readerStatus !== "ready" || !areLocationsReady}
              aria-label="Reading progress"
            />
          </div>
          <button type="button" className="icon-button" onClick={toggleTheme} title="Toggle theme">
            {settings.theme === "light" ? <Moon aria-hidden="true" size={19} /> : <Sun aria-hidden="true" size={19} />}
          </button>
        </div>
      </header>

      <section className="reader-shell" aria-label="Book reader">
        <div className="viewer-panel">
          {!activeBook && (
            <div className="empty-state">
              <BookOpen aria-hidden="true" size={44} />
              <h2>No EPUB selected</h2>
              <p>Use the plus button to add a book URL, or open this page with a URL query parameter.</p>
              <code>?url=https://example.com/book.epub</code>
            </div>
          )}
          {readerStatus === "loading" && activeBook && <div className="loading-state">Opening EPUB...</div>}
          {readerError && <div className="error-state">{readerError}</div>}
          <div ref={viewerRef} className="viewer" />
        </div>

        <button
          type="button"
          className="page-zone page-zone-left"
          onClick={() => clickPageZone("previous")}
          onPointerDown={() => startPageHoldNavigation("previous")}
          onPointerUp={finishPageHoldNavigation}
          onPointerCancel={finishPageHoldNavigation}
          onPointerLeave={finishPageHoldNavigation}
          aria-label="Previous page"
        />
        <button
          type="button"
          className="page-zone page-zone-right"
          onClick={() => clickPageZone("next")}
          onPointerDown={() => startPageHoldNavigation("next")}
          onPointerUp={finishPageHoldNavigation}
          onPointerCancel={finishPageHoldNavigation}
          onPointerLeave={finishPageHoldNavigation}
          aria-label="Next page"
        />
      </section>

      {isLibraryOpen && (
        <aside className="drawer" aria-label="Saved books">
          <div className="drawer-header">
            <h2>Library</h2>
            <button type="button" className="icon-button" onClick={() => setIsLibraryOpen(false)} title="Close library">
              <X aria-hidden="true" size={19} />
            </button>
          </div>

          <div className="book-list">
            {library.length === 0 && <p className="muted-text">No saved books yet.</p>}
            {library.map((book) => (
              <article className={`book-card ${book.id === activeBookId ? "active" : ""}`} key={book.id}>
                <button type="button" className="book-open-button" onClick={() => openBook(book.id)}>
                  <span>{book.title || "Untitled EPUB"}</span>
                  <small>{book.author || book.url}</small>
                  {formatProgress(
                    book.id === activeBookId
                      ? areLocationsReady
                        ? progress?.percentage ??
                          (book.position?.isPrecise && book.position.progressMethod === PROGRESS_METHOD
                            ? book.position.percentage
                            : null)
                        : null
                      : book.position?.isPrecise && book.position.progressMethod === PROGRESS_METHOD
                        ? book.position.percentage
                        : null
                  ) && (
                    <em>
                      {formatProgress(
                        book.id === activeBookId
                          ? areLocationsReady
                            ? progress?.percentage ??
                              (book.position?.isPrecise && book.position.progressMethod === PROGRESS_METHOD
                                ? book.position.percentage
                                : null)
                            : null
                          : book.position?.isPrecise && book.position.progressMethod === PROGRESS_METHOD
                            ? book.position.percentage
                            : null
                      )} read
                    </em>
                  )}
                </button>
                <button type="button" className="icon-button danger" onClick={() => removeBook(book.id)} title="Remove book">
                  <Trash2 aria-hidden="true" size={17} />
                </button>
              </article>
            ))}
          </div>
        </aside>
      )}

      {isAddOpen && (
        <div className="modal-layer" role="presentation">
          <form className="add-dialog" onSubmit={addBookFromInput}>
            <div className="drawer-header">
              <h2>Add EPUB</h2>
              <button type="button" className="icon-button" onClick={() => setIsAddOpen(false)} title="Close add dialog">
                <X aria-hidden="true" size={19} />
              </button>
            </div>
            <label htmlFor="book-url">EPUB URL</label>
            <input
              id="book-url"
              type="url"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="https://example.com/book.epub"
              autoFocus
              required
            />
            <button type="submit" className="primary-button">
              Add and open
            </button>
          </form>
        </div>
      )}
    </main>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found.");
}

createRoot(rootElement).render(<App />);
