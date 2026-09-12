#if UNITY_EDITOR
using System;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    // Final, deterministic contact pass. Applied after regional translations so
    // supports use the terrain at their final position, not the original lot.
    internal static class KromkaGlobalMapAssemblySupportAuthoring
    {
        [MenuItem("Realm of Ashes/Authoring/Visual review/Repair assembly supports")]
        public static void RepairCurrent()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode
                || SceneManager.GetActiveScene().path != "Assets/Scenes/Kromka/KromkaGlobalMap.unity")
                throw new InvalidOperationException("Open the authored global map outside Play Mode.");
            Apply(GameObject.Find("EnvironmentModels_ModelPass_EDITABLE").transform);
            KromkaSceneCapture.SaveOpenGeneratedGlobalMap();
        }

        internal static void Apply(Transform models)
        {
            PlaceModel(models, "FuelRamp_ContainerC", 160f, 55f, .018f);
            PlaceModel(models, "FuelRamp_LiftCrane", 158f, 42f, .020f);
            SeatBasinProps(models);
            Transform[] all = models.GetComponentsInChildren<Transform>(true);
            foreach (Transform t in all)
            {
                if (t.name == "GloomDetour_DefenceTower_LANDMARK") RepairTower(t);
                else if (t.name.StartsWith("SilentWarningPylon_", StringComparison.Ordinal)) RepairSignal(t);
                else if (t.name.StartsWith("LeaningFuelTank_", StringComparison.Ordinal)) RepairTank(t);
                else if (t.name == "CyanWarningBeacon") SeatOn(t, t.parent.Find("SealedCap"));
                else if (t.name == "RelayPulse") SeatOn(t, t.parent.Find("RelayCap"));
                else if ((t.name == "WarningLampWest" || t.name == "WarningLampEast")
                    && t.parent.Find("RackHeader") != null)
                {
                    Transform header = t.parent.Find("RackHeader");
                    t.position = header.TransformPoint(new Vector3(t.name == "WarningLampWest" ? -.45f : .45f, .5f, 0f))
                        + Vector3.up * (t.localScale.y * .45f);
                }
                else if (t.name == "WarningLamp" && t.parent.name == "Drain4B_DrainStack_LANDMARK")
                    SeatOn(t, t.parent.Find("DrainStack"));
                else if (t.name.StartsWith("WarningBeacon_", StringComparison.Ordinal)
                    && t.parent.name == "Fort14_CommandBastion_LANDMARK")
                    SeatOn(t, t.parent.Find("CornerCap_" + t.name.Substring("WarningBeacon_".Length)));
                else if ((t.name.StartsWith("RingSegment_", StringComparison.Ordinal)
                        && t.parent.name.StartsWith("BuriedFieldRing_", StringComparison.Ordinal))
                    || t.name.StartsWith("FireCrack_", StringComparison.Ordinal)
                    || (t.name.StartsWith("CableSegment_", StringComparison.Ordinal)
                        && t.parent.name.StartsWith("ShreddedCableRun_", StringComparison.Ordinal)))
                    GroundPart(t, .009f);
                else if (t.name == "Folded_SurgicalMast_LANDMARK") RepairSurgicalMast(t);
                else if (t.name == "BayDisconnect")
                {
                    // An open knife switch is hinged to the left porcelain post.
                    Vector3 from = t.parent.Find("BayInsulatorLeft").GetComponent<Renderer>().bounds.center;
                    from.y = t.parent.Find("BayInsulatorLeft").GetComponent<Renderer>().bounds.max.y;
                    Vector3 to = t.parent.Find("BayInsulatorRight").GetComponent<Renderer>().bounds.center;
                    to.y = from.y + .07f; Beam(t, from, to, .020f);
                }
                else if (t.Find("LatticeLeg_0") != null && t.Find("NeckLeft") != null) RepairPylonNeck(t);
            }
            Debug.Log("[KROMKA ASSEMBLY SUPPORT] Repaired tower load paths, attached lights, tank fittings and terrain contacts.");
        }

        private static void RepairTower(Transform root)
        {
            Transform platform = root.Find("LowerPlatform");
            platform.localScale = new Vector3(1.04f, .07f, 1.04f);
            for (int i = 0; i < 4; i++)
            {
                Transform foot = root.Find("FootBlock_" + i);
                Vector3 p = foot.position;
                float top = root.position.y + .20f;
                Vertical(foot, Ground(p) - .012f, top);
                Vector3 end = p; end.y = root.position.y + 1.14f;
                Vector3 start = p; start.y = top - .01f;
                Beam(root.Find("TowerLeg_" + i), start, end, .085f);
                Vector3 braceTop = root.TransformPoint(new Vector3(-foot.localPosition.x, 1.06f, foot.localPosition.z));
                Beam(root.Find("DiagonalBrace_" + i), start, braceTop, .055f);
            }
            root.Find("WatchCabin").localPosition = new Vector3(0f, 1.365f, 0f);
            root.Find("CabinRoof").localPosition = new Vector3(0f, 1.52f, 0f);
            root.Find("SignalMast").localPosition = new Vector3(0f, 1.75f, 0f);
            root.Find("SignalMast").localRotation = Quaternion.identity;
            SeatOn(root.Find("RedTowerBeacon"), root.Find("SignalMast"));
            for (int side = 0; side < 4; side++)
            {
                float a = (side * 90f + 7f) * Mathf.Deg2Rad;
                root.Find("CabinWindow_" + side).localPosition = new Vector3(Mathf.Sin(a) * .241f,
                    1.39f, Mathf.Cos(a) * .241f);
                Transform rail = root.Find("PlatformRail_" + side);
                a = side * Mathf.PI * .5f;
                rail.localPosition = new Vector3(Mathf.Sin(a) * .44f, 1.325f, Mathf.Cos(a) * .44f);
                Vector3 size = rail.localScale; size.y = .14f; rail.localScale = size;
                a = (side * 90f + 20f) * Mathf.Deg2Rad;
                Vector3 light = root.TransformPoint(new Vector3(Mathf.Sin(a) * .50f,
                    1.60f, Mathf.Cos(a) * .50f));
                root.Find("Searchlight_" + side).position = light;
                Beam(root.Find("SearchlightArm_" + side), root.TransformPoint(new Vector3(0f, 1.59f, 0f)),
                    light, .045f);
            }
            GroundPart(root.Find("TowerFooting"), .012f);
        }

        private static void RepairSignal(Transform root)
        {
            Transform mast = root.Find("Mast"), bar = root.Find("Crossbar");
            bar.position = mast.TransformPoint(new Vector3(0f, .70f, 0f));
            root.Find("MarkerLeft").position = bar.TransformPoint(new Vector3(-.43f, 0f, 0f));
            root.Find("MarkerRight").position = bar.TransformPoint(new Vector3(.43f, 0f, 0f));
            Transform beacon = root.Find("Beacon");
            beacon.position = mast.TransformPoint(Vector3.up) + Vector3.up * (beacon.localScale.y * .40f);
        }

        private static void RepairTank(Transform root)
        {
            int index = int.Parse(root.name.Substring(root.name.Length - 2));
            Vector3 lot = new Vector3((147f - 190f) * .1f, 0f,
                (150f - (49f - index * 4f)) * .1f);
            lot.y = Ground(lot) + .025f; root.position = lot;
            Transform body = root.Find("TankBody");
            body.localScale = new Vector3(.24f, .50f, .24f);
            body.localRotation = Quaternion.Euler(0f, 0f, 84f);
            root.Find("FrontCap").position = body.TransformPoint(Vector3.up * .97f);
            root.Find("RearCap").position = body.TransformPoint(Vector3.down * .97f);
            foreach (string end in new[] { "Front", "Rear" })
            {
                float sign = end == "Front" ? 1f : -1f;
                Transform band = root.Find("PressureBand" + end);
                band.position = body.TransformPoint(Vector3.up * (sign * .42f));
                band.rotation = body.rotation;
                Transform support = root.Find("Support" + end);
                Vector3 axis = body.TransformPoint(Vector3.up * (sign * .55f));
                support.position = axis;
                support.rotation = Quaternion.Euler(0f, body.eulerAngles.y, 0f);
                Vertical(support, Ground(axis) - .015f, axis.y - .045f);
            }
            Transform valve = root.Find("WarningValve");
            valve.position = body.position + Vector3.up * (.115f + valve.localScale.y * .45f);
        }

        private static void RepairSurgicalMast(Transform root)
        {
            Transform column = root.Find("SurgicalColumn");
            Vector3 hub = column.TransformPoint(new Vector3(0f, .78f, 0f));
            for (int i = 0; i < 5; i++)
            {
                Transform lamp = root.Find("RedProcedureLamp_" + i);
                Beam(root.Find("FoldedArm_" + i), hub, lamp.position, .055f);
            }
        }

        private static void RepairPylonNeck(Transform root)
        {
            // The narrow neck missed both separated shoulders of this rotated pylon.
            foreach (string side in new[] { "Left", "Right" })
            {
                Transform neck = root.Find("Neck" + side);
                Transform arm = root.Find("MainCrossarm");
                Vector3 top = arm.position + arm.up * (side == "Left" ? -.07f : .07f) + Vector3.up * .08f;
                Transform leg = root.Find("LatticeLeg_" + (side == "Left" ? 0 : 1));
                Vector3 shoulder = leg.TransformPoint(Vector3.up * .5f);
                Beam(neck, shoulder, top, .042f);
            }
        }

        private static void SeatOn(Transform part, Transform support)
        {
            if (part == null || support == null) return;
            Bounds b = support.GetComponent<Renderer>().bounds;
            Vector3 p = b.center;
            p.y = b.max.y + part.GetComponent<Renderer>().bounds.extents.y - .004f;
            part.position = p;
        }
        private static void PlaceModel(Transform models, string name, float x, float y, float embed)
        {
            Transform t = models.GetComponentsInChildren<Transform>(true).SingleOrDefault(p => p.name == name);
            if (t == null) return;
            Renderer[] renderers = t.GetComponentsInChildren<Renderer>().Where(r => r.enabled).ToArray();
            Bounds b = renderers[0].bounds;
            foreach (Renderer r in renderers.Skip(1)) b.Encapsulate(r.bounds);
            Vector3 target = new Vector3((x - 190f) * .1f, 0f, (150f - y) * .1f);
            t.position += new Vector3(target.x - b.center.x, Ground(target) - embed - b.min.y, target.z - b.center.z);
        }
        private static void SeatBasinProps(Transform models)
        {
            // Only natural props affected by the authored basin cuts. Preserve
            // their XZ, mesh, size and rotation; rocks and roots penetrate soil.
            string[] names = { "EchoPillar_13", "EchoPillar_15", "RavineWall_Right_05",
                "SilentDeadTree_08", "SilentDeadTree_09", "SilentDeadTree_32",
                "SilentRing_NorthSentinel", "SilentRing_Talus_10_00", "SilentRing_Talus_10_01",
                "SilentStump_03", "SilentWindfall_04", "SilentWindfall_14" };
            foreach (Transform t in models.GetComponentsInChildren<Transform>(true)
                .Where(t => names.Contains(t.name)))
            {
                Renderer[] renderers = t.GetComponentsInChildren<Renderer>().Where(r => r.enabled).ToArray();
                Bounds b = renderers[0].bounds;
                foreach (Renderer r in renderers.Skip(1)) b.Encapsulate(r.bounds);
                float x = b.extents.x * .6f, z = b.extents.z * .6f;
                float low = new[] { b.center, b.center + new Vector3(-x, 0f, -z),
                    b.center + new Vector3(-x, 0f, z), b.center + new Vector3(x, 0f, -z),
                    b.center + new Vector3(x, 0f, z) }.Min(Ground);
                t.position += Vector3.up * (low - .018f - b.min.y);
            }
        }
        private static void Vertical(Transform t, float bottom, float top)
        {
            Vector3 p = t.position; p.y = (bottom + top) * .5f; t.position = p;
            Vector3 s = t.localScale; s.y = Mathf.Max(.01f, top - bottom); t.localScale = s;
        }
        private static void GroundPart(Transform t, float embed)
        {
            Bounds b = t.GetComponent<Renderer>().bounds;
            float low = new[] { b.center, new Vector3(b.min.x, 0f, b.min.z),
                new Vector3(b.min.x, 0f, b.max.z), new Vector3(b.max.x, 0f, b.min.z),
                new Vector3(b.max.x, 0f, b.max.z) }.Min(Ground);
            t.position += Vector3.up * (low - embed - b.min.y);
        }
        private static void Beam(Transform t, Vector3 from, Vector3 to, float width)
        {
            Vector3 d = to - from; t.position = (from + to) * .5f;
            t.rotation = Quaternion.FromToRotation(Vector3.up, d.normalized);
            t.localScale = new Vector3(width, d.magnitude + .004f, width);
        }
        private static float Ground(Vector3 p) => KromkaGlobalMapReliefAuthoring.HeightAtMap(
            190f + p.x * 10f, 150f - p.z * 10f);
    }
}
#endif
