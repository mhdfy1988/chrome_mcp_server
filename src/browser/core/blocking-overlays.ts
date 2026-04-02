import type { Page } from "puppeteer-core";
import { evaluateWithDomHelpers } from "./dom-helpers.js";
import type { OverlayBlockingSummary } from "./types.js";

export interface BlockingOverlayDismissCandidate {
  method: "top_right_hotspot" | "close_candidate_click";
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
  primarySelector?: string;
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
  "login",
  "log in",
  "sign in",
  "sign-in",
  "register",
  "yes",
  "同意",
  "允许",
  "接受",
  "继续",
  "登录",
  "登录/注册",
  "注册",
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
  "[class*='mask']",
  "[class*='drawer']",
  "[class*='cookie']",
  "[class*='consent']",
  "[id*='modal']",
  "[id*='dialog']",
  "[id*='popup']",
  "[id*='overlay']",
  "[id*='mask']",
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

      const collectTopRightHotspotCandidates = (
        overlayRoot: HTMLElement,
      ): BlockingOverlayDismissCandidate[] => {
        const rect = overlayRoot.getBoundingClientRect();
        const offsets = [
          { x: 18, y: 18 },
          { x: 26, y: 18 },
          { x: 18, y: 26 },
          { x: 34, y: 20 },
          { x: 20, y: 34 },
        ];
        const hotspotCandidates: BlockingOverlayDismissCandidate[] = [];
        const seenHotspotKeys = new Set<string>();

        for (const offset of offsets) {
          const pointX = Math.max(rect.left + 1, rect.right - offset.x);
          const pointY = Math.min(rect.bottom - 1, rect.top + offset.y);
          const hit = document.elementFromPoint(pointX, pointY);
          if (!(hit instanceof HTMLElement) || !helpers.isVisible(hit)) {
            continue;
          }

          const target = resolveInteractiveTarget(hit, overlayRoot);
          if (!helpers.isVisible(target)) {
            continue;
          }

          const targetRect = target.getBoundingClientRect();
          const insideOverlay =
            targetRect.left >= rect.left - 4 &&
            targetRect.right <= rect.right + 4 &&
            targetRect.top >= rect.top - 4 &&
            targetRect.bottom <= rect.bottom + 4;
          if (!insideOverlay) {
            continue;
          }

          const selector = helpers.buildSelector(target, {
            preferClasses: true,
          });
          const hotspotKey = `top_right_hotspot:${selector}`;
          if (!selector || seenHotspotKeys.has(hotspotKey)) {
            continue;
          }

          const label = normalize(
            [
              helpers.findAccessibleName(target),
              target.getAttribute("aria-label"),
              target.getAttribute("title"),
              target.getAttribute("class"),
              target.innerText ?? target.textContent ?? "",
            ].join(" "),
          );
          if (args.riskyWords.some((word) => label.includes(word))) {
            continue;
          }

          const isSmallCornerControl =
            targetRect.width <= 80 &&
            targetRect.height <= 80 &&
            targetRect.top <= rect.top + Math.max(120, rect.height * 0.3) &&
            targetRect.right >= rect.right - Math.max(120, rect.width * 0.25);
          if (!isSmallCornerControl) {
            continue;
          }

          seenHotspotKeys.add(hotspotKey);
          hotspotCandidates.push({
            method: "top_right_hotspot",
            selector,
            text: helpers.clipText(
              helpers.normalizeWhitespace(
                target.innerText ?? target.textContent ?? "",
              ),
              40,
            ) || undefined,
            accessibleName: helpers.findAccessibleName(target) ?? undefined,
            title:
              helpers.normalizeWhitespace(target.getAttribute("title")) ||
              undefined,
            score: 20,
            scoreBreakdown: [
              { reason: "top-right-hotspot", score: 14 },
              { reason: "small-corner-control", score: 6 },
            ],
          });
        }

        return hotspotCandidates;
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
          const hasBlockingDescendant = !!element.querySelector(
            "dialog[open], [role='dialog'], [aria-modal='true'], form, input[type='password'], input[type='tel']",
          );
          const isPassThroughLayer =
            style.pointerEvents === "none" && !hasBlockingDescendant;

          if (isPassThroughLayer) {
            return null;
          }

          const matchesOverlaySelector =
            element.matches(args.overlaySelectors);
          const isFixedLike =
            style.position === "fixed" ||
            style.position === "sticky" ||
            style.position === "absolute";
          const zIndex = Number.parseInt(style.zIndex, 10);
          const hasHighZIndex = Number.isFinite(zIndex) && zIndex >= 1000;
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
          const hasLoginLikeInputs = !!element.querySelector(
            "input[type='password'], input[type='tel']",
          );
          const containsForm = !!element.querySelector("form");
          const looksLikeCenteredModal =
            coversCenter &&
            rect.width >= viewportWidth * 0.55 &&
            rect.height >= viewportHeight * 0.45 &&
            (hasLoginLikeInputs || containsForm);

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
            : looksLikeCenteredModal
              ? "modal"
            : rect.width < viewportWidth * 0.5 &&
                rect.height > viewportHeight * 0.45 &&
                (rect.left <= viewportWidth * 0.15 ||
                  rect.right >= viewportWidth * 0.85)
              ? "drawer"
              : likelyBanner
                ? "banner"
                : "modal";

          const overlayScoreBreakdown: Array<{ reason: string; score: number }> =
            [];
          const addOverlayScore = (reason: string, score: number) => {
            if (score !== 0) {
              overlayScoreBreakdown.push({ reason, score });
            }
          };

          if (matchesOverlaySelector) {
            addOverlayScore("matches-overlay-selector", 8);
          }
          if (hasHighZIndex) {
            addOverlayScore("high-z-index", 8);
          }
          if (coversCenter) {
            addOverlayScore("covers-center", 10);
          }
          if (largeEnough) {
            addOverlayScore("large-enough", 6);
          }
          if (kind === "modal") {
            addOverlayScore("kind-modal", 8);
          }
          if (kind === "drawer") {
            addOverlayScore("kind-drawer", 4);
          }
          if (kind === "banner") {
            addOverlayScore("kind-banner-penalty", -4);
          }
          if (element.matches("[role='dialog'], dialog[open], [aria-modal='true']")) {
            addOverlayScore("explicit-dialog", 10);
          }
          if (hasLoginLikeInputs) {
            addOverlayScore("login-inputs", 6);
          }
          if (containsForm) {
            addOverlayScore("contains-form", 4);
          }

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

              if (
                /\bclose\b/.test(label) ||
                label.includes("关闭") ||
                label.includes("close-btn") ||
                label.includes("close_button") ||
                label.includes("icon-close") ||
                label.includes("close-icon")
              ) {
                addScore("close-class", 10);
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
              const hasStrongCloseSignal = scoreBreakdown.some(
                (item) =>
                  item.reason === "close-word" ||
                  item.reason === "icon-close" ||
                  item.reason === "close-class" ||
                  item.reason === "top-right-icon-button",
              );

              if (score <= 0 || !hasStrongCloseSignal) {
                return null;
              }

              seenSelectors.add(selector);
              return {
                method: "close_candidate_click" as const,
                selector,
                text: textValue || undefined,
                accessibleName,
                title,
                score,
                scoreBreakdown,
              };
            })
            .filter(Boolean)
            .sort((left, right) => right!.score - left!.score) as BlockingOverlayDismissCandidate[];

          for (const hotspotCandidate of collectTopRightHotspotCandidates(element)) {
            controls.push(hotspotCandidate);
          }

          controls.sort((left, right) => right.score - left.score);
          const dedupedControls: BlockingOverlayDismissCandidate[] = [];
          const seenControlSelectors = new Set<string>();
          for (const control of controls) {
            const controlKey = `${control.method}:${control.selector}`;
            if (seenControlSelectors.has(controlKey)) {
              continue;
            }
            seenControlSelectors.add(controlKey);
            dedupedControls.push(control);
            if (dedupedControls.length >= 5) {
              break;
            }
          }

          const hasStrongBlockingShape =
            matchesOverlaySelector ||
            hasHighZIndex ||
            looksLikeCenteredModal ||
            (rect.width >= viewportWidth * 0.75 &&
              rect.height >= viewportHeight * 0.45);

          if (dedupedControls.length === 0) {
            if (kind === "cookie_banner" || !hasStrongBlockingShape) {
              return null;
            }
          }

          const overlayScoreBase = overlayScoreBreakdown.reduce(
            (sum, item) => sum + item.score,
            0,
          );
          const controlsBonus = Math.min(dedupedControls.length, 3) * 6;
          const controlsPenalty = dedupedControls.length === 0 ? -6 : 0;
          const strongestControlScore = dedupedControls[0]?.score ?? 0;
          const overlayScore =
            overlayScoreBase +
            controlsBonus +
            controlsPenalty +
            Math.min(strongestControlScore, 24);

          return {
            kind,
            evidence: [
              `selector=${helpers.buildSelector(element, { preferClasses: true })}`,
              `size=${Math.round(rect.width)}x${Math.round(rect.height)}`,
              text ? `text=${text}` : "",
            ].filter(Boolean),
            controls: dedupedControls,
            score: overlayScore,
            scoreBreakdown: overlayScoreBreakdown,
            strongestControlScore,
          };
        })
        .filter(Boolean)
        .sort((left, right) => {
          const scoreDiff = right!.score - left!.score;
          if (scoreDiff !== 0) {
            return scoreDiff;
          }
          const controlScoreDiff =
            (right!.strongestControlScore ?? 0) -
            (left!.strongestControlScore ?? 0);
          if (controlScoreDiff !== 0) {
            return controlScoreDiff;
          }
          return right!.controls.length - left!.controls.length;
        });

      const primary = overlayElements[0] ?? null;
      if (!primary) {
        return {
          blocked: false,
          primarySelector: undefined,
          candidates: [],
        };
      }

      return {
        blocked: true,
        primarySelector: primary.evidence[0]?.startsWith("selector=")
          ? primary.evidence[0].slice("selector=".length)
          : undefined,
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
