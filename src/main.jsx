import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ePub from "epubjs";
import {
  BookOpen,
  Library,
  Menu,
  Minus,
  Moon,
  Plus,
  Sun,
  Trash2,
  Type,
  X
} from "lucide-react";
import "./styles.css";

const LIBRARY_KEY = "epub-reader:library:v1";
const SETTINGS_KEY = "epub-reader:settings:v1";

const defaultSettings = {
  fontSize: 100,
  theme: "dark"
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
};

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `book-${(hash >>> 0).toString(16)}`;
}

function readJson(key, fallback) {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function convertKnownHostedUrl(url) {
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

function normalizeBookUrl(value) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  return convertKnownHostedUrl(new URL(trimmedValue, window.location.href)).href;
}

function getQueryBookUrl() {
  const params = new URLSearchParams(window.location.search);
  const rawUrl = params.get("url") || params.get("book") || params.get("epub") || "";

  try {
    return rawUrl ? normalizeBookUrl(rawUrl) : "";
  } catch {
    return "";
  }
}

function formatAuthor(author) {
  if (Array.isArray(author)) {
    return author.filter(Boolean).join(", ");
  }

  return author || "";
}

function createBook(url) {
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

function toDisplayPercentage(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return null;
  }

  const numericValue = Number(value);
  return Math.min(100, Math.max(0, Math.round(numericValue * 10) / 10));
}

function formatProgress(value) {
  const percentage = toDisplayPercentage(value);
  if (percentage == null || percentage < 1) {
    return "";
  }

  return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(1)}%`;
}

function getDisplayedPagePercentage(book, location) {
  const start = location?.start;
  const spineLength = Number(book?.spine?.length || 0);
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

function applyContentStyles(contents, settings) {
  const colors = readerThemeColors[settings.theme] || readerThemeColors.light;
  const documentElement = contents.document?.documentElement;
  const body = contents.document?.body;

  contents.css("font-size", `${settings.fontSize}%`, true);
  contents.css("font-family", "Georgia, Cambria, 'Times New Roman', serif", true);
  contents.css("line-height", "1.65", true);
  contents.css("color", colors.text, true);
  contents.css("background", colors.background, true);
  contents.css("background-color", colors.background, true);

  if (documentElement) {
    documentElement.style.setProperty("background", colors.background, "important");
    documentElement.style.setProperty("color", colors.text, "important");
  }

  if (body) {
    body.style.setProperty("background", colors.background, "important");
    body.style.setProperty("color", colors.text, "important");
  }

  contents.document?.querySelectorAll?.("a").forEach((link) => {
    link.style.setProperty("color", colors.link, "important");
  });
}

function applyReaderPreferences(rendition, settings) {
  if (!rendition) {
    return;
  }

  rendition.themes.fontSize(`${settings.fontSize}%`);
  rendition.themes.select(settings.theme);
  rendition.getContents().forEach((contents) => applyContentStyles(contents, settings));
}

function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => readJson(key, fallback));

  useEffect(() => {
    writeJson(key, value);
  }, [key, value]);

  return [value, setValue];
}

function App() {
  const queryBookUrl = useMemo(() => getQueryBookUrl(), []);
  const [library, setLibrary] = usePersistentState(LIBRARY_KEY, []);
  const [settings, setSettings] = usePersistentState(SETTINGS_KEY, defaultSettings);
  const [activeBookId, setActiveBookId] = useState(null);
  const [isToolbarOpen, setIsToolbarOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(!queryBookUrl);
  const [urlInput, setUrlInput] = useState("");
  const [readerError, setReaderError] = useState("");
  const [readerStatus, setReaderStatus] = useState("idle");
  const [bookInfo, setBookInfo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [areLocationsReady, setAreLocationsReady] = useState(false);
  const viewerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const activeBookRef = useRef(null);
  const settingsRef = useRef(settings);
  const queryBookHandledRef = useRef(false);

  const activeBook = useMemo(
    () => library.find((book) => book.id === activeBookId) || null,
    [activeBookId, library]
  );

  useEffect(() => {
    activeBookRef.current = activeBook;
  }, [activeBook]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const upsertBook = useCallback((bookUrl, openBook = true) => {
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
    rendition.hooks.content.register((contents) => {
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

    const saveReadingLocation = (location) => {
      if (!activeBookRef.current) {
        return;
      }

      const cfi = location?.start?.cfi;
      if (!cfi) {
        return;
      }

      const href = location?.start?.href || "";
      const percentage = getDisplayedPagePercentage(book, location);
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

      setProgress({ href, percentage: percentage ?? null });
    };

    rendition.on("relocated", (location) => {
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
      .then(() => {
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

    const handleKeyDown = (event) => {
      if (event.key === "ArrowLeft") {
        rendition.prev();
      }
      if (event.key === "ArrowRight") {
        rendition.next();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelled = true;
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

  const addBookFromInput = (event) => {
    event.preventDefault();

    try {
      upsertBook(urlInput, true);
      setUrlInput("");
    } catch {
      setReaderError("Enter a valid absolute or relative EPUB URL.");
    }
  };

  const openBook = (bookId) => {
    setActiveBookId(bookId);
    setIsLibraryOpen(false);
    setIsAddOpen(false);
  };

  const removeBook = (bookId) => {
    setLibrary((currentLibrary) => currentLibrary.filter((book) => book.id !== bookId));
    if (activeBookId === bookId) {
      const nextBook = library.find((book) => book.id !== bookId);
      setActiveBookId(nextBook?.id || null);
      setIsAddOpen(!nextBook);
    }
  };

  const goToPreviousPage = () => renditionRef.current?.prev();
  const goToNextPage = () => renditionRef.current?.next();

  const updateFontSize = (delta) => {
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

  const readerTitle = bookInfo?.title || activeBook?.title || "EPUB Reader";
  const readerAuthor = bookInfo?.author || activeBook?.author || "";
  const currentProgress = areLocationsReady
    ? progress?.percentage ??
      (activeBook?.position?.isPrecise && activeBook.position.progressMethod === PROGRESS_METHOD
        ? activeBook.position.percentage
        : null)
    : null;
  const formattedProgress = formatProgress(currentProgress);

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
          <button type="button" className="icon-button" onClick={() => setIsLibraryOpen(true)} title="Library">
            <Library aria-hidden="true" size={19} />
          </button>
          <button type="button" className="icon-button" onClick={() => setIsAddOpen(true)} title="Add EPUB">
            <Plus aria-hidden="true" size={20} />
          </button>
          <div className="control-group" aria-label="Font size">
            <button type="button" className="icon-button" onClick={() => updateFontSize(-5)} title="Smaller text">
              <Minus aria-hidden="true" size={18} />
            </button>
            <span className="font-indicator">
              <Type aria-hidden="true" size={16} />
              {settings.fontSize}%
            </span>
            <button type="button" className="icon-button" onClick={() => updateFontSize(5)} title="Larger text">
              <Plus aria-hidden="true" size={18} />
            </button>
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

        <button type="button" className="page-zone page-zone-left" onClick={goToPreviousPage} aria-label="Previous page" />
        <button type="button" className="page-zone page-zone-right" onClick={goToNextPage} aria-label="Next page" />
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

createRoot(document.getElementById("root")).render(<App />);
