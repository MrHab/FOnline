"""Build a reproducible rifle grip revision from an approved review scene."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_unified_rifle_review_v4 import export_glb


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend-output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--asset-id", default="rifle_unified_v5")
    parser.add_argument("--primary-grip-x", type=float, default=0.030)
    parser.add_argument("--primary-grip-y", type=float, default=-0.025)
    parser.add_argument("--primary-grip-z", type=float, default=-0.020)
    parser.add_argument("--support-grip-x", type=float, default=-0.010)
    parser.add_argument("--support-grip-y", type=float, default=0.330)
    parser.add_argument("--support-grip-z", type=float, default=0.105)
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    bpy.ops.wm.open_mainfile(filepath=str(args.source_blend.resolve()))

    root = bpy.data.objects.get("weapon_rifle_unified_v4")
    if root is None:
        root = next(
            (
                obj
                for obj in bpy.context.scene.objects
                if obj.get("realm_asset_id") == "rifle_unified_v4"
            ),
            None,
        )
    if root is None:
        raise RuntimeError("Source scene has no rifle_unified_v4 root")

    support_socket = bpy.data.objects.get("socket_grip_l")
    primary_socket = bpy.data.objects.get("socket_grip_r")
    if support_socket is None or primary_socket is None:
        raise RuntimeError("Source scene has no two-hand grip sockets")

    root.name = f"weapon_{args.asset_id}"
    root["realm_asset_id"] = args.asset_id
    root["realm_review_only"] = True
    root["realm_runtime_integration_allowed"] = False
    root["realm_grip_revision"] = (
        "primary hand moved onto pistol grip; support hand moved to handguard"
    )
    primary_socket.location.x = args.primary_grip_x
    primary_socket.location.y = args.primary_grip_y
    primary_socket.location.z = args.primary_grip_z
    support_socket.location.x = args.support_grip_x
    support_socket.location.y = args.support_grip_y
    support_socket.location.z = args.support_grip_z
    forward_offset = support_socket.location.y - primary_socket.location.y
    if forward_offset < 0.30:
        raise RuntimeError(
            "Support grip must be at least 0.30 m ahead of the primary grip"
        )

    report = export_glb(args.output, args.asset_id)
    report["gripRevision"] = {
        "sourceAsset": "rifle_unified_v4",
        "primaryGripXMetres": round(primary_socket.location.x, 4),
        "primaryGripYMetres": round(primary_socket.location.y, 4),
        "primaryGripZMetres": round(primary_socket.location.z, 4),
        "supportGripXMetres": round(support_socket.location.x, 4),
        "supportGripYMetres": round(support_socket.location.y, 4),
        "supportGripZMetres": round(support_socket.location.z, 4),
        "supportGripForwardOffsetMetres": round(forward_offset, 4),
        "purpose": (
            "right palm wraps the pistol grip; left palm contacts the "
            "handguard ahead of the magazine"
        ),
    }

    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    print(
        "REALM_UNIFIED_RIFLE_GRIP_REVISION="
        + json.dumps(report, ensure_ascii=False, sort_keys=True)
    )


if __name__ == "__main__":
    main()
