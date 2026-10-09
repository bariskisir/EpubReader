// Readest'in sayfa çevirme yolu.
// Kaynak: readest/apps/readest-app/src/app/reader/hooks/usePagination.ts
// (viewPagination) — e-ink / Tauri / scrolled sürükleme kısımları çıkarıldı,
// sabit-yerleşim panning ve rtl davranışı korundu.

export type PaginationSide = "left" | "right" | "up" | "down";
export type PaginationMode = "pan" | "page" | "section";

export interface PaginationRenderer {
  scrolled?: boolean;
  prev?: () => Promise<void>;
  next?: () => Promise<void>;
  prevSection?: () => Promise<void>;
  nextSection?: () => Promise<void>;
}

export interface PaginationView {
  renderer: PaginationRenderer;
  book?: { dir?: string; rendition?: { layout?: string } };
  isOverflowX?: () => boolean;
  isOverflowY?: () => boolean;
  pan?: (dx: number, dy: number) => Promise<void>;
  prev: (distance?: number) => Promise<void>;
  next: (distance?: number) => Promise<void>;
}

const swapLeftRight = (side: PaginationSide): PaginationSide => {
  if (side === "left") return "right";
  if (side === "right") return "left";
  return side;
};

const isPanningView = (
  view: PaginationView,
  zoomLevel: number,
  zoomMode: string
): boolean =>
  view.book?.rendition?.layout === "pre-paginated" &&
  (zoomLevel > 100 || zoomMode !== "fit-page");

const hasHorizontalPanning = (
  view: PaginationView,
  zoomLevel: number,
  zoomMode: string
): boolean => isPanningView(view, zoomLevel, zoomMode) && !!view.isOverflowX?.();

const hasVerticalPanning = (
  view: PaginationView,
  zoomLevel: number,
  zoomMode: string
): boolean => isPanningView(view, zoomLevel, zoomMode) && !!view.isOverflowY?.();

export interface ViewPaginationOptions {
  rtl?: boolean;
  zoomLevel?: number;
  zoomMode?: string;
  panDistance?: number;
}

/**
 * Readest `viewPagination` (paginated + fixed-layout pan + section).
 * `side` rtl'de sol/sağ eşlenir.
 */
export const viewPagination = (
  view: PaginationView | null | undefined,
  side: PaginationSide,
  mode: PaginationMode = "page",
  options: ViewPaginationOptions = {}
): Promise<void> | undefined => {
  if (!view) return undefined;
  const { rtl = false, zoomLevel = 100, zoomMode = "fit-page", panDistance = 50 } = options;
  if (rtl) {
    side = swapLeftRight(side);
  }
  const renderer = view.renderer;

  if (mode === "section") {
    if (side === "left" || side === "up") {
      return renderer.prevSection?.();
    }
    return renderer.nextSection?.();
  }

  if (mode === "pan" && isPanningView(view, zoomLevel, zoomMode)) {
    if (hasHorizontalPanning(view, zoomLevel, zoomMode) && (side === "left" || side === "right")) {
      return view.pan?.(side === "left" ? -panDistance : panDistance, 0);
    }
    if (hasVerticalPanning(view, zoomLevel, zoomMode) && (side === "up" || side === "down")) {
      return view.pan?.(0, side === "up" ? -panDistance : panDistance);
    }
    return side === "left" || side === "up" ? view.prev() : view.next();
  }

  return side === "left" || side === "up" ? view.prev() : view.next();
};
