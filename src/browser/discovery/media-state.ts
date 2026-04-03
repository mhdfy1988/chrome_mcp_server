import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { BrowserInspectionDeps } from "../session/inspection-deps.js";
import type { RawReadMediaStateResult } from "./types.js";

export async function readMediaStateWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    selector?: string;
    maxResults: number;
  },
): Promise<RawReadMediaStateResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);

  const result = await evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      const normalize = (value: unknown) =>
        helpers.normalizeWhitespace(value).toLocaleLowerCase();
      const toConfidence = (score: number, maxScore: number) =>
        Number(Math.max(0.05, Math.min(0.99, score / maxScore)).toFixed(2));
      const scope = args.selector
        ? document.querySelector(args.selector)
        : document.body;

      if (!scope) {
        return {
          total: 0,
          media: [],
          playMediaPlan: [],
        };
      }

      const mediaElements = Array.from(scope.querySelectorAll("video, audio"))
        .filter(
          (element): element is HTMLVideoElement | HTMLAudioElement =>
            element instanceof HTMLVideoElement ||
            element instanceof HTMLAudioElement,
        )
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const visible = helpers.isVisible(element);
          const scoreBreakdown: Array<{ reason: string; score: number }> = [];
          const addScore = (reason: string, score: number) => {
            if (score !== 0) {
              scoreBreakdown.push({ reason, score });
            }
          };

          if (visible) {
            addScore("visible", 10);
          }

          if (!element.paused) {
            addScore("playing", 12);
          }

          if (element.currentTime > 0) {
            addScore("current-time-progress", 8);
          }

          if (element.readyState >= 2) {
            addScore("ready-state", 6);
          }

          if (rect.width * rect.height > 0) {
            addScore(
              "media-area",
              Math.min(10, Math.round((rect.width * rect.height) / 50000)),
            );
          }

          const score = scoreBreakdown.reduce((sum, item) => sum + item.score, 0);
          return {
            tag: (element instanceof HTMLVideoElement ? "video" : "audio") as
              | "video"
              | "audio",
            selector: helpers.buildSelector(element, { preferClasses: true }),
            currentSrc: helpers.normalizeWhitespace(element.currentSrc),
            src: helpers.normalizeWhitespace(element.getAttribute("src")),
            currentTime: Number(element.currentTime.toFixed(3)),
            duration: Number(
              Number.isFinite(element.duration) ? element.duration.toFixed(3) : 0,
            ),
            paused: element.paused,
            ended: element.ended,
            muted: element.muted,
            volume: Number(element.volume.toFixed(3)),
            playbackRate: Number(element.playbackRate.toFixed(3)),
            readyState: element.readyState,
            networkState: element.networkState,
            visible,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            isPrimary: false,
            score,
            scoreBreakdown,
            errorCode: element.error?.code,
          };
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, args.maxResults);

      const playMediaPlan: RawReadMediaStateResult["playMediaPlan"] = [];
      if (mediaElements.length > 0) {
        mediaElements[0]!.isPrimary = true;

        const primaryMedia = mediaElements[0]!;
        const primaryElement = scope.querySelector(primaryMedia.selector);

        if (!primaryMedia.paused && primaryMedia.currentTime > 0) {
          playMediaPlan.push({
            method: "already_playing",
            confidence: 0.99,
            reasons: ["主媒体已在播放，无需额外点击"],
            selector: primaryMedia.selector,
          });
        }

        playMediaPlan.push({
          method: "click_media_surface",
          confidence: toConfidence(
            primaryMedia.score + (primaryMedia.paused ? 18 : 6),
            60,
          ),
          reasons: [
            primaryMedia.tag === "video"
              ? "优先点击主视频区域，最接近真人播放动作"
              : "优先点击主音频区域，尝试恢复播放",
          ],
          selector: primaryMedia.selector,
        });

        if (primaryElement instanceof HTMLElement) {
          const primaryRect = primaryElement.getBoundingClientRect();
          const playerRoot =
            primaryElement.closest(
              [
                "[class*='player']",
                "[class*='video']",
                "[class*='media']",
                "[data-testid*='player']",
                "[role='application']",
              ].join(", "),
            ) ??
            primaryElement.parentElement ??
            scope;

          const playButtons = Array.from(
            playerRoot.querySelectorAll(
              "button, [role='button'], input[type='button'], div, span",
            ),
          )
            .filter((element): element is HTMLElement => element instanceof HTMLElement)
            .filter((element) => helpers.isVisible(element))
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const label = normalize(
                [
                  helpers.findAccessibleName(element),
                  element.getAttribute("aria-label"),
                  element.getAttribute("title"),
                  element.getAttribute("class"),
                  element.innerText ?? element.textContent ?? "",
                ].join(" "),
              );

              const scoreBreakdown: Array<{ reason: string; score: number }> = [];
              const addScore = (reason: string, score: number) => {
                if (score !== 0) {
                  scoreBreakdown.push({ reason, score });
                }
              };

              if (
                ["play", "resume", "播放", "继续播放", "play-button"].some((keyword) =>
                  label.includes(keyword),
                )
              ) {
                addScore("play-label", 20);
              }

              if (
                rect.left <= primaryRect.right + 80 &&
                rect.right >= primaryRect.left - 80 &&
                rect.top <= primaryRect.bottom + 80 &&
                rect.bottom >= primaryRect.top - 80
              ) {
                addScore("near-primary-media", 10);
              }

              if (
                rect.width <= 160 &&
                rect.height <= 100
              ) {
                addScore("button-sized", 4);
              }

              const score = scoreBreakdown.reduce((sum, item) => sum + item.score, 0);
              if (score <= 0) {
                return null;
              }

              return {
                selector: helpers.buildSelector(element, { preferClasses: true }),
                text: helpers.clipText(
                  helpers.normalizeWhitespace(
                    element.innerText ?? element.textContent ?? "",
                  ),
                  40,
                ),
                accessibleName: helpers.findAccessibleName(element) ?? undefined,
                score,
              };
            })
            .filter(
              (
                candidate,
              ): candidate is NonNullable<typeof candidate> => Boolean(candidate?.selector),
            )
            .sort((left, right) => right.score - left.score);

          if (playButtons[0]) {
            playMediaPlan.push({
              method: "click_play_button",
              confidence: toConfidence(playButtons[0].score, 36),
              reasons: ["检测到主媒体附近的明确播放按钮，作为后备动作"],
              selector: playButtons[0].selector,
              text: playButtons[0].text,
              accessibleName: playButtons[0].accessibleName,
            });
          }
        }
      }

      return {
        total: mediaElements.length,
        media: mediaElements,
        playMediaPlan,
      };
    },
    {
      selector: options.selector,
      maxResults: options.maxResults,
    },
  );

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    total: result.total,
    media: result.media,
    playMediaPlan: result.playMediaPlan,
  };
}
