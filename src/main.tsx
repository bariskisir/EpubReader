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
  LoaderCircle,
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
const READER_SENTENCE_CLASS = "reader-sentence";
const SENTENCE_BLOCK_SELECTOR = "p, li, blockquote, figcaption, dd, dt, td, th, h1, h2, h3, h4, h5, h6";
const MAX_SPEECH_CHUNK_LENGTH = 900;
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
  { value: "web-speech", label: "Web Speech" }
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
  fontSize: 100,
  theme: "dark",
  speechProvider: DEFAULT_SPEECH_PROVIDER,
  speechLanguage: DEFAULT_SPEECH_LANGUAGE,
  deepgramModel: DEFAULT_DEEPGRAM_MODEL
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
type SpeechProvider = "deepgram" | "web-speech";

type ReaderStatus = "idle" | "loading" | "ready" | "error";
type SpeechMode = "idle" | "loading" | "playing" | "paused" | "unsupported" | "error";

interface ReaderSettings {
  fontSize: number;
  theme: Theme;
  speechProvider?: SpeechProvider;
  speechLanguage?: string;
  deepgramModel?: string;
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

function getSentenceRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const sentencePattern = /[^.!?\u3002\uff01\uff1f]+(?:[.!?\u3002\uff01\uff1f]+["'\u201d\u2019\u00bb)\]]*|$)\s*/g;
  let match = sentencePattern.exec(text);

  while (match) {
    if (match[0].trim()) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    match = sentencePattern.exec(text);
  }

  return ranges;
}

function wrapBlockSentences(block: Element): void {
  if (
    block.hasAttribute("data-reader-sentences") ||
    block.closest(`.${READER_SENTENCE_CLASS}`) ||
    block.querySelector(SENTENCE_BLOCK_SELECTOR)
  ) {
    return;
  }

  const document = block.ownerDocument;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isReadableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  let text = "";
  let currentNode = walker.nextNode() as Text | null;

  while (currentNode) {
    const start = text.length;
    text += currentNode.data;
    textNodes.push({ node: currentNode, start, end: text.length });
    currentNode = walker.nextNode() as Text | null;
  }

  const sentenceRanges = getSentenceRanges(text);
  for (let index = sentenceRanges.length - 1; index >= 0; index -= 1) {
    const sentence = sentenceRanges[index];
    const startEntry = textNodes.find((entry) => sentence.start >= entry.start && sentence.start < entry.end);
    const endEntry = [...textNodes].reverse().find((entry) => sentence.end > entry.start && sentence.end <= entry.end);
    if (!startEntry || !endEntry) {
      continue;
    }

    const range = document.createRange();
    try {
      range.setStart(startEntry.node, sentence.start - startEntry.start);
      range.setEnd(endEntry.node, sentence.end - endEntry.start);
      const wrapper = document.createElement("span");
      wrapper.className = READER_SENTENCE_CLASS;
      wrapper.append(range.extractContents());
      range.insertNode(wrapper);
    } catch {
      // Some malformed EPUB markup cannot be safely wrapped.
    } finally {
      range.detach();
    }
  }

  block.setAttribute("data-reader-sentences", "true");
}

function preventSentencePageSplits(document: Document): void {
  document.querySelectorAll(SENTENCE_BLOCK_SELECTOR).forEach(wrapBlockSentences);
}

function allowOversizedSentencesToSplit(contents: Contents): void {
  const document = contents.document;
  const view = contents.window;
  if (!document || !view) {
    return;
  }

  view.requestAnimationFrame(() => {
    const viewportHeight = view.innerHeight || document.documentElement.clientHeight;
    if (!viewportHeight) {
      return;
    }

    document.querySelectorAll(`.${READER_SENTENCE_CLASS}`).forEach((sentence) => {
      const element = sentence as HTMLElement;
      if (element.getBoundingClientRect().height <= viewportHeight * 0.9) {
        return;
      }

      element.style.setProperty("display", "inline", "important");
      element.style.setProperty("break-inside", "auto", "important");
      element.style.setProperty("page-break-inside", "auto", "important");
      element.style.setProperty("-webkit-column-break-inside", "auto", "important");
    });
  });
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

  preventSentencePageSplits(contents.document);
  contents.document?.querySelectorAll?.(`.${READER_SENTENCE_CLASS}`).forEach((sentence: Element) => {
    const element = sentence as HTMLElement;
    element.style.setProperty("display", "inline-block", "important");
    element.style.setProperty("max-width", "100%", "important");
    element.style.setProperty("break-inside", "avoid", "important");
    element.style.setProperty("page-break-inside", "avoid", "important");
    element.style.setProperty("-webkit-column-break-inside", "avoid", "important");
    element.style.setProperty("vertical-align", "baseline", "important");
  });
  allowOversizedSentencesToSplit(contents);

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
  if (!contents) {
    return [];
  }
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

function isWebSpeechSupported(): boolean {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function isSpeechProviderSupported(provider: SpeechProvider): boolean {
  return provider === "deepgram" || isWebSpeechSupported();
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

function getSentenceAtRangeBoundary(container: Node, offset: number, edge: "start" | "end"): Element | null {
  const closestSentence = getElementFromNode(container)?.closest(`.${READER_SENTENCE_CLASS}`);
  if (closestSentence) {
    return closestSentence;
  }

  if (container.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const childIndex = edge === "end" ? offset - 1 : offset;
  const child = container.childNodes.item(childIndex);
  return child ? getElementFromNode(child)?.closest(`.${READER_SENTENCE_CLASS}`) || null : null;
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

      const endSentence = getSentenceAtRangeBoundary(endRange.endContainer, endRange.endOffset, "end");
      if (endSentence) {
        pageRange.setEndAfter(endSentence);
      }
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
    if (!locationText.text) {
      const sections = getRenditionContents(rendition).map((contents) => extractVisibleSpeechText(contents.document));
      return {
        text: normalizeWhitespace(sections.map((section) => section.text).filter(Boolean).join("\n\n")),
        languageHint: sections.find((section) => section.languageHint)?.languageHint || locationText.languageHint,
        pageKey: getLocationSpeechKey(location)
      };
    }

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
  const [speechError, setSpeechError] = useState("");
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>("idle");
  const [speechMode, setSpeechMode] = useState<SpeechMode>(() =>
    isSpeechProviderSupported(settings.speechProvider || DEFAULT_SPEECH_PROVIDER) ? "idle" : "unsupported"
  );
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [areLocationsReady, setAreLocationsReady] = useState(false);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const deepgramCacheBookRef = useRef<Book | null>(null);
  const deepgramCacheRenditionRef = useRef<Rendition | null>(null);
  const deepgramCacheContainerRef = useRef<HTMLDivElement | null>(null);
  const activeBookRef = useRef<LibraryBook | null>(null);
  const settingsRef = useRef(settings);
  const queryBookHandledRef = useRef(false);
  const lastLocationRef = useRef<Location | null>(null);
  const speechChunksRef = useRef<string[]>([]);
  const speechChunkIndexRef = useRef(0);
  const speechProviderRef = useRef<SpeechProvider>(settings.speechProvider || DEFAULT_SPEECH_PROVIDER);
  const speechLanguageRef = useRef(settings.speechLanguage || DEFAULT_SPEECH_LANGUAGE);
  const deepgramModelRef = useRef(settings.deepgramModel || DEFAULT_DEEPGRAM_MODEL);
  const speechVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const speechPageKeyRef = useRef("");
  const speechShouldContinueRef = useRef(false);
  const speechPausedRef = useRef(false);
  const speechTokenRef = useRef(0);
  const speechPageAdvanceTimerRef = useRef<number | null>(null);
  const speechPageAdvanceInFlightRef = useRef(false);
  const deepgramAudioRef = useRef<HTMLAudioElement | null>(null);
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

  const activeBook = useMemo(
    () => library.find((book) => book.id === activeBookId) || null,
    [activeBookId, library]
  );

  useEffect(() => {
    activeBookRef.current = activeBook;
  }, [activeBook]);

  useEffect(() => {
    settingsRef.current = settings;
    const nextProvider = settings.speechProvider || DEFAULT_SPEECH_PROVIDER;
    const storedLanguage = settings.speechLanguage || DEFAULT_SPEECH_LANGUAGE;
    const nextLanguage =
      nextProvider === "deepgram" && !isDeepgramLanguageSupported(storedLanguage)
        ? DEFAULT_SPEECH_LANGUAGE
        : storedLanguage;
    const nextDeepgramModel = isDeepgramModelForLanguage(settings.deepgramModel || "", nextLanguage)
      ? settings.deepgramModel || DEFAULT_DEEPGRAM_MODEL
      : getDefaultDeepgramModel(nextLanguage);
    speechProviderRef.current = nextProvider;
    speechLanguageRef.current = nextLanguage;
    deepgramModelRef.current = nextDeepgramModel;
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
      settings.deepgramModel !== nextDeepgramModel
    ) {
      setSettings((currentSettings) => ({
        ...currentSettings,
        speechProvider: nextProvider,
        speechLanguage: nextLanguage,
        deepgramModel: nextDeepgramModel
      }));
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
          task.reject(error);
        } finally {
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
    deepgramProgressiveStateRef.current = {
      sentenceCount: 0,
      groupIndex: 0,
      complete: false
    };
    speechPageAdvanceInFlightRef.current = false;
    clearSpeechPageAdvanceTimer();
    clearDeepgramPlayback();

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
      deepgramCacheQueueRef.current.length === 0 &&
      deepgramAudioCacheRef.current.size === 0 &&
      deepgramAbortControllersRef.current.size === 0 &&
      !window.speechSynthesis?.speaking &&
      !window.speechSynthesis?.paused
    ) {
      return;
    }

    stopSpeech();
  }

  function getCurrentSpeechLocation(): Location | null {
    return renditionRef.current?.location || lastLocationRef.current || null;
  }

  function advanceAfterSpeechPage(): void {
    const rendition = renditionRef.current;
    const currentLocation = getCurrentSpeechLocation();
    const completedDeepgramPage = deepgramCachePagesRef.current.get(speechPageKeyRef.current);
    if (speechProviderRef.current === "deepgram" && completedDeepgramPage) {
      deepgramProgressiveStateRef.current = completedDeepgramPage.nextProgressiveState;
    }
    deepgramCachePagesRef.current.delete(speechPageKeyRef.current);
    if (!rendition || currentLocation?.atEnd) {
      stopSpeech("idle");
      return;
    }

    if (speechPageAdvanceInFlightRef.current) {
      return;
    }

    const token = speechTokenRef.current;
    speechPageAdvanceInFlightRef.current = true;
    clearSpeechPageAdvanceTimer();

    void rendition
      .next()
      .then(() => {
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
          speechPageAdvanceInFlightRef.current = false;
          return;
        }

        speechPageAdvanceTimerRef.current = window.setTimeout(() => {
          speechPageAdvanceTimerRef.current = null;
          if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
            speechPageAdvanceInFlightRef.current = false;
            return;
          }

          speechPageAdvanceInFlightRef.current = false;
          startSpeechForCurrentPage();
        }, 120);
      })
      .catch((error) => {
        speechPageAdvanceInFlightRef.current = false;
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
        advanceAfterSpeechPage();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = speechLanguageRef.current || DEFAULT_SPEECH_LANGUAGE;
      if (speechVoiceRef.current) {
        utterance.voice = speechVoiceRef.current;
      }

      utterance.onend = () => {
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current || isSpeechPaused()) {
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

  function moveDeepgramCacheRendition(action: () => Promise<void>): Promise<Location | null> {
    const cacheRendition = deepgramCacheRenditionRef.current;
    if (!cacheRendition) {
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cacheRendition.off("relocated", handleRelocated);
        resolve(cacheRendition.location || null);
      }, 2500);
      const handleRelocated = (location: Location) => {
        window.clearTimeout(timeout);
        cacheRendition.off("relocated", handleRelocated);
        resolve(location);
      };

      cacheRendition.on("relocated", handleRelocated);
      action().catch((error) => {
        window.clearTimeout(timeout);
        cacheRendition.off("relocated", handleRelocated);
        reject(error);
      });
    });
  }

  async function cacheDeepgramCurrentAndNextPages(
    currentPage: DeepgramCachedPage,
    currentLocation: Location | null,
    token: number,
    currentStartIndex = 1
  ): Promise<void> {
    cacheDeepgramPage(currentPage, currentStartIndex);

    const cacheRendition = deepgramCacheRenditionRef.current;
    const startCfi = currentLocation?.start?.cfi;
    if (!cacheRendition || !startCfi) {
      return;
    }

    try {
      let location = await moveDeepgramCacheRendition(() => cacheRendition.display(startCfi));
      let progressiveState = currentPage.nextProgressiveState;
      for (let pageOffset = 1; pageOffset < DEEPGRAM_CACHED_PAGE_COUNT; pageOffset += 1) {
        if (token !== speechTokenRef.current || !speechShouldContinueRef.current || location?.atEnd) {
          return;
        }

        location = await moveDeepgramCacheRendition(() => cacheRendition.next());
        const snapshot = createVisibleSpeechSnapshot(cacheRendition, location);
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
      setSpeechMode("error");
      return;
    }

    const token = speechTokenRef.current + 1;
    speechTokenRef.current = token;
    speechChunkIndexRef.current = startIndex;
    clearSpeechPageAdvanceTimer();
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

        const releaseCompletedAudio = () => {
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
        await audio.play();
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

  function speakSpeechChunks(startIndex = 0): void {
    if (speechProviderRef.current === "deepgram") {
      speakDeepgramChunks(startIndex);
      return;
    }

    speakWebSpeechChunks(startIndex);
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

      advanceAfterSpeechPage();
      return;
    }

    if (speechProviderRef.current === "deepgram") {
      const page =
        deepgramCachePagesRef.current.get(snapshot.pageKey) ||
        createDeepgramCachedPage(snapshot.pageKey, snapshot.text, deepgramProgressiveStateRef.current);
      deepgramCachePagesRef.current.set(snapshot.pageKey, page);
      speechChunksRef.current = page.chunks;
    } else {
      speechChunksRef.current = splitSpeechText(snapshot.text);
    }
    speechChunkIndexRef.current = 0;
    speechPageKeyRef.current = snapshot.pageKey;
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
      if (provider === "deepgram") {
        stopSpeech();
        return;
      } else {
        speechPausedRef.current = true;
        window.speechSynthesis.pause();
      }
      setSpeechMode("paused");
      void releaseSpeechWakeLock();
      return;
    }

    if (speechMode === "paused") {
      if (provider === "deepgram") {
        stopSpeech();
      } else {
        speechShouldContinueRef.current = true;
        speechPausedRef.current = false;
        window.speechSynthesis.resume();
        window.speechSynthesis.cancel();
        speechChunksRef.current = [];
        speechChunkIndexRef.current = 0;
        speechPageKeyRef.current = "";
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

    let playRequestToken = speechTokenRef.current;
    if (provider === "deepgram") {
      stopSpeech();
      playRequestToken = speechTokenRef.current;
    }

    setSpeechMode(provider === "deepgram" ? "loading" : "playing");
    setSpeechError("");
    speechShouldContinueRef.current = true;
    speechPausedRef.current = false;
    if (provider === "deepgram") {
      primeDeepgramAudio();
      if (playRequestToken !== speechTokenRef.current || !speechShouldContinueRef.current) {
        return;
      }
    }

    const currentLocation = getCurrentSpeechLocation();
    const currentSnapshot = createVisibleSpeechSnapshot(rendition, currentLocation);
    if (!currentSnapshot.text) {
      stopSpeech("error");
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
    if (rendition) {
      applyReaderPreferences(rendition, settings);
    }

    const cacheRendition = deepgramCacheRenditionRef.current;
    if (cacheRendition) {
      cacheRendition.themes.fontSize(`${settings.fontSize}%`);
      getRenditionContents(cacheRendition).forEach((contents) => applyContentStyles(contents, settings));
    }
  }, [settings]);

  useEffect(() => {
    if (!activeBook || !viewerRef.current || !deepgramCacheContainerRef.current) {
      return undefined;
    }

    let cancelled = false;
    const container = viewerRef.current;
    const cacheContainer = deepgramCacheContainerRef.current;
    const previousBook = bookRef.current;
    const previousCacheBook = deepgramCacheBookRef.current;

    setReaderError("");
    setReaderStatus("loading");
    setBookInfo(null);
    setProgress(null);
    setAreLocationsReady(false);
    lastLocationRef.current = null;
    stopSpeech();
    container.replaceChildren();
    cacheContainer.replaceChildren();

    if (renditionRef.current) {
      renditionRef.current.destroy();
      renditionRef.current = null;
    }

    if (previousBook) {
      previousBook.destroy();
      bookRef.current = null;
    }
    if (deepgramCacheRenditionRef.current) {
      deepgramCacheRenditionRef.current.destroy();
      deepgramCacheRenditionRef.current = null;
    }
    if (previousCacheBook) {
      previousCacheBook.destroy();
      deepgramCacheBookRef.current = null;
    }

    const book = ePub(activeBook.url);
    bookRef.current = book;
    const cacheBook = ePub(activeBook.url);
    deepgramCacheBookRef.current = cacheBook;

    const rendition = book.renderTo(container, {
      width: "100%",
      height: "100%",
      ignoreClass: READER_SENTENCE_CLASS,
      flow: "paginated",
      spread: "auto",
      minSpreadWidth: 900
    });

    renditionRef.current = rendition;
    rendition.hooks.content.register((contents: Contents) => {
      applyContentStyles(contents, settingsRef.current);
    });
    const cacheRendition = cacheBook.renderTo(cacheContainer, {
      width: "100%",
      height: "100%",
      ignoreClass: READER_SENTENCE_CLASS,
      flow: "paginated",
      spread: "auto",
      minSpreadWidth: 900
    });
    deepgramCacheRenditionRef.current = cacheRendition;
    cacheRendition.hooks.content.register((contents: Contents) => {
      applyContentStyles(contents, settingsRef.current);
    });
    cacheRendition.themes.fontSize(`${settingsRef.current.fontSize}%`);

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
      cacheRendition.destroy();
      cacheBook.destroy();
      if (renditionRef.current === rendition) {
        renditionRef.current = null;
      }
      if (bookRef.current === book) {
        bookRef.current = null;
      }
      if (deepgramCacheRenditionRef.current === cacheRendition) {
        deepgramCacheRenditionRef.current = null;
      }
      if (deepgramCacheBookRef.current === cacheBook) {
        deepgramCacheBookRef.current = null;
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
    resetSpeechForManualPageChange();
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
      provider === "deepgram" && !isDeepgramLanguageSupported(currentLanguage)
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

  const readerTitle = bookInfo?.title || activeBook?.title || "EPUB Reader";
  const readerAuthor = bookInfo?.author || activeBook?.author || "";
  const selectedSpeechProvider = settings.speechProvider || DEFAULT_SPEECH_PROVIDER;
  const selectedSpeechLanguage = settings.speechLanguage || DEFAULT_SPEECH_LANGUAGE;
  const selectedDeepgramModel = isDeepgramModelForLanguage(settings.deepgramModel || "", selectedSpeechLanguage)
    ? settings.deepgramModel || DEFAULT_DEEPGRAM_MODEL
    : getDefaultDeepgramModel(selectedSpeechLanguage);
  const speechLanguageOptions =
    selectedSpeechProvider === "deepgram" ? DEEPGRAM_LANGUAGE_OPTIONS : WEB_SPEECH_LANGUAGE_OPTIONS;
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
      ? `${selectedSpeechProvider === "deepgram" ? "Deepgram" : "Web Speech API"} is not supported in this browser`
      : speechMode === "error"
        ? `Read aloud failed (${selectedSpeechProvider}, ${selectedSpeechLanguage})`
      : speechMode === "loading"
        ? `Loading speech (${selectedSpeechProvider}, ${selectedSpeechLanguage})`
        : speechMode === "playing"
          ? `${selectedSpeechProvider === "deepgram" ? "Stop" : "Pause"} read aloud (${selectedSpeechProvider}, ${selectedSpeechLanguage})`
          : `Read this page aloud (${selectedSpeechProvider}, ${selectedSpeechLanguage})`;
  const isSpeechButtonDisabled =
    !activeBook ||
    readerStatus !== "ready" ||
    !isSpeechProviderSupported(selectedSpeechProvider) ||
    speechMode === "unsupported";

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
            className={`icon-button speech-button ${isSpeechActive ? "active" : ""} ${isSpeechLoading ? "loading" : ""}`}
            onClick={() => void toggleSpeech()}
            title={speechButtonTitle}
            aria-label={speechButtonTitle}
            disabled={isSpeechButtonDisabled}
          >
            {isSpeechLoading ? (
              <LoaderCircle aria-hidden="true" className="speech-loading-icon" size={19} />
            ) : speechMode === "playing" ? (
              <Pause aria-hidden="true" size={19} />
            ) : (
              <Play aria-hidden="true" size={19} />
            )}
          </button>
          <button type="button" className="icon-button" onClick={() => setIsLibraryOpen(true)} title="Library">
            <Library aria-hidden="true" size={19} />
          </button>
          <button type="button" className="icon-button" onClick={() => setIsAddOpen(true)} title="Add EPUB">
            <Plus aria-hidden="true" size={20} />
          </button>
          <select
            className="provider-select"
            value={selectedSpeechProvider}
            onChange={(event) => updateSpeechProvider(event.currentTarget.value as SpeechProvider)}
            title="Read aloud provider"
            aria-label="Read aloud provider"
          >
            {SPEECH_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="language-select"
            value={selectedSpeechLanguage}
            onChange={(event) => updateSpeechLanguage(event.currentTarget.value)}
            title="Read aloud language"
            aria-label="Read aloud language"
          >
            {speechLanguageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {selectedSpeechProvider === "deepgram" && (
            <select
              className="model-select"
              value={selectedDeepgramModel}
              onChange={(event) => updateDeepgramModel(event.currentTarget.value)}
              title="Deepgram voice model"
              aria-label="Deepgram voice model"
            >
              {deepgramModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
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

      {speechError && (
        <div className="speech-error" role="alert">
          {speechError}
        </div>
      )}

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
      <div ref={deepgramCacheContainerRef} className="deepgram-cache-viewer" aria-hidden="true" />

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
