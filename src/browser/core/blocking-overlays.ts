import type { Page } from "puppeteer-core";
import { evaluateWithDomHelpers } from "./dom-helpers.js";
import type { OverlayBlockingSummary } from "./types.js";

export interface BlockingOverlayDismissCandidate {
  selector: string;
  text?: string;
  accessibleName?: string;
  title?: string;
  score: number;
  scoreBreakdown: Array<{
    reason: string;
    score: number;
  }>;
}

export interface BlockingOverlayDetectionResult {
  blocked: boolean;
  summary?: OverlayBlockingSummary;
  candidates: BlockingOverlayDismissCandidate[];
}

const CLOSE_WORDS = [
  "close",
  "dismiss",
  "skip",
  "not now",
  "maybe later",
  "later",
  "cancel",
  "no thanks",
  "got it",
  "关闭",
  "取消",
  "跳过",
  "稍后",
  "下次再说",
  "以后再说",
  "知道了",
  "不用了",
];

const RISKY_WORDS = [
  "accept",
  "agree",
  "allow",
  "enable",
  "continue",
  "yes",
  "同意",
  "允许",
  "接受",
  "继续",
  "开启",
];

const OVERLAY_SELECTORS = [
  "dialog[open]",
  "[role='dialog']",
  "[aria-modal='true']",
  "[class*='modal']",
  "[class*='dialog']",
  "[class*='popup']",
  "[class*='overlay']",
  "[class*='drawer']",
  "[class*='cookie']",
  "[class*='consent']",
  "[id*='modal']",
  "[id*='dialog']",
  "[id*='popup']",
  "[id*='overlay']",
  "[id*='drawer']",
  "[id*='cookie']",
  "[id*='consent']",
].join(", ");

export async function detectBlockingOverlays(
  page: Page,
): Promise<BlockingOverlayDetectionResult> {
  return evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const centerX = viewportWidth / 2;
      const centerY = viewportHeight / 2;

      const normalize = (value: unknown) =>
        helpers.normalizeWhitespace(value).toLocaleLowerCase();

      const resolveInteractiveTarget = (
        element: HTMLElement,
        overlayRoot: HTMLElement,
      ) => {
        let current: HTMLElement | null = element;
        let depth = 0;

        while (current && current !== overlayRoot && depth < 6) {
          if (helpers.isProbablyInteractive(current)) {
            return current;
          }

          current = current.parentElement;
          depth += 1;
        }

        return helpers.isProbablyInteractive(overlayRoot) ? overlayRoot : element;
      };

      const seenSelectors = new Set<string>();

      const overlayElements = Array.from(document.querySelectorAll("*"))
        .filter((element): element is HTMLElement => element instanceof HTMLElement)
        .filter((element) => helpers.isVisible(element))
        .map((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const area = rect.width * rect.height;
          const text = helpers.clipText(
            helpers.normalizeWhitespace(
              element.innerText ?? element.textContent ?? "",
            ),
            200,
          );
          const haystack = normalize(
            [
              element.id,
              element.className,
              element.getAttribute("role"),
              element.getAttribute("aria-label"),
              text,
            ].join(" "),
          );

          const matchesOverlaySelector =
            element.matches(args.overlaySelectors);
          const isFixedLike =
            style.position === "fixed" ||
            style.position === "sticky" ||
            style.position === "absolute";
          const coversCenter =
            rect.left <= centerX &&
            rect.right >= centerX &&
            rect.top <= centerY &&
            rect.bottom >= centerY;
          const largeEnough =
            area >= viewportWidth * viewportHeight * 0.12 ||
            (rect.width >= viewportWidth * 0.55 &&
              rect.height >= viewportHeight * 0.18);
          const likelyBanner =
            rect.width >= viewportWidth * 0.75 &&
            rect.height >= viewportHeight * 0.1 &&
            (rect.top <= viewportHeight * 0.2 ||
              rect.bottom >= viewportHeight * 0.8);

          const likelyOverlay =
            matchesOverlaySelector ||
            (isFixedLike && (coversCenter || likelyBanner) && largeEnough);

          if (!likelyOverlay) {
            return null;
          }

          if (element.closest("main, [role='main'], article") === element) {
            return null;
          }

          const kind: OverlayBlockingSummary["kind"] = haystack.includes("cookie") ||
            haystack.includes("consent") ||
            haystack.includes("privacy")
            ? "cookie_banner"
            : rect.width < viewportWidth * 0.5 &&
                rect.height > viewportHeight * 0.45 &&
                (rect.left <= viewportWidth * 0.15 ||
                  rect.right >= viewportWidth * 0.85)
              ? "drawer"
              : likelyBanner
                ? "banner"
                : "modal";

          const controls = Array.from(
            element.querySelectorAll(
              "button, a[href], input[type='button'], input[type='submit'], [role='button'], [tabindex], summary, div, span, svg, path",
            ),
          )
            .filter((control) => control instanceof HTMLElement)
            .filter((control) => helpers.isVisible(control))
            .map((control) => {
              const htmlControl = control as HTMLElement;
              const targetControl = resolveInteractiveTarget(htmlControl, element);
              if (
                !helpers.isVisible(targetControl) ||
                !helpers.isProbablyInteractive(targetControl)
              ) {
                return null;
              }

              if (
                targetControl instanceof HTMLInputElement ||
                targetControl instanceof HTMLTextAreaElement ||
                targetControl.contentEditable === "true"
              ) {
                return null;
              }

              const controlRect = targetControl.getBoundingClientRect();
              const accessibleName =
                helpers.findAccessibleName(targetControl) ?? undefined;
              const title =
                helpers.normalizeWhitespace(targetControl.getAttribute("title")) ||
                undefined;
              const textValue = helpers.clipText(
                helpers.normalizeWhitespace(
                  targetControl.innerText ?? targetControl.textContent ?? "",
                ),
                80,
              );
              const sourceText = helpers.clipText(
                helpers.normalizeWhitespace(
                  htmlControl.innerText ?? htmlControl.textContent ?? "",
                ),
                40,
              );
              const label = normalize(
                [
                  accessibleName,
                  title,
                  textValue,
                  sourceText,
                  targetControl.getAttribute("aria-label"),
                  targetControl.getAttribute("data-testid"),
                  targetControl.getAttribute("class"),
                ].join(" "),
              );
              const selector = helpers.buildSelector(targetControl, {
                preferClasses: true,
              });
              const scoreBreakdown: Array<{ reason: string; score: number }> = [];
              const addScore = (reason: string, score: number) => {
                if (score !== 0) {
                  scoreBreakdown.push({ reason, score });
                }
              };

              if (!selector || seenSelectors.has(selector)) {
                return null;
              }

              if (args.closeWords.some((word) => label.includes(word))) {
                addScore("close-word", 18);
              }

              if (
                /^x$/i.test(textValue) ||
                /^×$/.test(textValue) ||
                /^x$/i.test(accessibleName ?? "") ||
                /^×$/.test(accessibleName ?? "") ||
                label === "close"
              ) {
                addScore("icon-close", 12);
              }

              if (args.riskyWords.some((word) => label.includes(word))) {
                addScore("risky-word-penalty", -30);
              }

              if (
                controlRect.top <= rect.top + Math.max(120, rect.height * 0.35) &&
                controlRect.right >= rect.right - Math.max(120, rect.width * 0.35)
              ) {
                addScore("top-right-close-position", 8);
              }

              if (
                targetControl instanceof HTMLButtonElement ||
                normalize(targetControl.getAttribute("role")) === "button"
              ) {
                addScore("button-like", 4);
              }

              const sourceRect = htmlControl.getBoundingClientRect();
              const iconLike =
                sourceRect.width <= 64 &&
                sourceRect.height <= 64 &&
                controlRect.width <= 72 &&
                controlRect.height <= 72 &&
                (htmlControl.tagName.toLowerCase() === "svg" ||
                  htmlControl.tagName.toLowerCase() === "path" ||
                  !!htmlControl.querySelector("svg, path") ||
                  !!targetControl.querySelector("svg, path"));

              if (
                iconLike &&
                controlRect.top <= rect.top + Math.max(120, rect.height * 0.3) &&
                controlRect.right >= rect.right - Math.max(120, rect.width * 0.25)
              ) {
                addScore("top-right-icon-button", 16);
              }

              const score = scoreBreakdown.reduce(
                (sum, item) => sum + item.score,
                0,
              );

              if (score <= 0) {
                return null;
              }

              seenSelectors.add(selector);
              return {
                selector,
                text: textValue || undefined,
                accessibleName,
                title,
                score,
                scoreBreakdown,
              };
            })
            .filter(Boolean)
            .sort((left, right) => right!.score - left!.score)
            .slice(0, 5) as BlockingOverlayDismissCandidate[];

          if (controls.length === 0 && kind === "cookie_banner") {
            return null;
          }

          return {
            kind,
            evidence: [
              `selector=${helpers.buildSelector(element, { preferClasses: true })}`,
              `size=${Math.round(rect.width)}x${Math.round(rect.height)}`,
              text ? `text=${text}` : "",
            ].filter(Boolean),
            controls,
          };
        })
        .filter(Boolean)
        .sort((left, right) => right!.controls.length - left!.controls.length);

      const primary = overlayElements[0] ?? null;
      if (!primary) {
        return {
          blocked: false,
          candidates: [],
        };
      }

      return {
        blocked: true,
        summary: {
          kind: primary.kind,
          evidence: primary.evidence.slice(0, 3),
          closeHints: primary.controls
            .slice(0, 3)
            .map(
              (control) =>
                control.accessibleName ?? control.text ?? control.selector,
            ),
          recommendedAction:
            primary.controls.length > 0
              ? "auto_close_then_resume"
              : "manual_resume",
        },
        candidates: primary.controls,
      };
    },
    {
      overlaySelectors: OVERLAY_SELECTORS,
      closeWords: CLOSE_WORDS,
      riskyWords: RISKY_WORDS,
    },
  );
}
