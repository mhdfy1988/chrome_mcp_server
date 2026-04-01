import type { JSHandle, Page } from "puppeteer-core";
import type { RawSnapshotElementSummary } from "./types.js";

interface SelectorBuildOptions {
  preferClasses?: boolean;
}

interface AccessibleNameOptions {
  includeTextContent?: boolean;
}

export interface InspectionDomHelpers {
  normalizeWhitespace(value: unknown): string;
  clipText(value: string, maxLength: number): string;
  isVisible(element: Element): boolean;
  isProbablyInteractive(element: Element): boolean;
  buildSelector(element: Element, options?: SelectorBuildOptions): string;
  findAssociatedLabel(element: HTMLElement): string | undefined;
  findAriaLabelledByText(element: Element): string | undefined;
  inferImplicitRole(element: Element): string | undefined;
  findAccessibleName(
    element: Element,
    options?: AccessibleNameOptions,
  ): string | undefined;
  summarizeInteractiveElement(
    element: Element,
    index: number,
  ): RawSnapshotElementSummary;
}

export function createInspectionDomHelpers(): InspectionDomHelpers {
  const normalizeWhitespace = (value: unknown) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();

  const clipText = (value: string, maxLength: number) => {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;
  };

  const escapeSelector = (value: string) => {
    if (globalThis.CSS?.escape) {
      return globalThis.CSS.escape(value);
    }

    return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  };

  const quoteAttribute = (value: string) =>
    `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  const isVisible = (element: Element) => {
    const htmlElement = element as HTMLElement;
    if (!(htmlElement instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(htmlElement);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = htmlElement.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const interactiveRoles = new Set([
    "button",
    "link",
    "checkbox",
    "radio",
    "tab",
    "menuitem",
    "option",
    "switch",
    "combobox",
    "textbox",
    "searchbox",
  ]);

  const interactionSignalWords = [
    "btn",
    "button",
    "search",
    "submit",
    "query",
    "action",
    "click",
    "icon-search",
    "nav-search",
    "go",
    "搜索",
    "检索",
    "查找",
    "提交",
    "按钮",
  ];

  const isUniqueSelector = (selector: string) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  const buildPathSelector = (element: Element) => {
    const segments: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body && segments.length < 5) {
      const htmlElement = current as HTMLElement;
      const tag = current.tagName.toLowerCase();
      const id = normalizeWhitespace(htmlElement.id);

      if (id) {
        segments.unshift(`#${escapeSelector(id)}`);
        break;
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

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          (child) => child.tagName === current?.tagName,
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(current) + 1;
          segment += `:nth-of-type(${index})`;
        }
      }

      segments.unshift(segment);
      current = current.parentElement;
    }

    return segments.join(" > ");
  };

  const buildSelector = (
    element: Element,
    options: SelectorBuildOptions = {},
  ) => {
    const htmlElement = element as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const id = normalizeWhitespace(htmlElement.id);
    if (id) {
      const selector = `#${escapeSelector(id)}`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }

    const role = normalizeWhitespace(element.getAttribute("role"));
    if (role) {
      const selector = `${tag}[role=${quoteAttribute(role)}]`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }

    const name = normalizeWhitespace(element.getAttribute("name"));
    if (name) {
      const selector = `${tag}[name=${quoteAttribute(name)}]`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }

    const ariaLabel = normalizeWhitespace(element.getAttribute("aria-label"));
    if (ariaLabel) {
      const selector = `${tag}[aria-label=${quoteAttribute(ariaLabel)}]`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }

    const placeholder = normalizeWhitespace(element.getAttribute("placeholder"));
    if (placeholder) {
      const selector = `${tag}[placeholder=${quoteAttribute(placeholder)}]`;
      if (isUniqueSelector(selector)) {
        return selector;
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

    if (element instanceof HTMLInputElement) {
      const type = normalizeWhitespace(element.type);
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
      const href = normalizeWhitespace(element.getAttribute("href"));
      if (href) {
        const selector = `a[href=${quoteAttribute(href)}]`;
        if (isUniqueSelector(selector)) {
          return selector;
        }
      }
    }

    return buildPathSelector(element);
  };

  const findAssociatedLabel = (element: HTMLElement) => {
    const id = normalizeWhitespace(element.id);
    if (id) {
      const label = document.querySelector(`label[for=${quoteAttribute(id)}]`);
      const labelText = normalizeWhitespace(label?.textContent);
      if (labelText) {
        return labelText;
      }
    }

    const wrappingLabel = element.closest("label");
    const wrappingLabelText = normalizeWhitespace(wrappingLabel?.textContent);
    if (wrappingLabelText) {
      return wrappingLabelText;
    }

    return undefined;
  };

  const findAriaLabelledByText = (element: Element) => {
    const ariaLabelledBy = normalizeWhitespace(
      element.getAttribute("aria-labelledby"),
    );
    if (!ariaLabelledBy) {
      return undefined;
    }

    const labelText = ariaLabelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .map((labelElement) =>
        normalizeWhitespace(
          (labelElement as HTMLElement | null)?.innerText ??
            labelElement?.textContent,
        ),
      )
      .filter(Boolean)
      .join(" ");

    return labelText || undefined;
  };

  const inferImplicitRole = (element: Element) => {
    if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) {
      return "link";
    }

    if (element instanceof HTMLButtonElement) {
      return "button";
    }

    if (element instanceof HTMLInputElement) {
      const type = normalizeWhitespace(element.type).toLowerCase();
      switch (type) {
        case "button":
        case "submit":
        case "reset":
        case "image":
          return "button";
        case "checkbox":
          return "checkbox";
        case "radio":
          return "radio";
        case "range":
          return "slider";
        case "number":
          return "spinbutton";
        case "search":
          return "searchbox";
        case "email":
        case "tel":
        case "text":
        case "url":
        case "password":
        case "":
          return "textbox";
        default:
          return undefined;
      }
    }

    if (element instanceof HTMLTextAreaElement) {
      return "textbox";
    }

    if (element instanceof HTMLSelectElement) {
      return element.multiple || element.size > 1 ? "listbox" : "combobox";
    }

    if (
      element instanceof HTMLElement &&
      element.tagName.toLowerCase() === "summary"
    ) {
      return "button";
    }

    if (element instanceof HTMLElement && element.contentEditable === "true") {
      return "textbox";
    }

    return undefined;
  };

  const isProbablyInteractive = (element: Element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    const explicitRole = normalizeWhitespace(element.getAttribute("role")).toLowerCase();
    const implicitRole = inferImplicitRole(element);
    if (implicitRole || interactiveRoles.has(explicitRole)) {
      return true;
    }

    const tag = element.tagName.toLowerCase();
    if (
      tag === "a" ||
      tag === "button" ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      tag === "summary" ||
      element.contentEditable === "true"
    ) {
      return true;
    }

    const tabindex = normalizeWhitespace(element.getAttribute("tabindex"));
    if (tabindex) {
      const tabIndexValue = Number(tabindex);
      if (!Number.isNaN(tabIndexValue) && tabIndexValue >= 0) {
        return true;
      }
    }

    if (element.hasAttribute("onclick") || typeof element.onclick === "function") {
      return true;
    }

    const signalHaystack = [
      normalizeWhitespace(element.id),
      normalizeWhitespace(element.className),
      normalizeWhitespace(element.getAttribute("name")),
      normalizeWhitespace(element.getAttribute("title")),
      normalizeWhitespace(element.getAttribute("aria-label")),
      normalizeWhitespace(element.getAttribute("placeholder")),
      normalizeWhitespace(element.getAttribute("data-testid")),
      normalizeWhitespace(element.getAttribute("data-test")),
      normalizeWhitespace(element.getAttribute("data-role")),
    ]
      .join(" ")
      .toLocaleLowerCase();

    if (
      interactionSignalWords.some((keyword) => signalHaystack.includes(keyword))
    ) {
      return true;
    }

    const style = window.getComputedStyle(element);
    if (style.cursor === "pointer") {
      if (
        element.querySelector("svg") ||
        normalizeWhitespace(element.innerText ?? element.textContent) ||
        signalHaystack
      ) {
        return true;
      }
    }

    return false;
  };

  const findAccessibleName = (
    element: Element,
    options: AccessibleNameOptions = {},
  ) => {
    const ariaLabel = normalizeWhitespace(element.getAttribute("aria-label"));
    if (ariaLabel) {
      return ariaLabel;
    }

    const ariaLabelledByText = findAriaLabelledByText(element);
    if (ariaLabelledByText) {
      return ariaLabelledByText;
    }

    const associatedLabel = findAssociatedLabel(element as HTMLElement);
    if (associatedLabel) {
      return associatedLabel;
    }

    if (element instanceof HTMLInputElement) {
      const type = normalizeWhitespace(element.type).toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") {
        const value = normalizeWhitespace(element.value);
        if (value) {
          return value;
        }
      }
    }

    if (options.includeTextContent !== false) {
      const text = clipText(
        normalizeWhitespace(
          (element as HTMLElement).innerText ?? element.textContent,
        ),
        120,
      );
      if (text) {
        return text;
      }
    }

    const title = normalizeWhitespace(element.getAttribute("title"));
    if (title) {
      return title;
    }

    const placeholder = normalizeWhitespace(element.getAttribute("placeholder"));
    if (placeholder) {
      return placeholder;
    }

    const name = normalizeWhitespace(element.getAttribute("name"));
    if (name) {
      return name;
    }

    return undefined;
  };

  const summarizeInteractiveElement = (
    element: Element,
    index: number,
  ): RawSnapshotElementSummary => {
    const htmlElement = element as HTMLElement;
    const explicitRole = normalizeWhitespace(element.getAttribute("role"));
    const role = explicitRole || inferImplicitRole(element);
    const text = clipText(
      normalizeWhitespace(htmlElement.innerText ?? htmlElement.textContent),
      120,
    );
    const label = findAssociatedLabel(htmlElement);
    const accessibleName = findAccessibleName(element);
    const placeholder = normalizeWhitespace(element.getAttribute("placeholder"));
    const title = normalizeWhitespace(element.getAttribute("title"));
    const name = normalizeWhitespace(element.getAttribute("name"));
    const className = normalizeWhitespace(htmlElement.className);

    let value: string | undefined;
    let type: string | undefined;
    let checked: boolean | undefined;
    let href: string | undefined;
    let disabled = htmlElement.getAttribute("aria-disabled") === "true";

    if (element instanceof HTMLInputElement) {
      value = clipText(normalizeWhitespace(element.value), 120);
      type = normalizeWhitespace(element.type);
      checked = element.checked;
      disabled = disabled || element.disabled;
    } else if (element instanceof HTMLTextAreaElement) {
      value = clipText(normalizeWhitespace(element.value), 120);
      disabled = disabled || element.disabled;
    } else if (element instanceof HTMLSelectElement) {
      value = clipText(normalizeWhitespace(element.value), 120);
      disabled = disabled || element.disabled;
    } else if (element instanceof HTMLButtonElement) {
      disabled = disabled || element.disabled;
    } else if (element instanceof HTMLAnchorElement) {
      href = element.href;
    }

    return {
      index,
      tag: element.tagName.toLowerCase(),
      role: role || undefined,
      explicitRole: explicitRole || undefined,
      type: type || undefined,
      text: text || undefined,
      value: value || undefined,
      accessibleName,
      label,
      placeholder: placeholder || undefined,
      title: title || undefined,
      name: name || undefined,
      className: className || undefined,
      selector: buildSelector(element, { preferClasses: true }),
      href,
      disabled,
      checked,
    };
  };

  return {
    normalizeWhitespace,
    clipText,
    isVisible,
    isProbablyInteractive,
    buildSelector,
    findAssociatedLabel,
    findAriaLabelledByText,
    inferImplicitRole,
    findAccessibleName,
    summarizeInteractiveElement,
  };
}

export async function evaluateWithDomHelpers<TArg, TResult>(
  page: Page,
  pageFunction: (
    helpers: InspectionDomHelpers,
    arg: TArg,
  ) => TResult | Promise<TResult>,
  arg: TArg,
): Promise<TResult> {
  const helpersHandle = (await page.evaluateHandle(
    createInspectionDomHelpers,
  )) as JSHandle<InspectionDomHelpers>;

  try {
    return (await page.evaluate(
      pageFunction as never,
      helpersHandle,
      arg,
    )) as TResult;
  } finally {
    await helpersHandle.dispose();
  }
}
