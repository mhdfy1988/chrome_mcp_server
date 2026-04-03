import { normalizeDomWhitespace } from "./dom-metadata.js";

export interface SelectorBuildOptions {
  preferClasses?: boolean;
}

export function escapeSelector(value: string): string {
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

export function quoteAttribute(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function isUniqueSelector(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

export function buildPathSelector(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    const htmlElement = current as HTMLElement;
    const tag = current.tagName.toLowerCase();
    const currentTagName = current.tagName;
    const id = normalizeDomWhitespace(htmlElement.id);

    if (id) {
      segments.unshift(`#${escapeSelector(id)}`);
      return segments.join(" > ");
    }

    let segment = tag;
    const classNames = Array.from(current.classList)
      .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
      .slice(0, 2);
    if (classNames.length > 0) {
      segment += classNames
        .map((className) => `.${escapeSelector(className)}`)
        .join("");
    }

    const parent: Element | null = current.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter(
        (child: Element) => child.tagName === currentTagName,
      );
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        segment += `:nth-of-type(${index})`;
      }
    }

    segments.unshift(segment);
    const candidate = segments.join(" > ");
    if (isUniqueSelector(candidate)) {
      return candidate;
    }

    current = parent;
  }

  return segments.join(" > ");
}

export function buildDomSelector(
  element: Element,
  options: SelectorBuildOptions = {},
): string {
  const htmlElement = element as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const id = normalizeDomWhitespace(htmlElement.id);
  if (id) {
    const selector = `#${escapeSelector(id)}`;
    if (isUniqueSelector(selector)) {
      return selector;
    }
  }

  const role = normalizeDomWhitespace(element.getAttribute("role"));
  if (role) {
    const selector = `${tag}[role=${quoteAttribute(role)}]`;
    if (isUniqueSelector(selector)) {
      return selector;
    }
  }

  const name = normalizeDomWhitespace(element.getAttribute("name"));
  if (name) {
    const selector = `${tag}[name=${quoteAttribute(name)}]`;
    if (isUniqueSelector(selector)) {
      return selector;
    }
  }

  const ariaLabel = normalizeDomWhitespace(element.getAttribute("aria-label"));
  if (ariaLabel) {
    const selector = `${tag}[aria-label=${quoteAttribute(ariaLabel)}]`;
    if (isUniqueSelector(selector)) {
      return selector;
    }
  }

  const placeholder = normalizeDomWhitespace(
    element.getAttribute("placeholder"),
  );
  if (placeholder) {
    const selector = `${tag}[placeholder=${quoteAttribute(placeholder)}]`;
    if (isUniqueSelector(selector)) {
      return selector;
    }
  }

  if (element instanceof HTMLInputElement) {
    const type = normalizeDomWhitespace(element.type);
    if (type && name) {
      const selector = `${tag}[type=${quoteAttribute(type)}][name=${quoteAttribute(name)}]`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }

    if (type) {
      const selector = `${tag}[type=${quoteAttribute(type)}]`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }
  }

  if (element instanceof HTMLAnchorElement) {
    const href = normalizeDomWhitespace(element.getAttribute("href"));
    if (href) {
      const selector = `a[href=${quoteAttribute(href)}]`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }
  }

  if (options.preferClasses) {
    const classNames = Array.from(htmlElement.classList)
      .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
      .slice(0, 3);
    if (classNames.length > 0) {
      const selector = `${tag}.${classNames
        .map((className) => escapeSelector(className))
        .join(".")}`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }
  }

  return buildPathSelector(element);
}
