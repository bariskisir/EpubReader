// Gerçek sayfa sayısı hesabı.
//
// Foliate'in `location` sayacı (footer'daki "1 / 579") yalnızca metin
// boyutundan türetilen sabit bir tahmindir ve font değişince değişmez.
// Burada bölümlerin gerçek, yeniden akıtılmış (reflowed) sayfa sayıları
// toplanır: her bölüm görünür boyutta ayrı ayrı sayfalanır ve
// `renderer.pages` (o bölümün ekranda kaç sayfa tuttuğu) okunur.

export interface PageCounterRenderer {
  goTo(params: { index: number }): Promise<void>;
  /** Yüklü bölümler, indeks sırasına göre. */
  getContents(): { doc: Document; index: number }[];
  /** Ekranda görünen bölümün indeksi. */
  primaryIndex: number;
  /** Şu an gösterilen sayfanın şerit içindeki indeksi. */
  page: number;
  /** Birincil bölümün ekranda kaç sayfa tuttuğu. */
  pages: number;
}

export interface PageCounterView {
  renderer: PageCounterRenderer;
  book: { sections: { linear?: string }[] } | null;
}

export type PageTable = number[];

/**
 * Tüm okunabilir bölümleri sırayla sayfalar ve bölüm başına sayfa sayısını
 * döndürür. `shouldContinue` false dönerse yarım tabloyla çıkar.
 */
export async function buildPageTable(
  view: PageCounterView,
  shouldContinue: () => boolean,
  onProgress?: (counted: number, total: number) => void
): Promise<PageTable> {
  const sections = view.book?.sections ?? [];
  const table: PageTable = new Array(sections.length).fill(0);
  const readable = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.linear !== "no");
  let counted = 0;

  for (const { index } of readable) {
    if (!shouldContinue()) {
      return table;
    }
    try {
      await view.renderer.goTo({ index });
    } catch {
      // Bu bölüm açılamadı; tek sayfa say ve devam et.
      table[index] = 1;
      counted += 1;
      onProgress?.(counted, readable.length);
      continue;
    }
    if (!shouldContinue()) {
      return table;
    }
    table[index] = Math.max(1, Math.round(view.renderer.pages || 0));
    counted += 1;
    onProgress?.(counted, readable.length);
    // Arayüzün nefes alması için olay döngüsüne bırak.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return table;
}

/** Tablodaki toplam gerçek sayfa sayısı. */
export function totalPages(table: PageTable | null): number {
  if (!table) {
    return 0;
  }
  return table.reduce((sum, count) => sum + count, 0);
}

/**
 * Görünür okuyucudaki sayfanın kitap genelindeki gerçek numarası.
 * `renderer.page` yalnızca yüklü bölümlerden oluşan şerit içinde sayılır;
 * şeridin başındaki bölümden primere kadar olan sayfalar tabloyla eklenir.
 */
export function currentPageNumber(
  renderer: PageCounterRenderer,
  table: PageTable | null
): number | null {
  if (!table) {
    return null;
  }
  const contents = renderer.getContents?.() ?? [];
  const primaryIndex = renderer.primaryIndex;
  if (!Number.isFinite(primaryIndex) || primaryIndex < 0) {
    return null;
  }

  let stripStart = primaryIndex;
  for (const content of contents) {
    if (content.index < stripStart) {
      stripStart = content.index;
    }
  }

  let offset = 0;
  for (let index = stripStart; index < primaryIndex; index += 1) {
    offset += table[index] ?? 0;
  }

  const page = offset + renderer.page + 1;
  const total = totalPages(table);
  if (total <= 0) {
    return null;
  }
  return Math.min(total, Math.max(1, page));
}