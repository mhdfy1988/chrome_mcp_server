import type { JSHandle, Page } from "puppeteer-core";
import type { SelectorBuildOptions } from "../binding/dom-selector.js";
import type { AccessibleNameOptions } from "../discovery/dom-accessibility.js";
import type { RawSnapshotElementSummary } from "../discovery/types.js";

export interface InspectionDomHelpers {
  normalizeWhitespace(value: unknown): string;
  clipText(value: string, maxLength: number): string;
  isVisible(element: Element): boolean;
  isProbablyInteractive(element: Element): boolean;
  resolvePrimaryActionElement(element: Element): Element | null;
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

  const escapeSelector = (value: string) => {
    if (globalThis.CSS?.escape) {
      return globalThis.CSS.escape(value);
    }

    return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  };

  const quoteAttribute = (value: string) =>
    `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

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

    while (current && current !== document.documentElement) {
      const htmlElement = current as HTMLElement;
      const tag = current.tagName.toLowerCase();
      const currentTagName = current.tagName;
      const id = normalizeWhitespace(htmlElement.id);

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

    const placeholder = normalizeWhitespace(
      element.getAttribute("placeholder"),
    );
    if (placeholder) {
      const selector = `${tag}[placeholder=${quoteAttribute(placeholder)}]`;
      if (isUniqueSelector(selector)) {
        return selector;
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
  };

  const buildRuntimeNodeKey = (element: Element) => {
    const segments: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const currentTagName = current.tagName;
      const parent: Element | null = current.parentElement;
      let segment = tag;

      if (parent) {
        const siblings = (Array.from(parent.children) as Element[]).filter(
          (child) => child.tagName === currentTagName,
        );
        if (siblings.length > 1) {
          segment += `:${siblings.indexOf(current) + 1}`;
        }
      }

      segments.unshift(segment);
      current = parent;
    }

    return segments.join(">");
  };

  const findContextAnchor = (element: Element) => {
    const anchor =
      element.closest("[data-testid]") ??
      element.closest("[data-test]") ??
      element.closest("[data-role]") ??
      element.closest("article, section, li, tr, form, nav, header, main");

    if (!anchor) {
      return undefined;
    }

    return buildSelector(anchor, { preferClasses: true });
  };

  const inferSemanticRole = (
    element: Element,
    explicitRole?: string,
    href?: string,
  ) => {
    if (explicitRole) {
      return explicitRole;
    }

    if (element.tagName.toLowerCase() === "a" && href) {
      return "link";
    }

    if (element.tagName.toLowerCase() === "button") {
      return "button";
    }

    if (
      element.tagName.toLowerCase() === "input" ||
      element.tagName.toLowerCase() === "textarea"
    ) {
      return "input";
    }

    if (element.tagName.toLowerCase() === "select") {
      return "select";
    }

    return undefined;
  };

  const buildSemanticSignals = (candidate: {
    role?: string;
    explicitRole?: string;
    type?: string;
    href?: string;
    label?: string;
    accessibleName?: string;
    placeholder?: string;
    disabled?: boolean;
    hasJsClickListener?: boolean;
    isLabelProxy?: boolean;
    formControlRelation?: string;
    cursorStyle?: string;
  }) => {
    const signals = [
      candidate.role ? `role:${candidate.role}` : undefined,
      candidate.explicitRole ? `explicitRole:${candidate.explicitRole}` : undefined,
      candidate.type ? `type:${candidate.type}` : undefined,
      candidate.href ? "hasHref" : undefined,
      candidate.label ? "hasLabel" : undefined,
      candidate.accessibleName ? "hasAccessibleName" : undefined,
      candidate.placeholder ? "hasPlaceholder" : undefined,
      candidate.hasJsClickListener ? "hasJsClickListener" : undefined,
      candidate.isLabelProxy ? "isLabelProxy" : undefined,
      candidate.formControlRelation
        ? `formRelation:${candidate.formControlRelation}`
        : undefined,
      candidate.cursorStyle ? `cursor:${candidate.cursorStyle}` : undefined,
      candidate.disabled ? "disabled" : undefined,
    ].filter((value): value is string => Boolean(value));

    return Array.from(new Set(signals));
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

    const explicitRole = normalizeWhitespace(
      element.getAttribute("role"),
    ).toLowerCase();
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

    if (
      element.hasAttribute("onclick") ||
      typeof (element as HTMLElement).onclick === "function"
    ) {
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
        normalizeWhitespace(
          (element as HTMLElement).innerText ?? element.textContent,
        ) ||
        signalHaystack
      ) {
        return true;
      }
    }

    return false;
  };

  const isDirectActionElement = (
    element: HTMLElement,
    explicitRole: string,
    implicitRole?: string,
  ) => {
    const tag = element.tagName.toLowerCase();
    if (
      implicitRole ||
      explicitRole === "button" ||
      explicitRole === "link" ||
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

    const tabindex = String(element.getAttribute("tabindex") ?? "").trim();
    if (tabindex) {
      const tabIndexValue = Number(tabindex);
      if (!Number.isNaN(tabIndexValue) && tabIndexValue >= 0) {
        return true;
      }
    }

    if (element.hasAttribute("onclick") || typeof element.onclick === "function") {
      return true;
    }

    return false;
  };

  const isContextContainerElement = (element: HTMLElement) => {
    const tag = element.tagName.toLowerCase();
    return (
      tag === "tr" ||
      tag === "td" ||
      tag === "th" ||
      tag === "li" ||
      tag === "article" ||
      tag === "section" ||
      tag === "div"
    );
  };

  const normalizeCandidateText = (element: HTMLElement) =>
    String(element.innerText ?? element.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();

  const scorePrimaryActionCandidate = (
    container: HTMLElement,
    candidate: HTMLElement,
  ) => {
    const tag = candidate.tagName.toLowerCase();
    const role = String(candidate.getAttribute("role") ?? "")
      .trim()
      .toLowerCase();
    const text = normalizeCandidateText(candidate);
    const title = String(candidate.getAttribute("title") ?? "").trim();
    const ariaLabel = String(candidate.getAttribute("aria-label") ?? "").trim();
    const semanticHint = `${ariaLabel} ${title} ${text}`.toLowerCase();
    let score = 0;

    if (tag === "a" && candidate.hasAttribute("href")) {
      score += 24;
    } else if (tag === "button") {
      score += 20;
    } else if (tag === "input") {
      const type = String((candidate as HTMLInputElement).type ?? "")
        .trim()
        .toLowerCase();
      if (type === "submit" || type === "button" || type === "image") {
        score += 18;
      }
    } else if (role === "button" || role === "link") {
      score += 16;
    }

    if (ariaLabel) {
      score += 5;
    }
    if (title) {
      score += 4;
    }
    if (text) {
      score += 4;
    }
    if (
      semanticHint.includes("(file)") ||
      /\.[a-z0-9]{1,8}\b/i.test(title || text)
    ) {
      score += 8;
    }
    if (
      semanticHint.includes("(commit)") ||
      semanticHint.includes("history") ||
      semanticHint.includes("last commit") ||
      semanticHint.includes("提交") ||
      semanticHint.includes("历史")
    ) {
      score -= 6;
    }
    if (candidate.getAttribute("aria-current") === "page") {
      score -= 3;
    }
    if (
      candidate instanceof HTMLButtonElement ||
      candidate instanceof HTMLInputElement
    ) {
      if (candidate.disabled) {
        score -= 12;
      }
    }
    if (candidate.getAttribute("aria-disabled") === "true") {
      score -= 12;
    }

    const containerTag = container.tagName.toLowerCase();
    if (containerTag === "tr") {
      const cell = candidate.closest("td, th");
      const rowCells = Array.from(container.children).filter(
        (child) =>
          child instanceof HTMLElement &&
          (child.tagName.toLowerCase() === "td" || child.tagName.toLowerCase() === "th"),
      );
      if (cell instanceof HTMLElement && rowCells.length > 0) {
        const cellIndex = rowCells.indexOf(cell);
        if (cellIndex >= 0) {
          score += Math.max(0, 10 - cellIndex * 4);
          if (cellIndex >= 2) {
            score -= Math.min(6, (cellIndex - 1) * 2);
          }
        }
      }
    } else if (containerTag === "td" || containerTag === "th") {
      const cell = candidate.closest("td, th");
      if (cell === container) {
        score += 6;
      }
    }

    return score;
  };

  const resolvePrimaryActionElement = (element: Element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return null;
    }

    const explicitRole = normalizeWhitespace(
      element.getAttribute("role"),
    ).toLowerCase();
    const implicitRole = inferImplicitRole(element);
    if (isDirectActionElement(element, explicitRole, implicitRole)) {
      return element;
    }

    if (!isContextContainerElement(element)) {
      return element;
    }

    const candidates = Array.from(
      element.querySelectorAll(
        'a[href], button, input[type="button"], input[type="submit"], input[type="image"], [role="button"], [role="link"], summary',
      ),
    ).filter(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement && isVisible(candidate),
    );

    if (candidates.length === 0) {
      return element;
    }

    const scored = candidates
      .map((candidate, index) => ({
        element: candidate,
        index,
        score: scorePrimaryActionCandidate(element, candidate),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    if (scored[0].score <= 0) {
      return element;
    }

    if (scored.length > 1 && scored[0].score - scored[1].score < 4) {
      return element;
    }

    return scored[0].element;
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

  const isLabelProxyElement = (element: Element) => {
    if (element.tagName.toLowerCase() === "label") {
      return true;
    }

    return Boolean(element.closest("label"));
  };

  const inferFormControlRelation = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === "label") {
      const label = element as HTMLLabelElement;
      if (normalizeWhitespace(label.htmlFor)) {
        return "label_for_control";
      }

      if (label.querySelector("input, textarea, select, button")) {
        return "label_wraps_control";
      }

      return "label";
    }

    if (element.closest("label")) {
      return "wrapped_by_label";
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLButtonElement
    ) {
      if (element.form) {
        return "form_control";
      }

      return "standalone_control";
    }

    if (element.closest("form")) {
      return "inside_form";
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
    const axRole = role || undefined;
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
    const cursorStyle = window.getComputedStyle(htmlElement).cursor;
    const hasJsClickListener =
      element.hasAttribute("onclick") || typeof htmlElement.onclick === "function";
    const isLabelProxy = isLabelProxyElement(element);
    const formControlRelation = inferFormControlRelation(element);
    const runtimeNodeKey = buildRuntimeNodeKey(element);
    const contextAnchor = findContextAnchor(element);

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

    const semanticRole = inferSemanticRole(element, role || undefined, href);

    return {
      index,
      tag: element.tagName.toLowerCase(),
      role: role || undefined,
      axRole,
      semanticRole,
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
      runtimeNodeKey,
      contextAnchor,
      href,
      cursorStyle,
      hasJsClickListener,
      isLabelProxy,
      formControlRelation,
      semanticSignals: buildSemanticSignals({
        role: role || undefined,
        explicitRole: explicitRole || undefined,
        type: type || undefined,
        href,
        label,
        accessibleName,
        placeholder: placeholder || undefined,
        disabled,
        hasJsClickListener,
        isLabelProxy,
        formControlRelation,
        cursorStyle,
      }),
      disabled,
      checked,
    };
  };

  return {
    normalizeWhitespace,
    clipText,
    isVisible,
    isProbablyInteractive,
    resolvePrimaryActionElement,
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
