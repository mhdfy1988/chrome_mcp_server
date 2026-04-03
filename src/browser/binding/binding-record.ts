import type { SnapshotElementSummary } from "../discovery/types.js";

export interface BindingAttachableElement
  extends Pick<SnapshotElementSummary, "tag" | "selector">,
    Partial<
      Pick<
        SnapshotElementSummary,
        | "role"
        | "type"
        | "text"
        | "accessibleName"
        | "label"
        | "placeholder"
        | "title"
        | "name"
        | "href"
        | "runtimeNodeKey"
        | "contextAnchor"
        | "semanticRole"
        | "axRole"
      >
    > {}

export interface BindingRecord {
  ref: string;
  pageId: string;
  selector: string;
  runtimeNodeKey?: string;
  fingerprint: string;
  contextAnchor?: string;
  fallbackAnchors: string[];
  tag: string;
  role?: string;
  semanticRole?: string;
  axRole?: string;
  createdAt: string;
  updatedAt: string;
}

export function buildBindingFingerprint(
  element: BindingAttachableElement,
): string {
  const parts = [
    `tag=${normalizeFingerprintPart(element.tag)}`,
    element.role ? `role=${normalizeFingerprintPart(element.role)}` : undefined,
    element.type ? `type=${normalizeFingerprintPart(element.type)}` : undefined,
    element.accessibleName
      ? `name=${normalizeFingerprintPart(element.accessibleName)}`
      : undefined,
    element.label ? `label=${normalizeFingerprintPart(element.label)}` : undefined,
    element.title ? `title=${normalizeFingerprintPart(element.title)}` : undefined,
    element.placeholder
      ? `placeholder=${normalizeFingerprintPart(element.placeholder)}`
      : undefined,
    element.name ? `attrName=${normalizeFingerprintPart(element.name)}` : undefined,
    element.href ? `href=${normalizeFingerprintPart(element.href)}` : undefined,
    element.contextAnchor
      ? `context=${normalizeFingerprintPart(element.contextAnchor)}`
      : undefined,
    element.text ? `text=${normalizeFingerprintPart(element.text)}` : undefined,
  ].filter(Boolean);

  return parts.join("|");
}

export function buildBindingFallbackAnchors(
  element: BindingAttachableElement,
): string[] {
  const anchors = [
    element.selector,
    element.href,
    element.contextAnchor,
    element.accessibleName,
    element.label,
    element.title,
    element.placeholder,
    element.name,
    element.text,
  ].filter((value): value is string => Boolean(value?.trim()));

  return Array.from(new Set(anchors));
}

function normalizeFingerprintPart(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}
