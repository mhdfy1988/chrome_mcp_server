import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import type { RawReadMediaStateResult } from "../core/types.js";

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
      const scope = args.selector
        ? document.querySelector(args.selector)
        : document.body;

      if (!scope) {
        return {
          total: 0,
          media: [],
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

      if (mediaElements.length > 0) {
        mediaElements[0]!.isPrimary = true;
      }

      return {
        total: mediaElements.length,
        media: mediaElements,
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
  };
}
