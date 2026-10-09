// Readest'in okuma ayarları modeli ve varsayılanları.
// Kaynak: readest/apps/readest-app/src/services/constants.ts (DEFAULT_BOOK_*)
//         readest/apps/readest-app/src/utils/config.ts (max size helpers)
//
// Bu dosya Readest'ten birebir taşındı; uygulama tarafında yalnızca
// kullandığımız alanlar tutuldu.

import type { ThemeBaseColor } from "./types";

export const SERIF_FONTS = [
  "Bitter",
  "Literata",
  "Merriweather",
  "Roboto Slab",
  "Vollkorn",
  "PT Serif",
  "Georgia",
  "Times New Roman"
] as const;

export const CJK_SERIF_FONTS = [
  "LXGW WenKai GB Screen",
  "LXGW WenKai TC",
  "GuanKiapTsingKhai-T",
  "Source Han Serif CN",
  "Huiwen-MinchoGBK",
  "KingHwa_OldSong"
] as const;

export const CJK_SANS_SERIF_FONTS = ["Noto Sans SC", "Noto Sans TC"] as const;

export const SANS_SERIF_FONTS = ["Roboto", "Noto Sans", "Open Sans", "PT Sans", "Helvetica"] as const;

export const MONOSPACE_FONTS = [
  "Fira Code",
  "Consolas",
  "Courier New",
  "Lucida Console",
  "PT Mono"
] as const;

export const FALLBACK_FONTS = ["MiSans L3"] as const;

export type DefaultFont = "Serif" | "Sans-serif";
export type SpreadMode = "auto" | "none";
export type WritingMode = "auto" | "horizontal-tb" | "vertical-rl" | "vertical-lr";

export interface ViewSettings {
  // Font
  serifFont: string;
  sansSerifFont: string;
  monospaceFont: string;
  defaultFont: DefaultFont;
  defaultCJKFont: string;
  defaultFontSize: number;
  minimumFontSize: number;
  fontWeight: number;

  // Layout
  marginTopPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  marginRightPx: number;
  gapPercent: number;
  columnGapPx: number;
  maxColumnCount: number;
  maxInlineSize: number;
  maxBlockSize: number;
  writingMode: WritingMode;
  vertical: boolean;
  rtl: boolean;
  spreadMode: SpreadMode;
  keepCoverSpread: boolean;
  animated: boolean;

  // Paragraph
  paragraphMargin: number;
  lineHeight: number;
  wordSpacing: number;
  letterSpacing: number;
  textIndent: number;
  fullJustification: boolean;
  hyphenation: boolean;

  // Overrides
  overrideFont: boolean;
  overrideLayout: boolean;
  overrideColor: boolean;
  useBookLayout: boolean;
  invertImgColorInDark: boolean;
}

/** Readest: utils/config.ts getDefaultMaxInlineSize */
export function getDefaultMaxInlineSize(): number {
  if (typeof window === "undefined") {
    return 720;
  }
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  return screenWidth < screenHeight ? Math.max(screenWidth, 720) : 720;
}

/** Readest: utils/config.ts getDefaultMaxBlockSize */
export function getDefaultMaxBlockSize(): number {
  if (typeof window === "undefined") {
    return 1440;
  }
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  return Math.max(screenWidth, screenHeight, 1440);
}

/** Readest: utils/config.ts getMaxInlineSize */
export function getMaxInlineSize(viewSettings: ViewSettings): number {
  const isVertical = viewSettings.vertical;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const screenAspectRatio = isVertical ? screenHeight / screenWidth : screenWidth / screenHeight;
  const isUnfoldedScreen =
    screenAspectRatio < 1.3 && screenAspectRatio > 0.77 && screenWidth > 600;
  return isVertical
    ? Math.max(screenWidth, screenHeight, 720, viewSettings.maxInlineSize)
    : isUnfoldedScreen
      ? viewSettings.maxInlineSize * 0.8
      : viewSettings.maxInlineSize;
}

/**
 * Readest: utils/style.ts getBaseFontSize
 * Cihaz bazlı ölçekleme; web'de fontScale = 1.
 */
export function getBaseFontSize(viewSettings: ViewSettings): number {
  const zoomScale = 1.0;
  return viewSettings.defaultFontSize * zoomScale;
}

/** Readest: services/constants.ts DEFAULT_BOOK_FONT + LAYOUT + STYLE birleşimi */
export function getDefaultViewSettings(): ViewSettings {
  return {
    serifFont: "Bitter",
    sansSerifFont: "Roboto",
    monospaceFont: "Consolas",
    defaultFont: "Serif",
    defaultCJKFont: "LXGW WenKai GB Screen",
    defaultFontSize: 16,
    minimumFontSize: 8,
    fontWeight: 400,

    marginTopPx: 44,
    marginBottomPx: 44,
    marginLeftPx: 16,
    marginRightPx: 16,
    gapPercent: 5,
    columnGapPx: 0,
    maxColumnCount: 2,
    maxInlineSize: getDefaultMaxInlineSize(),
    maxBlockSize: getDefaultMaxBlockSize(),
    writingMode: "auto",
    vertical: false,
    rtl: false,
    spreadMode: "auto",
    keepCoverSpread: true,
    animated: true,

    paragraphMargin: 0.6,
    lineHeight: 1.4,
    wordSpacing: 0,
    letterSpacing: 0,
    textIndent: 0,
    fullJustification: true,
    hyphenation: true,

    overrideFont: false,
    overrideLayout: false,
    overrideColor: false,
    useBookLayout: false,
    invertImgColorInDark: false
  };
}

export function buildFontFamilyLists(
  serif: string,
  sansSerif: string,
  monospace: string,
  defaultCJKFont: string
): { serif: string; sansSerif: string; monospace: string } {
  const lastSerifFonts = ["Georgia", "Times New Roman"];
  const serifFonts = [
    serif,
    ...(defaultCJKFont !== serif ? [defaultCJKFont] : []),
    ...[...SERIF_FONTS].filter(
      (font) => font !== serif && font !== defaultCJKFont && !lastSerifFonts.includes(font)
    ),
    ...[...CJK_SERIF_FONTS].filter((font) => font !== serif && font !== defaultCJKFont),
    ...lastSerifFonts.filter(
      (font) => (SERIF_FONTS as readonly string[]).includes(font) && !lastSerifFonts.includes(defaultCJKFont)
    ),
    ...FALLBACK_FONTS
  ];
  const sansSerifFonts = [
    sansSerif,
    ...(defaultCJKFont !== sansSerif ? [defaultCJKFont] : []),
    ...[...SANS_SERIF_FONTS].filter((font) => font !== sansSerif && font !== defaultCJKFont),
    ...[...CJK_SANS_SERIF_FONTS].filter((font) => font !== sansSerif && font !== defaultCJKFont),
    ...FALLBACK_FONTS
  ];
  const monospaceFonts = [monospace, ...[...MONOSPACE_FONTS].filter((font) => font !== monospace)];
  const quote = (fonts: string[]) => fonts.map((font) => `"${font}"`).join(", ");
  return {
    serif: `${quote(serifFonts)}, serif`,
    sansSerif: `${quote(sansSerifFonts)}, sans-serif`,
    monospace: `${quote(monospaceFonts)}, monospace`
  };
}

/** Reader teması: Readest themeCode ile aynı şekil. */
export interface ReaderThemeCode {
  bg: string;
  fg: string;
  primary: string;
  isDarkMode: boolean;
}

export function themeCodeFromBase(base: ThemeBaseColor, isDarkMode: boolean): ReaderThemeCode {
  return { bg: base.bg, fg: base.fg, primary: base.primary, isDarkMode };
}
