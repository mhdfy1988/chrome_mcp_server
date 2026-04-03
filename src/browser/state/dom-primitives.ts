export interface InspectionDomPrimitives {
  normalizeWhitespace(value: unknown): string;
  clipText(value: string, maxLength: number): string;
  isVisible(element: Element): boolean;
}

export function createInspectionDomPrimitives(): InspectionDomPrimitives {
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

  return {
    normalizeWhitespace,
    clipText,
    isVisible,
  };
}
