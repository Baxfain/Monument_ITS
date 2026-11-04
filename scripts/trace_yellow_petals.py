#!/usr/bin/env python3
"""Trace the five painted yellow lotus regions from the supplied emblem photo.

The high-saturation HSV mask supplies interior markers; a lower threshold marks
yellow fill pixels, and marker-controlled watershed grows each marker to the
dark painted seams. OpenCV simplifies each pixel contour to a 0.65 px tolerance.
All five point sets are normalized through one source-image frame and one shared
world scale. This is an offline authoring tool; the scene still uses extruded
vector contours at runtime.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE_IMAGE = ROOT / "assets/reference/emblem-detail.jpeg"
FACE_CROP = ROOT / "docs/analysis/evidence/crops/emblem_face.jpg"
OUTPUT = ROOT / "docs/planning/evidence/yellow-petal-traced"
DATA_MODULE = ROOT / "src/yellow-petal-contours.js"

PETAL_NAMES = ("outerLeft", "innerLeft", "center", "innerRight", "outerRight")
FILL_HSV_LOW = (15, 45, 75)
FILL_HSV_HIGH = (42, 255, 255)
SEED_HSV_LOW = (17, 60, 65)
SEED_HSV_HIGH = (40, 255, 255)
SEED_OPEN_KERNEL = 5
MIN_SEED_AREA = 1000
SEED_BBOX_MARGIN = 8
CONTOUR_TOLERANCE_PX = 0.65
PETAL_HEIGHT_WORLD = 0.38
PETAL_COLORS_RGB = {
    "outerLeft": (239, 75, 95),
    "innerLeft": (56, 180, 233),
    "center": (123, 223, 51),
    "innerRight": (218, 76, 231),
    "outerRight": (62, 102, 232),
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def as_rgb(bgr: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def find_face_origin(source: np.ndarray, face: np.ndarray) -> tuple[int, int, float]:
    result = cv2.matchTemplate(source, face, cv2.TM_CCOEFF_NORMED)
    _, score, _, location = cv2.minMaxLoc(result)
    require(score >= 0.999, f"Face crop did not match the supplied reference (score {score:.6f}).")
    return location[0], location[1], float(score)


def rgb_color(name: str) -> tuple[int, int, int]:
    return PETAL_COLORS_RGB[name]


def draw_centered_label(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, scale: int = 1) -> None:
    font = ImageFont.truetype("DejaVuSans-Bold.ttf", 8 * scale)
    x, y = xy
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=scale)
    draw.text(
        (int(x - (bbox[2] - bbox[0]) / 2), int(y - (bbox[3] - bbox[1]) / 2)),
        text,
        font=font,
        fill=(255, 255, 255),
        stroke_width=scale,
        stroke_fill=(20, 20, 20),
    )


def format_number(value: float) -> str:
    return f"{value:.7f}".rstrip("0").rstrip(".")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = cv2.imread(str(SOURCE_IMAGE), cv2.IMREAD_COLOR)
    face_reference = cv2.imread(str(FACE_CROP), cv2.IMREAD_COLOR)
    require(source is not None, f"Cannot read source image: {SOURCE_IMAGE}")
    require(face_reference is not None, f"Cannot read face crop: {FACE_CROP}")

    crop_x, crop_y, match_score = find_face_origin(source, face_reference)
    crop_h, crop_w = face_reference.shape[:2]
    face = source[crop_y : crop_y + crop_h, crop_x : crop_x + crop_w].copy()
    require(face.shape == face_reference.shape, "Matched source crop has unexpected dimensions.")
    source_difference = float(np.abs(face.astype(np.int16) - face_reference.astype(np.int16)).mean())

    hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)
    fill_mask = cv2.inRange(hsv, np.array(FILL_HSV_LOW, np.uint8), np.array(FILL_HSV_HIGH, np.uint8))
    seed_mask = cv2.inRange(hsv, np.array(SEED_HSV_LOW, np.uint8), np.array(SEED_HSV_HIGH, np.uint8))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (SEED_OPEN_KERNEL, SEED_OPEN_KERNEL))
    seed_mask = cv2.morphologyEx(seed_mask, cv2.MORPH_OPEN, kernel)
    component_count, seed_labels, seed_stats, seed_centroids = cv2.connectedComponentsWithStats(seed_mask, 8)
    seed_components = [
        index
        for index in range(1, component_count)
        if int(seed_stats[index, cv2.CC_STAT_AREA]) >= MIN_SEED_AREA
    ]
    seed_components.sort(key=lambda index: float(seed_centroids[index, 0]))
    require(
        len(seed_components) == 5,
        "HSV core extraction must produce five large petal seeds; "
        f"found {len(seed_components)} with threshold {SEED_HSV_LOW}..{SEED_HSV_HIGH}.",
    )

    # Keep color-like background noise out of the watershed domain. This box is
    # derived from the five source-image seed components, not assumed crop bounds.
    seed_left = min(int(seed_stats[index, cv2.CC_STAT_LEFT]) for index in seed_components)
    seed_top = min(int(seed_stats[index, cv2.CC_STAT_TOP]) for index in seed_components)
    seed_right = max(
        int(seed_stats[index, cv2.CC_STAT_LEFT] + seed_stats[index, cv2.CC_STAT_WIDTH])
        for index in seed_components
    )
    seed_bottom = max(
        int(seed_stats[index, cv2.CC_STAT_TOP] + seed_stats[index, cv2.CC_STAT_HEIGHT])
        for index in seed_components
    )
    roi_left = max(0, seed_left - SEED_BBOX_MARGIN)
    roi_top = max(0, seed_top - SEED_BBOX_MARGIN)
    roi_right = min(crop_w, seed_right + SEED_BBOX_MARGIN)
    roi_bottom = min(crop_h, seed_bottom + SEED_BBOX_MARGIN)
    roi_mask = np.zeros(fill_mask.shape, np.uint8)
    roi_mask[roi_top:roi_bottom, roi_left:roi_right] = 255
    fill_mask = cv2.bitwise_and(fill_mask, roi_mask)

    markers = np.ones(fill_mask.shape, np.int32)
    markers[fill_mask > 0] = 0
    seed_metadata = []
    for marker_id, (name, component) in enumerate(zip(PETAL_NAMES, seed_components), start=2):
        markers[seed_labels == component] = marker_id
        seed_metadata.append(
            {
                "name": name,
                "area": int(seed_stats[component, cv2.CC_STAT_AREA]),
                "bbox": [int(value) for value in seed_stats[component, :4]],
                "centroid": [round(float(value), 3) for value in seed_centroids[component]],
            }
        )

    watershed_labels = cv2.watershed(face, markers)
    region_masks = {
        name: ((fill_mask > 0) & (watershed_labels == marker_id)).astype(np.uint8)
        for marker_id, name in enumerate(PETAL_NAMES, start=2)
    }
    yellow_pixels = int(np.count_nonzero(fill_mask))
    labeled_pixels = sum(int(np.count_nonzero(mask)) for mask in region_masks.values())
    unassigned_pixels = yellow_pixels - labeled_pixels
    require(yellow_pixels > 0, "HSV fill mask found no yellow pixels.")
    require(unassigned_pixels >= 0, "Watershed labels overlap the yellow mask unexpectedly.")
    require(
        unassigned_pixels / yellow_pixels < 0.02,
        f"Watershed left {unassigned_pixels / yellow_pixels:.1%} of yellow mask pixels unlabeled.",
    )

    contours: dict[str, np.ndarray] = {}
    records: dict[str, dict] = {}
    for name, mask in region_masks.items():
        found, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        require(bool(found), f"Watershed produced no contour for {name}.")
        contour = max(found, key=cv2.contourArea)
        simplified = cv2.approxPolyDP(contour, CONTOUR_TOLERANCE_PX, True).reshape(-1, 2)
        require(len(simplified) >= 8, f"Simplified {name} contour has too few vertices: {len(simplified)}.")
        contours[name] = simplified.astype(np.float64)
        x, y, width, height = cv2.boundingRect(contour)
        records[name] = {
            "area_pixels": int(cv2.contourArea(contour)),
            "mask_pixel_count": int(np.count_nonzero(mask)),
            "contour_vertices": int(len(simplified)),
            "pixel_bbox_crop_xywh": [int(x), int(y), int(width), int(height)],
        }

    center_points = contours["center"]
    tip_y = float(np.min(center_points[:, 1]))
    root_y = float(np.max(center_points[:, 1]))
    tip_x = float(np.mean(center_points[np.isclose(center_points[:, 1], tip_y), 0]))
    root_x = float(np.mean(center_points[np.isclose(center_points[:, 1], root_y), 0]))
    axis_x = (tip_x + root_x) / 2
    all_points = np.concatenate(list(contours.values()), axis=0)
    frame_min_x = float(np.min(all_points[:, 0]))
    frame_max_x = float(np.max(all_points[:, 0]))
    frame_width_px = frame_max_x - frame_min_x
    frame_height_px = root_y - tip_y
    require(frame_width_px > 0 and frame_height_px > 0, "Traced flower frame has invalid dimensions.")
    world_width = PETAL_HEIGHT_WORLD * frame_width_px / frame_height_px

    normalized: dict[str, list[list[float]]] = {}
    source_pixel_contours: dict[str, list[list[float]]] = {}
    for name, points in contours.items():
        source_points = points + np.array([crop_x, crop_y], np.float64)
        source_pixel_contours[name] = [[round(float(x), 3), round(float(y), 3)] for x, y in source_points]
        normalized[name] = [
            [
                (float(x) - axis_x) / frame_width_px,
                (root_y - float(y)) / frame_height_px,
            ]
            for x, y in points
        ]
        records[name]["normalized_bbox"] = [
            round(min(point[0] for point in normalized[name]), 6),
            round(min(point[1] for point in normalized[name]), 6),
            round(max(point[0] for point in normalized[name]), 6),
            round(max(point[1] for point in normalized[name]), 6),
        ]

    data_module = [
        "// Generated by scripts/trace_yellow_petals.py from the source yellow fill regions.",
        "// One shared pixel-to-model frame; do not normalize individual petals separately.",
        f"// Source: {SOURCE_IMAGE.relative_to(ROOT).as_posix()} (face crop matched at [{crop_x}, {crop_y}]).",
        f"// HSV fill: {FILL_HSV_LOW}..{FILL_HSV_HIGH}; five eroded HSV seed components; ",
        f"// marker watershed; {CONTOUR_TOLERANCE_PX:.2f}px closed-contour simplification.",
        f"export const YELLOW_PETAL_WIDTH = {format_number(world_width)};",
        f"export const YELLOW_PETAL_HEIGHT = {format_number(PETAL_HEIGHT_WORLD)};",
        "export const YELLOW_PETAL_CONTOURS = {",
    ]
    for name in PETAL_NAMES:
        data_module.append(f"  {name}: {{ points: [")
        data_module.extend(
            "    [" + format_number(point[0]) + ", " + format_number(point[1]) + "],"
            for point in normalized[name]
        )
        data_module.append("  ] },")
    data_module.append("};")
    DATA_MODULE.write_text("\n".join(data_module) + "\n", encoding="utf-8")

    # The proof mask is cropped only for legibility; contour coordinates above
    # remain in the single full-source crop frame.
    all_crop_points = np.concatenate(list(contours.values()), axis=0)
    margin = 8
    left = max(0, int(np.floor(np.min(all_crop_points[:, 0]))) - margin)
    top = max(0, int(np.floor(np.min(all_crop_points[:, 1]))) - margin)
    right = min(crop_w, int(np.ceil(np.max(all_crop_points[:, 0]))) + margin + 1)
    bottom = min(crop_h, int(np.ceil(np.max(all_crop_points[:, 1]))) + margin + 1)
    crop_region = (slice(top, bottom), slice(left, right))

    label_image = np.zeros((bottom - top, right - left, 3), np.uint8)
    raw_label_image = np.zeros((bottom - top, right - left), np.uint8)
    overlay = as_rgb(face)[crop_region].copy()
    contour_overlay = overlay.copy()
    masks_crop = {}
    for label_value, name in enumerate(PETAL_NAMES, 1):
        mask = region_masks[name][crop_region] > 0
        masks_crop[name] = mask
        color = np.array(rgb_color(name), np.uint8)
        label_image[mask] = color
        raw_label_image[mask] = label_value
        overlay[mask] = (overlay[mask].astype(np.float32) * 0.38 + color * 0.62).astype(np.uint8)
        points = np.round(contours[name] - np.array([left, top])).astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(contour_overlay, [points], True, color.tolist(), 1, cv2.LINE_AA)

    # Show extracted digital boundaries in white so any seam leaks are visible.
    label_edges = np.zeros(label_image.shape[:2], np.uint8)
    gray_labels = np.zeros(label_image.shape[:2], np.uint8)
    for index, name in enumerate(PETAL_NAMES, 1):
        gray_labels[masks_crop[name]] = index
    label_edges[cv2.Canny(gray_labels, 0, 1) > 0] = 255
    label_image[label_edges > 0] = (255, 255, 255)

    # Draw text labels after the pixel masks so a human can verify each region.
    label_pil = Image.fromarray(label_image)
    label_draw = ImageDraw.Draw(label_pil)
    overlay_pil = Image.fromarray(overlay)
    overlay_draw = ImageDraw.Draw(overlay_pil)
    contour_pil = Image.fromarray(contour_overlay)
    contour_draw = ImageDraw.Draw(contour_pil)
    for index, name in enumerate(PETAL_NAMES, 1):
        points = contours[name]
        cx = float(np.mean(points[:, 0])) - left
        cy = float(np.mean(points[:, 1])) - top
        text = str(index)
        draw_centered_label(label_draw, (cx, cy), str(index))
        draw_centered_label(overlay_draw, (cx, cy), text)
        draw_centered_label(contour_draw, (cx, cy), str(index))

    nearest = Image.Resampling.NEAREST
    Image.fromarray(raw_label_image).save(OUTPUT / "source-petal-label-mask.png")
    label_pil.resize((label_pil.width * 3, label_pil.height * 3), nearest).save(OUTPUT / "source-component-labels.png")
    overlay_pil.resize((overlay_pil.width * 3, overlay_pil.height * 3), nearest).save(OUTPUT / "source-component-overlay.png")
    contour_pil.resize((contour_pil.width * 3, contour_pil.height * 3), nearest).save(OUTPUT / "source-traced-contours.png")

    report = {
        "source": SOURCE_IMAGE.relative_to(ROOT).as_posix(),
        "face_crop": FACE_CROP.relative_to(ROOT).as_posix(),
        "face_crop_match_origin_xy": [crop_x, crop_y],
        "face_crop_match_ncc": round(match_score, 7),
        "mean_source_crop_rgb_difference": round(source_difference, 4),
        "source_frame": {
            "crop_xy": [crop_x, crop_y],
            "flower_axis_x_source": round(crop_x + axis_x, 4),
            "center_apex_xy_source": [round(crop_x + tip_x, 4), round(crop_y + tip_y, 4)],
            "center_root_xy_source": [round(crop_x + root_x, 4), round(crop_y + root_y, 4)],
            "visible_flower_width_pixels": round(frame_width_px, 4),
            "center_tip_to_root_pixels": round(frame_height_px, 4),
            "world_height": PETAL_HEIGHT_WORLD,
            "common_world_width_preserving_source_aspect": round(world_width, 7),
            "world_units_per_source_pixel": round(PETAL_HEIGHT_WORLD / frame_height_px, 8),
        },
        "method": {
            "fill_hsv_low_in_opencv_hsv": list(FILL_HSV_LOW),
            "fill_hsv_high_in_opencv_hsv": list(FILL_HSV_HIGH),
            "seed_hsv_low_in_opencv_hsv": list(SEED_HSV_LOW),
            "seed_hsv_high_in_opencv_hsv": list(SEED_HSV_HIGH),
            "seed_open_kernel": [SEED_OPEN_KERNEL, SEED_OPEN_KERNEL],
            "min_seed_area_pixels": MIN_SEED_AREA,
            "seed_roi_margin_pixels": SEED_BBOX_MARGIN,
            "seed_derived_roi_crop_xywh": [roi_left, roi_top, roi_right - roi_left, roi_bottom - roi_top],
            "simplification_tolerance_pixels": CONTOUR_TOLERANCE_PX,
            "fill_mask_pixels": yellow_pixels,
            "labeled_fill_pixels": labeled_pixels,
            "unassigned_fill_pixels_at_watershed_seams": unassigned_pixels,
            "unassigned_fraction": round(unassigned_pixels / yellow_pixels, 7),
        },
        "seed_components": seed_metadata,
        "source_mask": {
            "crop_origin_full_source_xy": [crop_x + left, crop_y + top],
            "crop_size_wh": [right - left, bottom - top],
            "pixel_values": {str(index): name for index, name in enumerate(PETAL_NAMES, 1)},
        },
        "petals": records,
        "source_pixel_contours_xy": source_pixel_contours,
        "common_frame_normalized_contours": normalized,
    }
    (OUTPUT / "source-yellow-contours.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "output": str(OUTPUT),
        "module": str(DATA_MODULE),
        "crop_origin": [crop_x, crop_y],
        "petal_names": list(PETAL_NAMES),
        "contour_vertices": {name: records[name]["contour_vertices"] for name in PETAL_NAMES},
        "world_size": [round(world_width, 7), PETAL_HEIGHT_WORLD],
        "unassigned_fill_fraction": round(unassigned_pixels / yellow_pixels, 7),
    }, indent=2))


if __name__ == "__main__":
    main()
