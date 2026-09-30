#if UNITY_EDITOR
using System;
using System.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Стороны края зоны на клиенте: север — +Z, как у компаса, миникарты и сервера
    /// (serverPlayerAtZoneEdge). Проба ставит край зоны 160 × 160 тайлов с одной
    /// открытой северной стороной и проверяет, что полоса перехода, её стрелки и
    /// невидимый упор лежат у +Z, закрытая южная сторона — пунктир и стена у −Z, а
    /// автопереход (IsInSideBand) узнаёт каждую сторону у её края.
    /// Пакетный запуск: -executeMethod RealmOfAshes.EditorTools.RoaZoneEdgeFrameProbe.Run -quit.
    /// </summary>
    public static class RoaZoneEdgeFrameProbe
    {
        private const int Tiles = 160;

        [MenuItem("Realm of Ashes/Zones/Check zone edge frame")]
        public static void Run()
        {
            float edge = Tiles - 1f;
            Expect(RoaWorldExitBoundary.IsInSideBand(new Vector3(0f, 0f, edge), Tiles, Tiles, "north"), "the north band is at +Z");
            Expect(!RoaWorldExitBoundary.IsInSideBand(new Vector3(0f, 0f, -edge), Tiles, Tiles, "north"), "the north band is not at -Z");
            Expect(RoaWorldExitBoundary.IsInSideBand(new Vector3(0f, 0f, -edge), Tiles, Tiles, "south"), "the south band is at -Z");
            Expect(RoaWorldExitBoundary.IsInSideBand(new Vector3(edge, 0f, 0f), Tiles, Tiles, "east"), "the east band is at +X");
            Expect(RoaWorldExitBoundary.IsInSideBand(new Vector3(-edge, 0f, 0f), Tiles, Tiles, "west"), "the west band is at -X");
            Expect(!RoaWorldExitBoundary.IsInSideBand(Vector3.zero, Tiles, Tiles, "north"), "the zone centre is in no band");

            var host = new GameObject("ZoneEdgeFrameProbe");
            try
            {
                RoaWorldExitBoundary boundary = host.AddComponent<RoaWorldExitBoundary>();
                boundary.ConfigureSides(Tiles, Tiles, new[] { true, false, false, false },
                    new[] { "Север", string.Empty, string.Empty, string.Empty }, "Граница", "Закрыто");
                Expect(boundary.SideOpen("north") && !boundary.SideOpen("south"), "only the north side is open");
                Expect(Z(host, "EdgeStop_north") > 0f, "the stop behind the open north strip stands at +Z");
                Expect(Z(host, "ClosedBoundarySouth") < 0f, "the wall of the closed south side stands at -Z");
                Expect(host.GetComponentsInChildren<Transform>(true).All(node => node.name != "ClosedBoundaryNorth"),
                    "the open north side has no wall");
                Expect(MeshCentreZ(host, "ExitBand") > 0f, "the golden strip lies along the north edge");
                Expect(MeshCentreZ(host, "OutwardExitArrows") > 0f, "the arrows point out of the north edge");
                Expect(MeshCentreZ(host, "LockedDashedPerimeter") < 0f, "the dashes of the closed sides lean south");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
            Debug.Log("[ZONE EDGE FRAME] OK: north strip, arrows and stop at +Z, closed south wall at -Z, side bands at their edges");
        }

        private static float Z(GameObject host, string name)
        {
            Transform node = host.GetComponentsInChildren<Transform>(true).FirstOrDefault(row => row.name == name);
            if (node == null) throw new InvalidOperationException("[ZONE EDGE FRAME] no " + name);
            return node.position.z;
        }

        private static float MeshCentreZ(GameObject host, string name)
        {
            MeshFilter filter = host.GetComponentsInChildren<MeshFilter>(true).FirstOrDefault(row => row.name == name);
            if (filter == null || filter.sharedMesh == null || filter.sharedMesh.vertexCount == 0)
                throw new InvalidOperationException("[ZONE EDGE FRAME] no mesh " + name);
            return filter.transform.TransformPoint(filter.sharedMesh.bounds.center).z;
        }

        private static void Expect(bool condition, string what)
        {
            if (!condition) throw new InvalidOperationException("[ZONE EDGE FRAME] FAIL: " + what);
        }
    }
}
#endif
