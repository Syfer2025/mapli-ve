"""Build the local Ukraine territorial-control animation used by Theatrum.

The historical snapshots come from the Institute for the Study of War (ISW)
ArcGIS time-lapse layers.  The last frame is intentionally replaced by the
dated Liveuamap-derived geometry already used by the editor, so rebuilding the
animation never changes the approved final state.

This utility is not part of the application runtime.  It needs shapely, scipy
and rasterio in the Python environment used to run it.
"""

from __future__ import annotations

import calendar
import hashlib
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from bisect import bisect_right
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from affine import Affine
from rasterio.features import rasterize, shapes
from scipy.ndimage import distance_transform_edt
from shapely.geometry import GeometryCollection, mapping, shape
from shapely.ops import transform, unary_union


ROOT = Path(__file__).resolve().parents[1]
POLITICAL_PATH = ROOT / "data" / "territories" / "ukraine-political-control-2026-07-30.geojson"
OUTPUT_PATH = ROOT / "data" / "territories" / "ukraine-war-timeline-2022-2026.geojson"
CACHE_PATH = ROOT / ".tmp-ukraine-timeline-cache"

ISW_OVERVIEW_ITEM = "733fe90805894bfc8562d90b106aa895"
ISW_MASTER_CONTROL_LAYER = (
    "https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/"
    "UkrainianCoTTimelapse_FEB_2022_to_DEC_2024_view/FeatureServer/0"
)
ISW_PREWAR_CONTROL_LAYER = (
    "https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/"
    "VIEW_Russian_controlled_Ukrainian_Territory_before_February_24_2022/"
    "FeatureServer/36"
)

START_DATE = date(2022, 2, 23)
FINAL_DATE = date(2026, 7, 30)
FINAL_STATE_FRAME = 570
LAST_FRAME = 599
FRAME_STEP = 2

# A Mercator raster this size resolves roughly 1.5 km per pixel over Ukraine.
# The exported polygons are simplified below that threshold, keeping the
# overview clean while still retaining the recognizable front shape.
RASTER_WIDTH = 1180
RASTER_HEIGHT = 760
SIMPLIFY_METERS = 450
EARTH_RADIUS = 6_378_137.0

# Editorial pacing: the first five weeks get four seconds; the remaining years
# progressively compress.  Counteroffensives remain visible because the source
# snapshots are not accumulated.
PACE = (
    (0, date(2022, 2, 23)),
    (36, date(2022, 2, 25)),
    (72, date(2022, 2, 28)),
    (112, date(2022, 3, 3)),
    (154, date(2022, 3, 7)),
    (194, date(2022, 3, 14)),
    (240, date(2022, 3, 31)),
    (285, date(2022, 4, 10)),
    (310, date(2022, 4, 30)),
    (340, date(2022, 8, 31)),
    (380, date(2022, 9, 15)),
    (415, date(2022, 11, 15)),
    (440, date(2022, 12, 31)),
    (465, date(2023, 12, 31)),
    (490, date(2024, 12, 31)),
    (520, date(2025, 12, 31)),
    (545, date(2026, 5, 31)),
    (FINAL_STATE_FRAME, FINAL_DATE),
    (LAST_FRAME, FINAL_DATE),
)


@dataclass(frozen=True)
class Snapshot:
    day: date
    frame: float
    geometry: Any
    source: str


def fetch_json(url: str, parameters: dict[str, str] | None = None) -> dict[str, Any]:
    if parameters:
        url = f"{url}?{urllib.parse.urlencode(parameters)}"
    CACHE_PATH.mkdir(exist_ok=True)
    cache_file = CACHE_PATH / f"{hashlib.sha256(url.encode('utf-8')).hexdigest()}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Theatrum Ukraine timeline builder/1.0"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.load(response)
    cache_file.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    return result


def arcgis_item_data(item_id: str) -> dict[str, Any]:
    return fetch_json(
        f"https://www.arcgis.com/sharing/rest/content/items/{item_id}/data",
        {"f": "json"},
    )


def query_layer(
    layer_url: str,
    *,
    where: str,
    out_fields: str = "datetime",
    geometry: bool = True,
) -> dict[str, Any]:
    return fetch_json(
        f"{layer_url}/query",
        {
            "where": where,
            "outFields": out_fields,
            "returnGeometry": "true" if geometry else "false",
            "outSR": "4326",
            "resultRecordCount": "2000",
            "f": "geojson" if geometry else "json",
        },
    )


def feature_union(collection: dict[str, Any]) -> Any:
    geometries = [
        shape(feature["geometry"])
        for feature in collection.get("features", [])
        if feature.get("geometry") is not None
    ]
    return unary_union(geometries) if geometries else GeometryCollection()


def load_ukraine_and_final() -> tuple[Any, Any]:
    collection = json.loads(POLITICAL_PATH.read_text(encoding="utf-8"))
    ukraine = next(
        shape(feature["geometry"])
        for feature in collection["features"]
        if feature.get("properties", {}).get("kind") == "country"
        and feature.get("properties", {}).get("code") == "UKR"
    )
    final = next(
        shape(feature["geometry"])
        for feature in collection["features"]
        if feature.get("properties", {}).get("kind") == "occupied"
    )
    return ukraine, final


def month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def master_snapshot_days() -> list[date]:
    days: list[date] = []
    current = date(2022, 2, 24)
    while current <= date(2022, 3, 31):
        days.append(current)
        current += timedelta(days=1)
    days.extend(
        [
            date(2022, 4, 3),
            date(2022, 4, 7),
            date(2022, 4, 10),
            date(2022, 4, 15),
            date(2022, 4, 20),
            date(2022, 4, 25),
            date(2022, 4, 30),
            date(2022, 5, 31),
            date(2022, 6, 30),
            date(2022, 7, 31),
            date(2022, 8, 31),
            date(2022, 9, 5),
            date(2022, 9, 10),
            date(2022, 9, 15),
            date(2022, 9, 30),
            date(2022, 10, 15),
            date(2022, 10, 31),
            date(2022, 11, 5),
            date(2022, 11, 12),
            date(2022, 11, 20),
            date(2022, 11, 30),
            date(2022, 12, 31),
        ],
    )
    days.extend(month_end(year, month) for year in (2023, 2024) for month in range(1, 13))
    return sorted(set(days))


def frame_for_date(day: date) -> float:
    for (frame_a, day_a), (frame_b, day_b) in zip(PACE, PACE[1:]):
        if day <= day_b:
            span = max(1, (day_b - day_a).days)
            progress = max(0.0, min(1.0, (day - day_a).days / span))
            return frame_a + (frame_b - frame_a) * progress
    return float(LAST_FRAME)


def flatten_layers(layers: Iterable[dict[str, Any]]) -> Iterable[dict[str, Any]]:
    for layer in layers:
        yield layer
        yield from flatten_layers(layer.get("layers", []))


def control_layer_score(title: str) -> int:
    normalized = re.sub(r"\s+", " ", title.lower()).strip()
    if any(
        forbidden in normalized
        for forbidden in ("claimed", "counteroffensive", "advance", "infiltration", "before")
    ):
        return -1
    score = 0
    if "assessed russian-controlled" in normalized:
        score += 100
    if "ukraine control map" in normalized or "ukrainecontrolmap" in normalized:
        score += 90
    if "control of terrain" in normalized:
        score += 80
    if re.search(r"\bcot\b", normalized) or "_cot_" in normalized:
        score += 70
    if "control" in normalized:
        score += 20
    return score


def monthly_isw_layers() -> list[tuple[str, str]]:
    story = arcgis_item_data(ISW_OVERVIEW_ITEM)
    monthly_text = next(
        node["data"]["text"]
        for node in story["nodes"].values()
        if node.get("type") == "text"
        and "Monthly Time-lapses" in node.get("data", {}).get("text", "")
    )
    discovered: list[tuple[str, str]] = []
    for href, raw_label in re.findall(
        r'<a href="([^"]+)"[^>]*>(.*?)</a>',
        monthly_text,
        flags=re.DOTALL,
    ):
        label = re.sub(r"<[^>]+>", "", raw_label).strip()
        experience = re.search(r"/experience/([0-9a-f]+)", href)
        if experience is None or not re.search(r"202[56]", label):
            continue

        experience_data = arcgis_item_data(experience.group(1))
        map_widget = next(
            (
                widget
                for widget in experience_data.get("widgets", {}).values()
                if "arcgis-map" in widget.get("uri", "")
            ),
            None,
        )
        if map_widget is None:
            raise RuntimeError(f"{label}: ArcGIS map widget not found")
        source_id = map_widget.get("config", {}).get("initialMapDataSourceID")
        webmap_id = experience_data.get("dataSources", {}).get(source_id, {}).get("itemId")
        if not webmap_id:
            raise RuntimeError(f"{label}: active web map not found")

        webmap = arcgis_item_data(webmap_id)
        candidates = [
            layer
            for layer in flatten_layers(webmap.get("operationalLayers", []))
            if layer.get("url") and control_layer_score(layer.get("title", "")) >= 0
        ]
        if not candidates:
            raise RuntimeError(f"{label}: assessed control layer not found")
        selected = max(candidates, key=lambda layer: control_layer_score(layer.get("title", "")))
        discovered.append((label, selected["url"]))
    return discovered


def latest_layer_snapshot(layer_url: str) -> tuple[date, Any]:
    metadata = fetch_json(layer_url, {"f": "json"})
    time_field = metadata.get("timeInfo", {}).get("startTimeField")
    field_type = None
    if not time_field:
        date_fields = [
            field["name"]
            for field in metadata.get("fields", [])
            if field.get("type") == "esriFieldTypeDate"
        ]
        time_field = next(
            (candidate for candidate in ("datetime", "new_field", "date") if candidate in date_fields),
            date_fields[0] if date_fields else None,
        )
    if not time_field:
        string_date_fields = [
            field["name"]
            for field in metadata.get("fields", [])
            if field.get("type") == "esriFieldTypeString"
            and any(token in field.get("name", "").lower() for token in ("date", "time", "pub"))
        ]
        time_field = string_date_fields[0] if string_date_fields else None
    if not time_field:
        raise RuntimeError(f"{layer_url}: time field not found")
    field_type = next(
        (
            field.get("type")
            for field in metadata.get("fields", [])
            if field.get("name") == time_field
        ),
        None,
    )

    distinct = fetch_json(
        f"{layer_url}/query",
        {
            "where": "1=1",
            "outFields": time_field,
            "returnGeometry": "false",
            "returnDistinctValues": "true",
            "orderByFields": time_field,
            "resultRecordCount": "2000",
            "f": "json",
        },
    )
    values = [
        feature.get("attributes", {}).get(time_field)
        for feature in distinct.get("features", [])
    ]
    if field_type in ("esriFieldTypeString", "esriFieldTypeDateOnly"):
        parsed_days = []
        for value in values:
            try:
                parsed_days.append(date.fromisoformat(str(value)[:10]))
            except ValueError:
                continue
        if not parsed_days:
            raise RuntimeError(f"{layer_url}: no dated snapshots")
        latest_day = max(parsed_days)
        exact_where = f"{time_field} = '{latest_day.isoformat()}'"
    else:
        timestamps = [
            value for value in values if isinstance(value, (int, float)) and value > 0
        ]
        if not timestamps:
            raise RuntimeError(f"{layer_url}: no dated snapshots")
        latest = max(timestamps)
        latest_day = datetime.fromtimestamp(latest / 1000, tz=timezone.utc).date()
        exact_where = f"{time_field} = TIMESTAMP '{latest_day.isoformat()} 00:00:00'"
    geometry = feature_union(
        query_layer(
            layer_url,
            where=exact_where,
            out_fields=time_field,
        ),
    )
    if geometry.is_empty and field_type not in ("esriFieldTypeString", "esriFieldTypeDateOnly"):
        # Some layers retain a non-midnight timestamp. Query the full UTC day.
        next_day = latest_day + timedelta(days=1)
        geometry = feature_union(
            query_layer(
                layer_url,
                where=(
                    f"{time_field} >= TIMESTAMP '{latest_day.isoformat()} 00:00:00' "
                    f"AND {time_field} < TIMESTAMP '{next_day.isoformat()} 00:00:00'"
                ),
                out_fields=time_field,
            ),
        )
    return latest_day, geometry


def available_layer_days(layer_url: str, time_field: str) -> list[date]:
    distinct = fetch_json(
        f"{layer_url}/query",
        {
            "where": "1=1",
            "outFields": time_field,
            "returnGeometry": "false",
            "returnDistinctValues": "true",
            "orderByFields": time_field,
            "resultRecordCount": "2000",
            "f": "json",
        },
    )
    result = {
        datetime.fromtimestamp(value / 1000, tz=timezone.utc).date()
        for feature in distinct.get("features", [])
        if isinstance(
            value := feature.get("attributes", {}).get(time_field),
            (int, float),
        )
        and value > 0
    }
    return sorted(result)


def historic_snapshots(ukraine: Any, final: Any) -> list[Snapshot]:
    prewar = feature_union(
        query_layer(
            ISW_PREWAR_CONTROL_LAYER,
            where="1=1",
            out_fields="*",
        ),
    ).intersection(ukraine)
    snapshots = [
        Snapshot(
            day=START_DATE,
            frame=frame_for_date(START_DATE),
            geometry=prewar,
            source="ISW: controle anterior a 24/02/2022",
        ),
    ]

    available_master_days = available_layer_days(ISW_MASTER_CONTROL_LAYER, "datetime")
    resolved_master_days: list[date] = []
    for requested_day in master_snapshot_days():
        candidates = [day for day in available_master_days if day <= requested_day]
        if not candidates:
            raise RuntimeError(f"ISW has no snapshot on or before {requested_day.isoformat()}")
        resolved_master_days.append(candidates[-1])

    for index, day in enumerate(sorted(set(resolved_master_days)), start=1):
        collection = query_layer(
            ISW_MASTER_CONTROL_LAYER,
            where=f"datetime = TIMESTAMP '{day.isoformat()} 00:00:00'",
        )
        geometry = feature_union(collection).intersection(ukraine)
        if geometry.is_empty:
            raise RuntimeError(f"ISW master snapshot is empty: {day.isoformat()}")
        snapshots.append(
            Snapshot(
                day=day,
                frame=frame_for_date(day),
                geometry=geometry,
                source="ISW: controle territorial diário",
            ),
        )
        print(f"[{index:03d}] ISW {day.isoformat()}", flush=True)

    for label, layer_url in monthly_isw_layers():
        day, geometry = latest_layer_snapshot(layer_url)
        clipped = geometry.intersection(ukraine)
        if clipped.is_empty:
            raise RuntimeError(f"{label}: latest assessed-control geometry is empty")
        snapshots.append(
            Snapshot(
                day=day,
                frame=frame_for_date(day),
                geometry=clipped,
                source=f"ISW: {label}",
            ),
        )
        print(f"[month] {label}: {day.isoformat()}", flush=True)

    snapshots.append(
        Snapshot(
            day=FINAL_DATE,
            frame=float(FINAL_STATE_FRAME),
            geometry=final,
            source="Liveuamap: estado final aprovado de 30/07/2026",
        ),
    )

    # If two source dates collapse onto the same editorial frame, the newer
    # snapshot wins. This occurs only in the heavily compressed later years.
    by_frame: dict[float, Snapshot] = {}
    for snapshot in sorted(snapshots, key=lambda item: (item.frame, item.day)):
        by_frame[round(snapshot.frame, 4)] = snapshot
    return sorted(by_frame.values(), key=lambda item: item.frame)


def lonlat_to_mercator(x: float, y: float, z: float | None = None):
    latitude = max(-85.05112878, min(85.05112878, y))
    mx = EARTH_RADIUS * math.radians(x)
    my = EARTH_RADIUS * math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))
    return (mx, my) if z is None else (mx, my, z)


def mercator_to_lonlat(x: float, y: float, z: float | None = None):
    longitude = math.degrees(x / EARTH_RADIUS)
    latitude = math.degrees(2 * math.atan(math.exp(y / EARTH_RADIUS)) - math.pi / 2)
    return (longitude, latitude) if z is None else (longitude, latitude, z)


def signed_distance(mask: np.ndarray) -> np.ndarray:
    return (
        distance_transform_edt(mask).astype(np.float32)
        - distance_transform_edt(~mask).astype(np.float32)
    )


def mask_to_geometry(mask: np.ndarray, affine: Affine, ukraine_mercator: Any) -> Any:
    polygons = [
        shape(geometry)
        for geometry, value in shapes(
            mask.astype(np.uint8),
            mask=mask,
            transform=affine,
            connectivity=8,
        )
        if value == 1
    ]
    if not polygons:
        return GeometryCollection()
    merged = unary_union(polygons).intersection(ukraine_mercator)
    return merged.simplify(SIMPLIFY_METERS, preserve_topology=True)


def output_frames() -> list[int]:
    frames = list(range(0, LAST_FRAME, FRAME_STEP))
    if FINAL_STATE_FRAME not in frames:
        frames.append(FINAL_STATE_FRAME)
    if LAST_FRAME not in frames:
        frames.append(LAST_FRAME)
    return sorted(set(frames))


def build_timeline(snapshots: list[Snapshot], ukraine: Any, final: Any) -> dict[str, Any]:
    ukraine_mercator = transform(lonlat_to_mercator, ukraine)
    final_mercator = transform(lonlat_to_mercator, final)
    minx, miny, maxx, maxy = ukraine_mercator.bounds
    affine = Affine(
        (maxx - minx) / RASTER_WIDTH,
        0,
        minx,
        0,
        -(maxy - miny) / RASTER_HEIGHT,
        maxy,
    )
    ukraine_mask = rasterize(
        [(mapping(ukraine_mercator), 1)],
        out_shape=(RASTER_HEIGHT, RASTER_WIDTH),
        transform=affine,
        fill=0,
        dtype=np.uint8,
        all_touched=True,
    ).astype(bool)

    projected = [transform(lonlat_to_mercator, item.geometry) for item in snapshots]
    masks = [
        rasterize(
            [(mapping(geometry), 1)],
            out_shape=(RASTER_HEIGHT, RASTER_WIDTH),
            transform=affine,
            fill=0,
            dtype=np.uint8,
            all_touched=True,
        ).astype(bool)
        & ukraine_mask
        for geometry in projected
    ]
    distances = [signed_distance(mask) for mask in masks]
    snapshot_frames = [snapshot.frame for snapshot in snapshots]

    features: list[dict[str, Any]] = []
    for output_index, frame in enumerate(output_frames()):
        if frame >= FINAL_STATE_FRAME:
            geometry_mercator = final_mercator
            display_day = FINAL_DATE
            left = right = len(snapshots) - 1
            progress = 1.0
        else:
            right = bisect_right(snapshot_frames, frame)
            right = min(max(1, right), len(snapshots) - 1)
            left = right - 1
            frame_a = snapshot_frames[left]
            frame_b = snapshot_frames[right]
            progress = 0.0 if frame_b == frame_a else (frame - frame_a) / (frame_b - frame_a)
            progress = max(0.0, min(1.0, progress))
            interpolated = (1.0 - progress) * distances[left] + progress * distances[right]
            mask = (interpolated >= 0) & ukraine_mask
            geometry_mercator = mask_to_geometry(mask, affine, ukraine_mercator)
            days = (snapshots[right].day - snapshots[left].day).days
            display_day = snapshots[left].day + timedelta(days=round(days * progress))

        geometry_lonlat = (
            final
            if frame >= FINAL_STATE_FRAME
            else transform(mercator_to_lonlat, geometry_mercator).intersection(ukraine)
        )
        features.append(
            {
                "type": "Feature",
                "id": f"war-frame-{frame:03d}",
                "properties": {
                    "kind": "occupied_timeline",
                    "frame": frame,
                    "date": display_day.isoformat(),
                    "source_from": snapshots[left].source,
                    "source_to": snapshots[right].source,
                    "source_progress": round(progress, 4),
                },
                "geometry": mapping(geometry_lonlat),
            },
        )
        print(
            f"[frame {frame:03d}] {display_day.isoformat()} "
            f"parts={len(getattr(geometry_lonlat, 'geoms', [geometry_lonlat]))}",
            flush=True,
        )

    return {
        "type": "FeatureCollection",
        "name": "Progressão territorial da guerra na Ucrânia, 2022–2026",
        "theatrum": {
            "fps": 60,
            "durationFrames": 600,
            "frameStep": FRAME_STEP,
            "startDate": START_DATE.isoformat(),
            "finalDate": FINAL_DATE.isoformat(),
            "finalStateFrame": FINAL_STATE_FRAME,
            "method": (
                "Interpolação por distância assinada entre snapshots de controle territorial "
                "do ISW; quadro final substituído pelo recorte Liveuamap aprovado."
            ),
            "iswOverviewItem": ISW_OVERVIEW_ITEM,
        },
        "features": features,
    }


def main() -> int:
    if not POLITICAL_PATH.exists():
        print(f"missing political-control file: {POLITICAL_PATH}", file=sys.stderr)
        return 1
    ukraine, final = load_ukraine_and_final()
    snapshots = historic_snapshots(ukraine, final)
    print(f"building {len(output_frames())} frames from {len(snapshots)} snapshots", flush=True)
    timeline = build_timeline(snapshots, ukraine, final)
    OUTPUT_PATH.write_text(
        json.dumps(timeline, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size / 1_048_576:.1f} MiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
