# EPUB Reader

A simple full-screen client-side EPUB reader for Vercel. The app opens EPUBs from an `epub` query string, an EPUB URL, or a local file upload, and remembers the last reading position for each book.

## Usage

Open a book directly with the `epub` query string:


https://epub-reader-omega.vercel.app?epub=https://github.com/bariskisir/AI-Books/raw/refs/heads/master/series/The_Meridian_Cycle/epub/Book_0_The_Gate_at_Kestrel_Falling.epub

The app also accepts `book` and `url` as legacy query parameter aliases:

```text
/?epub=https://example.com/book.epub
/?book=https://example.com/book.epub
/?url=https://example.com/book.epub
```

If no query string is provided, use the plus button to add an EPUB URL or upload a `.epub` file from your computer. Opening the same EPUB URL or uploaded file again reuses the existing saved book instead of adding a duplicate. Uploaded EPUB files are stored in the browser with IndexedDB.

Use the play button in the top menu to listen to the current page. Deepgram is the default text-to-speech provider, with English and the Thalia Aura-2 voice selected by default. The provider dropdown can switch playback to the browser Web Speech API. When Deepgram is selected, the language and model dropdowns let you choose any supported Aura-2 language and voice. The reader pauses playback and automatically advances to the next page when the current page finishes.

GitHub `blob` and `raw` links are normalized automatically. For example, this:

```text
https://github.com/user/repo/blob/main/books/example.epub
```

is opened as:

```text
https://raw.githubusercontent.com/user/repo/main/books/example.epub
```

Other EPUB hosts still need to allow browser CORS requests.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Deploy the repository to Vercel with the default Vite settings. EPUB files must be reachable from the browser and must allow CORS requests.
