import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import type { RawFindPrimaryResultsResult } from "../core/types.js";

export async function findPrimaryResultsWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    query?: string;
    maxResults: number;
  },
): Promise<RawFindPrimaryResultsResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const query = options.query?.trim();

  const result = await evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      const normalize = (value: unknown) =>
        helpers.normalizeWhitespace(value).toLocaleLowerCase();
      const queryText = normalize(args.query ?? "");
      const root =
        document.querySelector("main") ??
        document.querySelector("[role='main']") ??
        document.querySelector("#main") ??
        document.querySelector("#mainContent") ??
        document.querySelector("#content") ??
        document.querySelector("article") ??
        document.body;

      const isInBlockedRegion = (element: Element) =>
        Boolean(
          element.closest(
            [
              "header",
              "footer",
              "nav",
              "aside",
              "[role='navigation']",
              "[role='complementary']",
              ".filter",
              ".filters",
              ".refine",
              ".refinement",
              ".x-refine",
              ".srp-controls",
              ".srp-related-searches",
              ".gh-nav",
              ".gh-header",
            ].join(", "),
          ),
        );

      const utilityKeywords = [
        "sign in",
        "register",
        "help",
        "contact",
        "filter",
        "filters",
        "sort",
        "save",
        "watchlist",
        "advanced",
        "related",
        "shipping",
        "returns",
        "condition",
        "price",
        "view all",
        "more",
        "登录",
        "注册",
        "帮助",
        "联系",
        "筛选",
        "排序",
        "保存",
        "相关",
        "更多",
      ];

      const containerHints = [
        "article",
        "li",
        "[data-testid*='result']",
        "[data-testid*='card']",
        "[class*='result']",
        "[class*='card']",
        "[class*='item']",
        "[class*='video']",
        "[class*='product']",
        "[class*='listing']",
        "[class*='search']",
      ].join(", ");

      const findContainer = (anchor: HTMLAnchorElement) => {
        let current: Element | null = anchor;
        while (current && current !== root && current !== document.body) {
          if (current.matches(containerHints)) {
            return current;
          }

          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(
              (child) =>
                child.tagName === current?.tagName &&
                helpers.isVisible(child) &&
                !isInBlockedRegion(child),
            );
            if (siblings.length >= 3) {
              return current;
            }
          }

          current = current.parentElement;
        }

        return anchor;
      };

      const seenHrefs = new Set<string>();
      const candidates = Array.from(root.querySelectorAll("a[href]"))
        .filter((anchor): anchor is HTMLAnchorElement => anchor instanceof HTMLAnchorElement)
        .filter((anchor) => helpers.isVisible(anchor))
        .filter((anchor) => !isInBlockedRegion(anchor))
        .map((anchor) => {
          const href = helpers.normalizeWhitespace(anchor.href);
          if (!href || href.startsWith("javascript:") || href.endsWith("#")) {
            return null;
          }

          if (seenHrefs.has(href)) {
            return null;
          }
          seenHrefs.add(href);

          const summary = helpers.summarizeInteractiveElement(anchor, 1);
          const container = findContainer(anchor);
          const rect = anchor.getBoundingClientRect();
          const textHaystack = [
            summary.text,
            summary.accessibleName,
            summary.title,
          ]
            .filter(Boolean)
            .join(" ");
          const normalizedText = normalize(textHaystack);
          const containerText = helpers.clipText(
            helpers.normalizeWhitespace(
              (container as HTMLElement).innerText ??
                container.textContent ??
                "",
            ),
            240,
          );
          const normalizedContainerText = normalize(containerText);
          const scoreBreakdown: Array<{ reason: string; score: number }> = [];
          const addScore = (reason: string, score: number) => {
            if (score !== 0) {
              scoreBreakdown.push({ reason, score });
            }
          };

          if (!normalizedText) {
            addScore("missing-text-penalty", -20);
          }

          if (normalizedText.length >= 10 && normalizedText.length <= 160) {
            addScore("meaningful-title", 12);
          } else if (normalizedText.length >= 4) {
            addScore("short-title", 4);
          } else {
            addScore("very-short-title-penalty", -12);
          }

          if (utilityKeywords.some((keyword) => normalizedText.includes(keyword))) {
            addScore("utility-link-penalty", -24);
          }

          if (queryText) {
            if (normalizedText === queryText) {
              addScore("query-exact-title", 24);
            } else if (normalizedText.includes(queryText)) {
              addScore("query-match-title", 18);
            } else if (normalizedContainerText.includes(queryText)) {
              addScore("query-match-container", 8);
            }
          }

          if (container !== anchor) {
            addScore("card-container", 8);
          }

          if (
            /(\$|usd|hkd|eur|£|¥|观看|views|sold|reply|评论|分钟|mins?|hours?)/i.test(
              containerText,
            )
          ) {
            addScore("rich-result-metadata", 6);
          }

          if (rect.top >= 0 && rect.top <= window.innerHeight * 2.5) {
            addScore("within-main-viewport", 5);
          }

          if (href.includes("/package/")) {
            addScore("package-detail-pattern", 18);
          }

          if (href.includes("/itm/") || href.includes("watch?v=")) {
            addScore("detail-link-pattern", 10);
          }

          if (anchor.target === "_blank") {
            addScore("opens-new-tab", 2);
          }

          if (
            /\/~[^/]+\/?$/.test(href) ||
            /\/users?\//.test(href) ||
            /\/profile/.test(href)
          ) {
            addScore("profile-link-penalty", -22);
          }

          if (
            href.includes("/search?") ||
            href.includes("search?q=") ||
            href.includes("keywords:")
          ) {
            addScore("facet-link-penalty", -18);
          }

          if (
            normalizedContainerText.includes("sponsored") ||
            normalizedContainerText.includes("赞助")
          ) {
            addScore("sponsored-penalty", -12);
          }

          const score = scoreBreakdown.reduce((sum, item) => sum + item.score, 0);
          if (score <= 0) {
            return null;
          }

          return {
            tag: summary.tag,
            role: summary.role,
            selector: summary.selector,
            href: summary.href,
            text: summary.text,
            accessibleName: summary.accessibleName,
            title: summary.title,
            className: summary.className,
            containerSelector:
              container instanceof HTMLElement
                ? helpers.buildSelector(container, { preferClasses: true })
                : undefined,
            containerTextPreview: containerText,
            score,
            scoreBreakdown,
          };
        })
        .filter(
          (
            candidate,
          ): candidate is NonNullable<typeof candidate> => Boolean(candidate),
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, args.maxResults);

      return {
        total: candidates.length,
        results: candidates,
      };
    },
    {
      query,
      maxResults: options.maxResults,
    },
  );

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    query,
    total: result.total,
    results: result.results,
  };
}
