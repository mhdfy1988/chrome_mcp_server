import type {
  BindingAttachableElement,
  BindingRecord,
} from "./binding-record.js";
import {
  buildBindingFallbackAnchors,
  buildBindingFingerprint,
} from "./binding-record.js";

export interface AttachedElementRefsResult<
  T extends BindingAttachableElement,
> {
  elementsWithRefs: Array<T & { ref: string }>;
  nextSnapshotCounter: number;
}

export class BindingRegistry {
  private readonly pageRefs = new Map<string, Map<string, BindingRecord>>();

  public ensurePage(pageId: string): void {
    this.pageRefs.set(pageId, this.pageRefs.get(pageId) ?? new Map());
  }

  public removePage(pageId: string): void {
    this.pageRefs.delete(pageId);
  }

  public clear(): void {
    this.pageRefs.clear();
  }

  public attachElementRefs<T extends BindingAttachableElement>(
    pageId: string,
    elements: T[],
    snapshotCounter: number,
  ): AttachedElementRefsResult<T> {
    const refMap = this.pageRefs.get(pageId) ?? new Map<string, BindingRecord>();
    const selectorToRef = new Map<string, string>();
    for (const [ref, record] of refMap.entries()) {
      if (!selectorToRef.has(record.selector)) {
        selectorToRef.set(record.selector, ref);
      }
    }

    const tagCounters = new Map<string, number>();
    const snapshotId = `s${snapshotCounter}`;
    let createdNewRef = false;

    const elementsWithRefs = elements.map((element) => {
      const existingRef = selectorToRef.get(element.selector);
      if (existingRef) {
        const existingRecord = refMap.get(existingRef);
        if (existingRecord) {
          existingRecord.selector = element.selector;
          existingRecord.runtimeNodeKey = element.runtimeNodeKey;
          existingRecord.fingerprint = buildBindingFingerprint(element);
          existingRecord.contextAnchor = element.contextAnchor;
          existingRecord.fallbackAnchors = buildBindingFallbackAnchors(element);
          existingRecord.tag = element.tag;
          existingRecord.role = element.role;
          existingRecord.semanticRole = element.semanticRole;
          existingRecord.axRole = element.axRole;
          existingRecord.updatedAt = new Date().toISOString();
        }
        return {
          ...element,
          ref: existingRef,
        };
      }

      const normalizedTag = normalizeRefPart(element.tag || "element");
      const nextIndex = (tagCounters.get(normalizedTag) ?? 0) + 1;
      tagCounters.set(normalizedTag, nextIndex);
      const ref = `${snapshotId}-${normalizedTag}-${nextIndex}`;
      const timestamp = new Date().toISOString();
      refMap.set(ref, {
        ref,
        pageId,
        selector: element.selector,
        runtimeNodeKey: element.runtimeNodeKey,
        fingerprint: buildBindingFingerprint(element),
        contextAnchor: element.contextAnchor,
        fallbackAnchors: buildBindingFallbackAnchors(element),
        tag: element.tag,
        role: element.role,
        semanticRole: element.semanticRole,
        axRole: element.axRole,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      selectorToRef.set(element.selector, ref);
      createdNewRef = true;
      return {
        ...element,
        ref,
      };
    });

    this.pageRefs.set(pageId, refMap);

    return {
      elementsWithRefs,
      nextSnapshotCounter: createdNewRef ? snapshotCounter + 1 : snapshotCounter,
    };
  }

  public resolveSelectorForRef(pageId: string, ref: string): string {
    const pageRefs = this.pageRefs.get(pageId);
    const record = pageRefs?.get(ref);
    if (!record) {
      throw new Error(
        `找不到元素引用 ${ref}，请重新执行 page_snapshot 或 find_elements 获取最新 ref。`,
      );
    }

    return record.selector;
  }

  public getBindingRecord(pageId: string, ref: string): BindingRecord | undefined {
    return this.pageRefs.get(pageId)?.get(ref);
  }
}

function normalizeRefPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "element";
}
