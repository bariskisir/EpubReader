// Readest'in okuyucu stil motoru.
// Kaynak: readest/apps/readest-app/src/utils/style.ts
//
// Readest'in `getStyles` ve `transformStylesheet` fonksiyonlarından taşındı.
// Uygulamamızda olmayan özellikler (çeviri, warichu, ruby, özel fontlar,
// arka plan dokusu, e-ink) çıkarıldı; okuma görünümünü belirleyen
// font / paragraf / sayfa / renk bölümleri birebir korundu.

import {
  buildFontFamilyLists,
  getBaseFontSize,
  type ReaderThemeCode,
  type ViewSettings
} from "./settings";
import {
  INLINE_FORMATTING_SELECTOR,
  SCROLL_WRAPPER_CLASS,
  SCROLL_WRAPPER_FIT_CLASS,
  LINK_HIT_AREA_CLASS
} from "./types";

const getFontStyles = (
  serif: string,
  sansSerif: string,
  monospace: string,
  defaultFont: string,
  defaultCJKFont: string,
  fontSize: number,
  minFontSize: number,
  fontWeight: number,
  overrideFont: boolean
) => {
  const families = buildFontFamilyLists(serif, sansSerif, monospace, defaultCJKFont);
  const defaultFontFamily = defaultFont.toLowerCase() === "serif" ? "--serif" : "--sans-serif";
  const bodyFontSizeOverride = `
    p, li, div, pre, dd {
      font-size: max(1rem, var(--min-font-size, 8px)) !important;
    }
  `;
  return `
    html {
      --serif: ${families.serif};
      --sans-serif: ${families.sansSerif};
      --monospace: ${families.monospace};
      --font-size: ${fontSize}px;
      --min-font-size: ${minFontSize}px;
      --font-weight: ${fontWeight};
    }
    html, body {
      font-size: ${fontSize}px !important;
      font-weight: ${fontWeight};
      -webkit-text-size-adjust: none;
      text-size-adjust: none;
    }
    :where(html) {
      font-family: var(${defaultFontFamily}) ${overrideFont ? "!important" : ""};
    }
    html body {
      ${overrideFont ? `font-family: var(${defaultFontFamily}) !important;` : ""}
    }
    font[size="1"] { font-size: ${minFontSize}px; }
    font[size="2"] { font-size: ${minFontSize * 1.5}px; }
    font[size="3"] { font-size: ${fontSize}px; }
    font[size="4"] { font-size: ${fontSize * 1.2}px; }
    font[size="5"] { font-size: ${fontSize * 1.5}px; }
    font[size="6"] { font-size: ${fontSize * 2}px; }
    font[size="7"] { font-size: ${fontSize * 3}px; }
    [style*="font-size: 16px"], [style*="font-size:16px"] {
      font-size: 1rem !important;
    }
    ${overrideFont ? "html body :is(pre, code, kbd)" : ":where(pre, code, kbd)"} {
      font-family: var(--monospace) ${overrideFont ? "!important" : ""};
      font-variant-ligatures: none;
    }
    body *:not(pre, code, kbd, .code):not(pre *, code *, kbd *, .code *) {
      ${overrideFont ? "font-family: revert !important;" : ""}
    }
    ${overrideFont ? bodyFontSizeOverride : ""}
  `;
};

const getPageLayoutStyles = (
  marginTop: number,
  marginRight: number,
  marginBottom: number,
  marginLeft: number,
  zoomLevel: number,
  writingMode: string,
  vertical: boolean
) => `
  html {
    --margin-top: ${marginTop}px;
    --margin-right: ${marginRight}px;
    --margin-bottom: ${marginBottom}px;
    --margin-left: ${marginLeft}px;
  }
  html, body {
    ${writingMode === "auto" ? "" : `writing-mode: ${writingMode} !important;`}
    max-height: unset;
    -webkit-touch-callout: none;
    -webkit-user-select: text;
  }
  body {
    overflow: unset;
    zoom: ${zoomLevel};
    padding: unset;
    margin: unset;
  }
  img {
    -webkit-touch-callout: none;
    -webkit-user-drag: none;
  }
  svg:where(:not([width])), img:where(:not([width])) { width: auto; }
  svg:where(:not([height])), img:where(:not([height])) { height: auto; }
  figure > div:has(img) { height: auto !important; }
  html.${LINK_HIT_AREA_CLASS} a { position: relative !important; }
  html.${LINK_HIT_AREA_CLASS} a::before {
    content: '';
    position: absolute;
    inset: -10px;
  }

  .${SCROLL_WRAPPER_CLASS} {
    display: block;
    overflow: auto;
    max-width: 100%;
    touch-action: pan-x pan-y;
    scrollbar-width: thin;
    -webkit-overflow-scrolling: touch;
  }
  .${SCROLL_WRAPPER_FIT_CLASS} { overflow: visible; }
  .${SCROLL_WRAPPER_CLASS} > table {
    display: table !important;
    max-width: 100%;
  }
  body.paginated-mode .${SCROLL_WRAPPER_CLASS}:not(.${SCROLL_WRAPPER_FIT_CLASS}) {
    max-height: calc(var(--available-height) * 1px);
  }
  pre, code {
    white-space: pre-wrap !important;
    scrollbar-width: none;
  }
  math {
    overflow: auto;
    scrollbar-width: none;
    max-height: calc(var(--available-height) * 1px);
  }
  table, math { max-width: calc(var(--available-width) * 1px); }

  .epubtype-footnote,
  aside[epub|type~="endnote"],
  aside[epub|type~="footnote"],
  aside[epub|type~="note"],
  aside[epub|type~="rearnote"] {
    display: none;
  }
  .duokan-footnote-content,
  .duokan-footnote-item { display: none; }
  .duokan-image-gallery-cell { height: calc(var(--available-height) * 1px); }
  .duokan-image-gallery-cell img { height: 90%; }
  div:has(> img, > svg) { max-width: 100% !important; }
  body.paginated-mode td:has(img), body.paginated-mode td :has(img) {
    max-height: calc(var(--available-height) * 0.8 * 1px);
  }
  figure.code { overflow: unset !important; }
  p { display: block; }
  .ie6 img { width: unset; height: unset; }
  sup img { height: 1em; }
  img.has-text-siblings { ${vertical ? "width: 1em;" : "height: 1em;"} }
  img.has-text-siblings-baseline { vertical-align: baseline; }
  :is(div) > img.has-text-siblings[style*="object-fit"] {
    display: block;
    height: auto;
    vertical-align: unset;
  }
  .duokan-footnote img:not([class]) { width: 0.8em; height: 0.8em; }
  div:has(img.singlepage) { position: relative; width: auto; height: auto; }
  p[width][height] > img:only-child { width: unset !important; height: unset !important; }

  body.paginated-mode div[style*="page-break-after: always"],
  body.paginated-mode div[style*="page-break-after:always"],
  body.paginated-mode p[style*="page-break-after: always"],
  body.paginated-mode p[style*="page-break-after:always"] {
    margin-bottom: calc(var(--available-height) * 1px);
  }
  .br { display: flow-root; }
  .h5_mainbody { overflow: unset !important; }
`;

const getParagraphLayoutStyles = (
  overrideLayout: boolean,
  paragraphMargin: number,
  lineSpacing: number,
  wordSpacing: number,
  letterSpacing: number,
  textIndent: number,
  justify: boolean,
  hyphenate: boolean,
  vertical: boolean
) => `
  html {
    --default-text-align: ${justify ? "justify" : "start"};
    hanging-punctuation: allow-end last;
    orphans: 2;
    widows: 2;
  }
  html, body { text-align: var(--default-text-align); }
  ${justify ? "html, body, p, li, blockquote, dd { text-wrap-style: auto !important; }" : ""}
  [align="left"] { text-align: left; }
  [align="right"] { text-align: right; }
  [align="center"] { text-align: center; }
  [align="justify"] { text-align: justify; }
  body { line-height: unset; }
  :is(hgroup, header) p { text-align: unset; hyphens: unset; }
  p, blockquote, dd, div:not(:has(*:not(${INLINE_FORMATTING_SELECTOR}))) {
    line-height: ${lineSpacing} ${overrideLayout ? "!important" : ""};
    word-spacing: ${wordSpacing}px ${overrideLayout ? "!important" : ""};
    letter-spacing: ${letterSpacing}px ${overrideLayout ? "!important" : ""};
    text-indent: ${textIndent}em ${overrideLayout ? "!important" : ""};
    -webkit-hyphens: ${hyphenate ? "auto" : "manual"} ${overrideLayout ? "!important" : ""};
    hyphens: ${hyphenate ? "auto" : "manual"} ${overrideLayout ? "!important" : ""};
    -webkit-hyphenate-limit-before: 3;
    -webkit-hyphenate-limit-after: 2;
    -webkit-hyphenate-limit-lines: 2;
    hanging-punctuation: allow-end last;
    widows: 2;
  }
  li {
    line-height: ${lineSpacing} ${overrideLayout ? "!important" : ""};
    -webkit-hyphens: ${hyphenate ? "auto" : "manual"} ${overrideLayout ? "!important" : ""};
    hyphens: ${hyphenate ? "auto" : "manual"} ${overrideLayout ? "!important" : ""};
  }
  p.aligned-center, blockquote.aligned-center,
  dd.aligned-center, div.aligned-center { text-align: center ${overrideLayout ? "!important" : ""}; }
  p.aligned-left, blockquote.aligned-left,
  dd.aligned-left, div.aligned-left { ${justify && overrideLayout ? "text-align: justify !important;" : ""} }
  p.aligned-right, blockquote.aligned-right,
  dd.aligned-right, div.aligned-right { text-align: right ${overrideLayout ? "!important" : ""}; }
  p.aligned-justify, blockquote.aligned-justify,
  dd.aligned-justify, div.aligned-justify { ${!justify && overrideLayout ? "text-align: initial !important;" : ""} };
  p:has(> img:only-child), p:has(> span:only-child > img:only-child),
  p:has(> a:only-child > img:only-child),
  p:has(> span:only-child > a:only-child > img:only-child),
  p:has(> img:not(.has-text-siblings)),
  p:has(> a:first-child + img:last-child) { text-indent: initial !important; }
  blockquote[align="center"], div[align="center"],
  p[align="center"], dd[align="center"],
  p.aligned-center, blockquote.aligned-center,
  dd.aligned-center, div.aligned-center,
  li p, ol p, ul p, td p { text-indent: initial !important; }
  p {
    ${vertical ? `margin-left: ${paragraphMargin}em ${overrideLayout ? "!important" : ""};` : ""}
    ${vertical ? `margin-right: ${paragraphMargin}em ${overrideLayout ? "!important" : ""};` : ""}
    ${vertical ? `margin-top: unset ${overrideLayout ? "!important" : ""};` : ""}
    ${vertical ? `margin-bottom: unset ${overrideLayout ? "!important" : ""};` : ""}
    ${!vertical ? `margin-top: ${paragraphMargin}em ${overrideLayout ? "!important" : ""};` : ""}
    ${!vertical ? `margin-bottom: ${paragraphMargin}em ${overrideLayout ? "!important" : ""};` : ""}
    ${!vertical ? `margin-left: unset ${overrideLayout ? "!important" : ""};` : ""}
    ${!vertical ? `margin-right: unset ${overrideLayout ? "!important" : ""};` : ""}
  }
  div {
    ${vertical && overrideLayout ? `margin-left: ${paragraphMargin}em !important;` : ""}
    ${vertical && overrideLayout ? `margin-right: ${paragraphMargin}em !important;` : ""}
    ${!vertical && overrideLayout ? `margin-top: ${paragraphMargin}em !important;` : ""}
    ${!vertical && overrideLayout ? `margin-bottom: ${paragraphMargin}em !important;` : ""}
  }
  p > font:only-child { display: flow-root; }
  :lang(zh), :lang(ja), :lang(ko) { widows: 1; orphans: 1; }
  div.left *, p.left * { text-align: left; }
  div.right *, p.right * { text-align: right; }
  div.center *, p.center * { text-align: center; }
  div.justify *, p.justify * { text-align: justify; }
  img.pi {
    ${vertical ? "transform: rotate(90deg);" : ""}
    ${vertical ? "transform-origin: center;" : ""}
    ${vertical ? "height: 2em;" : ""}
    ${vertical ? `width: ${lineSpacing}em;` : ""}
    ${vertical ? "vertical-align: unset;" : ""}
  }
  .nonindent, .noindent { text-indent: unset !important; }
`;

const getColorStyles = (
  overrideColor: boolean,
  invertImgColorInDark: boolean,
  themeCode: ReaderThemeCode
) => {
  const { bg, fg, primary, isDarkMode } = themeCode;
  return `
    html {
      --theme-bg-color: ${bg};
      --theme-fg-color: ${fg};
      --theme-primary-color: ${primary};
      --override-color: ${overrideColor};
      color-scheme: ${isDarkMode ? "dark" : "light"};
    }
    html, body { color: ${fg}; }
    ${
      isDarkMode
        ? `::selection { background: color-mix(in srgb, ${primary} 40%, transparent); }`
        : ""
    }
    html { background-color: var(--theme-bg-color, transparent); }
    section, aside, blockquote, article, nav, header, footer, main, figure,
    div, p, font, h1, h2, h3, h4, h5, h6, li, span {
      ${overrideColor ? `background-color: ${bg} !important;` : ""}
      ${overrideColor ? `color: ${fg} !important;` : ""}
      ${overrideColor ? `border-color: ${fg} !important;` : ""}
    }
    pre, span { ${overrideColor ? `background-color: ${bg} !important;` : ""} }
    a:any-link {
      color: ${overrideColor ? primary : isDarkMode ? "lightblue" : ""} ${overrideColor ? "!important" : ""};
      text-decoration: none;
    }
    img {
      ${isDarkMode && invertImgColorInDark ? "filter: invert(100%);" : ""}
      ${isDarkMode && !invertImgColorInDark && overrideColor ? "filter: grayscale(100%) contrast(1.2) brightness(1.2);" : ""}
      ${overrideColor && !(isDarkMode && invertImgColorInDark) ? "mix-blend-mode: multiply;" : ""}
    }
    svg, img { ${overrideColor ? "background-color: transparent !important;" : ""}; }
    td, th { overflow-wrap: break-word; }
    body.theme-dark code {
      ${isDarkMode ? `color: ${fg}cc;` : ""}
      ${isDarkMode ? `background-color: color-mix(in srgb, ${bg} 90%, #000);` : ""}
    }
    blockquote { ${isDarkMode ? `background-color: color-mix(in srgb, ${bg} 80%, #000);` : ""} }
    blockquote, table * {
      ${isDarkMode && overrideColor ? `background-color: color-mix(in srgb, ${bg} 80%, #000);` : ""}
    }
    font[color="#000000"], font[color="#000"], font[color="black"],
    *[style*="color: rgb(0,0,0)"], *[style*="color: rgb(0, 0, 0)"],
    *[style*="color: #000"], *[style*="color: #000000"], *[style*="color: black"] {
      color: ${fg} !important;
    }
    ${
      isDarkMode && !overrideColor
        ? `*[style*="background-color: #fff"], *[style*="background-color:#fff"],
           *[style*="background-color: #ffffff"], *[style*="background-color:#ffffff"],
           *[style*="background-color: white"], *[style*="background-color:white"] {
             background-color: ${bg} !important;
           }
           body.theme-dark { background-color: transparent !important; }`
        : ""
    }
    #pg-header * { color: inherit !important; }
    .x-ebookmaker, .x-ebookmaker-cover, .x-ebookmaker-coverpage { background-color: unset !important; }
    .chapterHeader, .chapterHeader * {
      border-color: unset;
      background-color: ${bg} !important;
    }
    .calibre { color: unset; background-color: unset; }
  `;
};

/** Readest: utils/style.ts getStyles (okuma görünümü bölümleri) */
export const getStyles = (viewSettings: ViewSettings, themeCode: ReaderThemeCode): string => {
  const pageLayoutStyles = getPageLayoutStyles(
    viewSettings.marginTopPx,
    viewSettings.marginRightPx,
    viewSettings.marginBottomPx,
    viewSettings.marginLeftPx,
    1.0,
    viewSettings.writingMode,
    viewSettings.vertical
  );
  const paragraphLayoutStyles = viewSettings.useBookLayout
    ? ""
    : getParagraphLayoutStyles(
        viewSettings.overrideLayout,
        viewSettings.paragraphMargin,
        viewSettings.lineHeight,
        viewSettings.wordSpacing,
        viewSettings.letterSpacing,
        viewSettings.textIndent,
        viewSettings.fullJustification,
        viewSettings.hyphenation,
        viewSettings.vertical
      );
  const fontStyles = getFontStyles(
    viewSettings.serifFont,
    viewSettings.sansSerifFont,
    viewSettings.monospaceFont,
    viewSettings.defaultFont,
    viewSettings.defaultCJKFont,
    getBaseFontSize(viewSettings),
    viewSettings.minimumFontSize,
    viewSettings.fontWeight,
    viewSettings.overrideFont
  );
  const colorStyles = getColorStyles(
    viewSettings.overrideColor,
    viewSettings.invertImgColorInDark,
    themeCode
  );
  const epubNamespace = `@namespace epub "http://www.idpf.org/2007/ops";`;
  return `${epubNamespace}\n${pageLayoutStyles}\n${paragraphLayoutStyles}\n${fontStyles}\n${colorStyles}`;
};

/**
 * Readest: utils/style.ts transformStylesheet (EPUB yayıncı CSS düzeltmeleri).
 * Fixed-layout sayfalar olduğu gibi bırakılır.
 */
export const transformStylesheet = (
  css: string,
  vertical: boolean,
  isFixedLayout = false
): string => {
  if (isFixedLayout) return css;

  const isInlineStyle = !css.includes("{");
  const ruleRegex = /([^{]+)({[^}]+})/g;
  css = css.replace(ruleRegex, (match, selector, block) => {
    const hasTextAlignCenter = /text-align\s*:\s*center\s*[;$]/.test(block);
    const hasTextIndentZero = /text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?\s*[;$]/.test(block);
    if (hasTextAlignCenter && hasTextIndentZero) {
      block = block.replace(/(text-align\s*:\s*center)(\s*;|\s*$)/g, "$1 !important$2");
      block = block.replace(
        /(text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?)(\s*;|\s*$)/g,
        "$1 !important$2"
      );
      return selector + block;
    }
    return match;
  });

  css = css.replace(ruleRegex, (match, selector, block) => {
    const hasWhiteSpaceNowrap = /white-space\s*:\s*nowrap\s*[;$]/.test(block);
    if (hasWhiteSpaceNowrap) {
      if (!/overflow\s*:/.test(block)) {
        block = block.replace(/}$/, " overflow: clip !important; }");
      }
      return selector + block;
    }
    return match;
  });

  if (isInlineStyle) {
    const hasPageBreakAfterAlways = /page-break-after\s*:\s*always\s*[;]?/.test(css);
    if (hasPageBreakAfterAlways && !/margin-bottom\s*:/.test(css)) {
      css = css.replace(/;?\s*$/, "") + "; margin-bottom: calc(var(--available-height) * 1px)";
    }
  } else {
    css = css.replace(ruleRegex, (match, selector, block) => {
      const hasPageBreakAfterAlways = /page-break-after\s*:\s*always\s*[;$]/.test(block);
      if (hasPageBreakAfterAlways) {
        if (!/margin-bottom\s*:/.test(block)) {
          block = block.replace(/}$/, " margin-bottom: calc(var(--available-height) * 1px); }");
        }
        return selector + block;
      }
      return match;
    });
  }

  // duokan-bleed
  css = css.replace(ruleRegex, (_, selector, block) => {
    if (vertical) return selector + block;
    const directions: string[] = [];
    let hasBleed = false;
    for (const dir of ["top", "bottom", "left", "right"]) {
      const bleedRegex = new RegExp(`duokan-bleed\\s*:\\s*[^;]*${dir}[^;]*;`);
      const marginRegex = new RegExp(`margin-${dir}\\s*:`);
      if (bleedRegex.test(block) && !marginRegex.test(block)) {
        hasBleed = true;
        directions.push(dir);
        block = block.replace(
          /}$/,
          ` margin-${dir}: calc(-1 * var(--page-margin-${dir})) !important; }`
        );
      }
    }
    if (hasBleed) {
      if (!/position\s*:/.test(block)) block = block.replace(/}$/, " position: relative !important; }");
      if (!/overflow\s*:/.test(block)) block = block.replace(/}$/, " overflow: hidden !important; }");
      if (!/display\s*:/.test(block)) block = block.replace(/}$/, " display: flow-root !important; }");
      if (directions.includes("left") && directions.includes("right")) {
        block = block
          .replace(/}$/, " width: calc(var(--full-width) * 1px) !important; }")
          .replace(/}$/, " min-width: calc(var(--full-width) * 1px) !important; }")
          .replace(/}$/, " max-width: calc(var(--full-width) * 1px) !important; }");
      }
      if (directions.includes("top") && directions.includes("bottom")) {
        block = block
          .replace(/}$/, " height: calc(var(--full-height) * 1px) !important; }")
          .replace(/}$/, " min-height: calc(var(--full-height) * 1px) !important; }")
          .replace(/}$/, " max-height: calc(var(--full-height) * 1px) !important; }");
      }
    }
    return selector + block;
  });

  // body font-family: serif/sans-serif -> unset
  css = css.replace(ruleRegex, (_, selector, block) => {
    if (/\bbody\b/i.test(selector)) {
      if (/font-family\s*:\s*serif\s*(?:;|\}|$)/.test(block)) {
        block = block.replace(/font-family\s*:\s*serif\s*(;|\}|$)/gi, "font-family: unset$1");
      }
      if (/font-family\s*:\s*sans-serif\s*(?:;|\}|$)/.test(block)) {
        block = block.replace(/font-family\s*:\s*sans-serif\s*(;|\}|$)/gi, "font-family: unset$1");
      }
    }
    return selector + block;
  });

  return css;
};
