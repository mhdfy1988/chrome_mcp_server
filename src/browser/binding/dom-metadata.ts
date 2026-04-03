export function normalizeDomWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRuntimeNodeKey(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    const htmlElement = current as HTMLElement;
    const tag = current.tagName.toLowerCase();
    const id = normalizeDomWhitespace(htmlElement.id);
    if (id) {
      segments.unshift(`${tag}#${id}`);
      break;
    }

    const parent: Element | null = current.parentElement;
    const sameTagSiblings: Element[] = parent
      ? Array.from(parent.children).filter(
          (child: Element) => child.tagName === current!.tagName,
        )
      : [];
    const index =
      sameTagSiblings.length > 0 ? sameTagSiblings.indexOf(current) + 1 : 1;
    segments.unshift(`${tag}:${index}`);
    current = parent;
  }

  return segments.join("/");
}

export function findContextAnchor(element: Element): string | undefined {
  const context = element.closest(
    "form, dialog, [role='dialog'], [aria-modal='true'], article, section, li, tr, td, nav, header, main",
  );

  if (!context || context === element) {
    return undefined;
  }

  const htmlContext = context as HTMLElement;
  const id = normalizeDomWhitespace(htmlContext.id);
  if (id) {
    return `#${id}`;
  }

  const role = normalizeDomWhitespace(context.getAttribute("role"));
  if (role) {
    return `${context.tagName.toLowerCase()}[role="${role}"]`;
  }

  const classNames = Array.from(context.classList)
    .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
    .slice(0, 2);
  if (classNames.length > 0) {
    return `${context.tagName.toLowerCase()}.${classNames.join(".")}`;
  }

  return context.tagName.toLowerCase();
}

export function inferSemanticRole(
  element: Element,
  role: string | undefined,
  href: string | undefined,
): string | undefined {
  if (role) {
    return role;
  }

  const tag = element.tagName.toLowerCase();
  if (tag === "a" && href) {
    return "link";
  }

  if (tag === "button") {
    return "button";
  }

  if (tag === "input" || tag === "textarea") {
    return "input";
  }

  if (tag === "select") {
    return "select";
  }

  if (tag === "label") {
    return "label_proxy";
  }

  return undefined;
}

export function buildSemanticSignals(options: {
  role?: string;
  explicitRole?: string;
  type?: string;
  href?: string;
  label?: string;
  accessibleName?: string;
  placeholder?: string;
  disabled: boolean;
  hasJsClickListener: boolean;
  isLabelProxy: boolean;
  formControlRelation?: string;
  cursorStyle?: string;
}): string[] {
  const signals = [
    options.role ? `role:${options.role}` : undefined,
    options.explicitRole ? `explicitRole:${options.explicitRole}` : undefined,
    options.type ? `type:${options.type}` : undefined,
    options.href ? "hasHref" : undefined,
    options.label ? "hasLabel" : undefined,
    options.accessibleName ? "hasAccessibleName" : undefined,
    options.placeholder ? "hasPlaceholder" : undefined,
    options.disabled ? "disabled" : undefined,
    options.hasJsClickListener ? "hasJsClickListener" : undefined,
    options.isLabelProxy ? "isLabelProxy" : undefined,
    options.formControlRelation
      ? `formRelation:${options.formControlRelation}`
      : undefined,
    options.cursorStyle ? `cursor:${options.cursorStyle}` : undefined,
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(signals));
}
