# EPUB Reader

A simple full-screen client-side EPUB reader for Vercel. The app opens an EPUB URL from the query string, stores books in `localStorage`, and remembers the last reading position for each book.

## Usage

Open a book directly:


https://epub-reader-omega.vercel.app?epub=https://github.com/bariskisir/AI-Books/raw/refs/heads/master/SciFi_100_Novels/epub/Book_001_The_Gate_at_Kestrel_Falling.epub


The app also accepts `book` and `epub` as query parameter names:

```text
/?book=https://example.com/book.epub
/?epub=https://example.com/book.epub
```

If no query parameter is provided, use the plus button to add an EPUB URL. Opening the same EPUB URL again reuses the existing saved book instead of adding a duplicate.

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
