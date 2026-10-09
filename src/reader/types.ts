export interface ThemeBaseColor {
  bg: string;
  fg: string;
  primary: string;
}

/**
 * Readest: utils/inlineTags.ts INLINE_FORMATTING_SELECTOR (kısaltılmış).
 * Paragraf benzeri div'lerin yalnızca satır içi biçimlendirme içerdiğini
 * anlamak için kullanılır.
 */
export const INLINE_FORMATTING_SELECTOR = [
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "i",
  "img",
  "kbd",
  "mark",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr"
]
  .map((tag) => tag)
  .join(",");

export const SCROLL_WRAPPER_CLASS = "readest-scroll-wrapper";
export const SCROLL_WRAPPER_FIT_CLASS = "readest-scroll-wrapper-fit";
export const LINK_HIT_AREA_CLASS = "link-hit-area";
