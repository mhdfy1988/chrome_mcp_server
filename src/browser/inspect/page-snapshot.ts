import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { RawPageSnapshotResult } from "../core/types.js";

export async function pageSnapshotWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    maxTextLength: number;
    maxElements: number;
  },
): Promise<RawPageSnapshotResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const snapshot = await evaluateWithDomHelpers(
    page,
    (helpers, { maxTextLength, maxElements }) => {
      const query =
        'a[href], button, input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [contenteditable="true"]';

      const interactiveElements = Array.from(
        new Set(
          Array.from(document.querySelectorAll(query)).filter((element) =>
            helpers.isVisible(element),
          ),
        ),
      )
        .slice(0, maxElements)
        .map((element, index) => {
          const htmlElement = element as HTMLElement;
          const explicitRole = helpers.normalizeWhitespace(
            element.getAttribute("role"),
          );
          const role = explicitRole || helpers.inferImplicitRole(element);
          const text = helpers.clipText(
            helpers.normalizeWhitespace(
              htmlElement.innerText ?? htmlElement.textContent,
            ),
            120,
          );
          const label = helpers.findAssociatedLabel(htmlElement);
          const accessibleName = helpers.findAccessibleName(element);
          const placeholder = helpers.normalizeWhitespace(
            element.getAttribute("placeholder"),
          );

          let value: string | undefined;
          let type: string | undefined;
          let checked: boolean | undefined;
          let href: string | undefined;
          let disabled = htmlElement.getAttribute("aria-disabled") === "true";

          if (element instanceof HTMLInputElement) {
            value = helpers.clipText(
              helpers.normalizeWhitespace(element.value),
              120,
            );
            type = helpers.normalizeWhitespace(element.type);
            checked = element.checked;
            disabled = disabled || element.disabled;
          } else if (element instanceof HTMLTextAreaElement) {
            value = helpers.clipText(
              helpers.normalizeWhitespace(element.value),
              120,
            );
            disabled = disabled || element.disabled;
          } else if (element instanceof HTMLSelectElement) {
            value = helpers.clipText(
              helpers.normalizeWhitespace(element.value),
              120,
            );
            disabled = disabled || element.disabled;
          } else if (element instanceof HTMLButtonElement) {
            disabled = disabled || element.disabled;
          } else if (element instanceof HTMLAnchorElement) {
            href = element.href;
          }

          return {
            index: index + 1,
            tag: element.tagName.toLowerCase(),
            role: role || undefined,
            explicitRole: explicitRole || undefined,
            type: type || undefined,
            text: text || undefined,
            value: value || undefined,
            accessibleName,
            label,
            placeholder: placeholder || undefined,
            selector: helpers.buildSelector(element),
            href,
            disabled,
            checked,
          };
        });

      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
        .filter((element) => helpers.isVisible(element))
        .map((element) =>
          helpers.clipText(
            helpers.normalizeWhitespace(element.textContent),
            120,
          ),
        )
        .filter(Boolean)
        .slice(0, 20);

      const textPreview = helpers.clipText(
        helpers.normalizeWhitespace(document.body?.innerText ?? ""),
        maxTextLength,
      );

      return {
        headings,
        textPreview,
        interactiveElements,
      };
    },
    {
      maxTextLength: options.maxTextLength,
      maxElements: options.maxElements,
    },
  );

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    headings: snapshot.headings,
    textPreview: snapshot.textPreview,
    interactiveElements: snapshot.interactiveElements,
  };
}

