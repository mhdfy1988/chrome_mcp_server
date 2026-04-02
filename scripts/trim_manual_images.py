from __future__ import annotations

"""
截图自动裁切只做第一轮收边，不能替代人工验收。

交付到文档前，必须逐张目视确认：
1. 关键页签、标题、按钮没有被切掉
2. 主体区域没有从半截开始
3. 留白量合适，不过紧也不过松
"""

from collections import Counter
from pathlib import Path

from PIL import Image


WORKSPACE = Path(r"D:\C_Project\chrome_mcp_server")
SCREENSHOTS_DIR = WORKSPACE / "docs" / "screenshots"
PADDING = 8
COLOR_TOLERANCE = 18
DENSITY_RATIO = 0.05
MIN_ACTIVE_PIXELS = 10
SMOOTHING_WINDOW = 21


def pick_background_color(image: Image.Image) -> tuple[int, int, int]:
    width, height = image.size
    corners = [
        image.getpixel((0, 0)),
        image.getpixel((width - 1, 0)),
        image.getpixel((0, height - 1)),
        image.getpixel((width - 1, height - 1)),
    ]
    return Counter(corners).most_common(1)[0][0]


def is_content_pixel(pixel: tuple[int, int, int], bg: tuple[int, int, int]) -> bool:
    return any(abs(pixel[i] - bg[i]) > COLOR_TOLERANCE for i in range(3))


def smooth_counts(values: list[int], window: int) -> list[float]:
    half = window // 2
    prefix = [0]
    for value in values:
        prefix.append(prefix[-1] + value)

    result: list[float] = []
    for index in range(len(values)):
        left = max(0, index - half)
        right = min(len(values), index + half + 1)
        total = prefix[right] - prefix[left]
        result.append(total / (right - left))
    return result


def pick_main_segment(values: list[int]) -> tuple[int, int]:
    smoothed = smooth_counts(values, SMOOTHING_WINDOW)
    threshold = max(MIN_ACTIVE_PIXELS, max(smoothed) * DENSITY_RATIO)
    active = [value >= threshold for value in smoothed]

    best_start = 0
    best_end = len(values) - 1
    current_start = None
    best_length = -1

    for index, flag in enumerate(active):
        if flag and current_start is None:
            current_start = index
        if not flag and current_start is not None:
            length = index - current_start
            if length > best_length:
                best_start = current_start
                best_end = index - 1
                best_length = length
            current_start = None

    if current_start is not None:
        length = len(active) - current_start
        if length > best_length:
            best_start = current_start
            best_end = len(active) - 1

    return best_start, best_end


def find_trim_box(image: Image.Image) -> tuple[int, int, int, int]:
    width, height = image.size
    bg = pick_background_color(image)
    pixels = image.load()

    col_counts: list[int] = []
    for x in range(width):
        count = 0
        for y in range(height):
            if is_content_pixel(pixels[x, y], bg):
                count += 1
        col_counts.append(count)

    row_counts: list[int] = []
    for y in range(height):
        count = 0
        for x in range(width):
            if is_content_pixel(pixels[x, y], bg):
                count += 1
        row_counts.append(count)

    left, right = pick_main_segment(col_counts)
    top, bottom = pick_main_segment(row_counts)

    return (
        max(0, left - PADDING),
        max(0, top - PADDING),
        min(width, right + PADDING + 1),
        min(height, bottom + PADDING + 1),
    )


def trim_image(path: Path) -> None:
    image = Image.open(path).convert("RGB")
    trim_box = find_trim_box(image)
    cropped = image.crop(trim_box)
    if cropped.size != image.size:
        cropped.save(path)
        print(f"{path.name}: {image.size[0]}x{image.size[1]} -> {cropped.size[0]}x{cropped.size[1]}")
    else:
        print(f"{path.name}: unchanged ({image.size[0]}x{image.size[1]})")


def main() -> None:
    for path in sorted(SCREENSHOTS_DIR.glob("*.png")):
        trim_image(path)


if __name__ == "__main__":
    main()
