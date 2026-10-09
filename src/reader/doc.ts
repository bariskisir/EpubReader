// Readest'in yüklenen bölüm belgelerine uyguladığı düzeltmeler.
// Kaynak: readest/apps/readest-app/src/utils/style.ts (doc fix-up bölümleri)

import { LINK_HIT_AREA_CLASS } from "./types";

export const MAX_ENLARGED_LINKS = 1000;

export const applyThemeModeClass = (document: Document, isDarkMode: boolean) => {
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add(isDarkMode ? "theme-dark" : "theme-light");
};

export const applyScrollModeClass = (document: Document, isScrollMode: boolean) => {
  document.body.classList.remove("scroll-mode", "paginated-mode");
  document.body.classList.add(isScrollMode ? "scroll-mode" : "paginated-mode");
};

const PREFIXED_ATTR_REGEX = /^([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)$/;
const EPUB_OPS_NAMESPACE = "http://www.idpf.org/2007/ops";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

export const applyNamespacedAttributes = (document: Document) => {
  const lookupNamespace = (element: Element, prefix: string) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const uri = node.getAttribute(`xmlns:${prefix}`);
      if (uri) return uri;
    }
    return null;
  };
  for (const element of document.querySelectorAll("*")) {
    for (const { name, value } of Array.from(element.attributes)) {
      const [, prefix, localName] = PREFIXED_ATTR_REGEX.exec(name) ?? [];
      if (!prefix) continue;
      const uri =
        prefix === "xml"
          ? XML_NAMESPACE
          : (lookupNamespace(element, prefix) ?? (prefix === "epub" ? EPUB_OPS_NAMESPACE : null));
      if (uri && !element.hasAttributeNS(uri, localName!)) {
        element.setAttributeNS(uri, name, value);
      }
    }
  }
};

export const applyImageStyle = (document: Document) => {
  const win = document.defaultView ?? window;
  const plans = Array.from(document.querySelectorAll("img")).map((img) => {
    const widthAttr = img.getAttribute("width");
    const percentWidth =
      widthAttr && (widthAttr.endsWith("%") || widthAttr.endsWith("vw"))
        ? parseFloat(widthAttr)
        : NaN;
    const heightAttr = img.getAttribute("height");
    const percentHeight =
      heightAttr && (heightAttr.endsWith("%") || heightAttr.endsWith("vh"))
        ? parseFloat(heightAttr)
        : NaN;
    const noEnlarge = img.getAttribute("zy-enlarge-src") === "none";

    let inlineWithText = false;
    let keepBaseline = false;
    const parent = img.parentNode;
    if (parent && parent.nodeType === Node.ELEMENT_NODE) {
      const childNodes = Array.from(parent.childNodes);
      const hasTextSiblings = childNodes.some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
      );
      const isInline = childNodes.every(
        (node) => node.nodeType !== Node.ELEMENT_NODE || (node as Element).tagName !== "BR"
      );
      inlineWithText = hasTextSiblings && isInline;
      if (inlineWithText) {
        const valign = win.getComputedStyle(img).verticalAlign;
        keepBaseline = valign === "" || valign === "baseline";
      }
    }
    return { img, percentWidth, percentHeight, inlineWithText, keepBaseline, noEnlarge };
  });

  for (const { img, percentWidth, percentHeight, inlineWithText, keepBaseline, noEnlarge } of plans) {
    if (!isNaN(percentWidth)) {
      img.style.width = `${(percentWidth / 100) * window.innerWidth}px`;
      img.removeAttribute("width");
    }
    if (!isNaN(percentHeight)) {
      img.style.height = `${(percentHeight / 100) * window.innerHeight}px`;
      img.removeAttribute("height");
    }
    if (inlineWithText) {
      img.classList.add("has-text-siblings");
      if (keepBaseline) img.classList.add("has-text-siblings-baseline");
    }
    if (noEnlarge) {
      img.style.setProperty("pointer-events", "none");
    }
  }
  document.querySelectorAll("hr").forEach((hr) => {
    const computedStyle = window.getComputedStyle(hr);
    if (computedStyle.backgroundImage && computedStyle.backgroundImage !== "none") {
      hr.classList.add("background-img");
    }
  });
};

export const applyLinkHitArea = (document: Document) => {
  if (document.links.length <= MAX_ENLARGED_LINKS) {
    document.documentElement.classList.add(LINK_HIT_AREA_CLASS);
  }
};
