using System;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Handholds measured on the visible PolygonApocalypse mesh. The imported
    /// prefab keeps its authored scale; only its position inside the gameplay
    /// weapon root is adjusted to put the trigger grip in the right hand.
    /// </summary>
    public static class RoaWeaponVisualGrip
    {
        public struct Result
        {
            public Transform Primary;
            public Transform Support;
            public Transform Muzzle;
            public Transform Reload;
        }

        // Wrist-to-trigger offset from the player's edited assault-rifle grip
        // prefab. It puts the index finger at the trigger and the palm around
        // the grip, rather than putting the wrist inside the trigger guard.
        private static readonly Vector3 LongGunWrist = new Vector3(0.085f, -0.089f, -0.097f);
        private static readonly Vector3 ShortGunWrist = new Vector3(0.055f, -0.065f, -0.045f);
        private static readonly Vector3 MagazineWrist = new Vector3(-0.030f, -0.024f, -0.103f);

        public static Result Configure(GameObject visual, Transform weapon,
            Transform socket, string rigId, bool firearm, bool twoHanded)
        {
            Result result = default;
            if (visual == null || weapon == null || socket == null) return result;

            Transform root = visual.transform;
            Renderer[] renderers = visual.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return result;

            Bounds all = RoaApocalypseVisuals.LocalBounds(root, renderers);
            Renderer body = null;
            Renderer trigger = null;
            Renderer magazine = null;
            Renderer handle = null;
            Renderer secondHandle = null;
            Renderer reloadPart = null;
            foreach (Renderer renderer in renderers)
            {
                if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                string name = renderer.name;
                if (body == null || renderer.transform == root) body = renderer;
                if (trigger == null && name.IndexOf("Trigger", StringComparison.OrdinalIgnoreCase) >= 0)
                    trigger = renderer;
                if (magazine == null && name.IndexOf("Magazine", StringComparison.OrdinalIgnoreCase) >= 0)
                    magazine = renderer;
                if (handle == null && name.IndexOf("Handle", StringComparison.OrdinalIgnoreCase) >= 0)
                    handle = renderer;
                if (secondHandle == null && name.IndexOf("Handle_02", StringComparison.OrdinalIgnoreCase) >= 0)
                    secondHandle = renderer;
                if (reloadPart == null && (name.IndexOf("Bolt", StringComparison.OrdinalIgnoreCase) >= 0
                    || name.IndexOf("Cylinder_01", StringComparison.OrdinalIgnoreCase) >= 0
                    || name.IndexOf("Slide", StringComparison.OrdinalIgnoreCase) >= 0))
                    reloadPart = renderer;
            }
            Bounds main = PartBounds(root, body, all);
            Bounds triggerBounds = PartBounds(root, trigger, main);
            Bounds magazineBounds = PartBounds(root, magazine, main);
            Bounds handleBounds = PartBounds(root, handle, main);
            Bounds secondHandleBounds = PartBounds(root, secondHandle, main);

            Vector3 right;
            Vector3 left;
            if (firearm)
            {
                bool compact = rigId == "pistol" || rigId == "revolver"
                    || rigId == "laserPistol";
                bool minigun = visual.name.IndexOf("Minigun", StringComparison.OrdinalIgnoreCase) >= 0;
                Vector3 triggerPoint = trigger != null ? triggerBounds.center
                    : handle != null ? handleBounds.center : main.center;
                right = triggerPoint + (compact ? ShortGunWrist : LongGunWrist);

                if (secondHandle != null)
                    left = secondHandleBounds.center + new Vector3(-0.035f, -0.04f, -0.015f);
                else if (magazine != null && !compact && !minigun)
                    left = magazineBounds.center + MagazineWrist;
                else if (handle != null && handleBounds.center.z > triggerPoint.z + 0.08f)
                    left = handleBounds.center + new Vector3(-0.04f, -0.04f, -0.015f);
                else if (compact)
                    left = triggerPoint + new Vector3(-0.055f, -0.075f, -0.005f);
                else
                    left = new Vector3(main.center.x - 0.045f,
                        Mathf.Min(triggerPoint.y, main.center.y) - 0.04f,
                        Mathf.Clamp(triggerPoint.z + main.size.z * 0.24f,
                            main.min.z + 0.05f, main.max.z - 0.05f));
            }
            else
            {
                // Melee models in this pack stand along their local Y axis.
                // The dominant body mesh gives the handle even when there is
                // no separately named handle renderer.
                right = new Vector3(main.center.x + 0.045f,
                    main.min.y + Mathf.Min(0.17f, main.size.y * 0.24f), main.center.z);
                left = new Vector3(main.center.x - 0.035f,
                    Mathf.Min(main.max.y - 0.04f, right.y + 0.22f), main.center.z);
            }

            // The old socket rig still drives aim and attack timing. Its grip
            // represents the right wrist after the approved hand-to-mount pose.
            Matrix4x4 socketLocal = weapon.worldToLocalMatrix * socket.localToWorldMatrix;
            Matrix4x4 handToSocket = RoaWeaponGrip.HandToMount
                * Matrix4x4.Translate(RoaWeaponView.PrimarySocketOffset);
            Vector3 wristInWeapon = (socketLocal * handToSocket.inverse).GetColumn(3);
            root.position += weapon.TransformPoint(wristInWeapon) - root.TransformPoint(right);

            result.Primary = Marker(root, "PolygonApocalypse_PrimaryHand", right);
            if (twoHanded)
                result.Support = Marker(root, "PolygonApocalypse_SupportHand", left);
            if (firearm)
            {
                Vector3 muzzle = new Vector3(triggerBounds.center.x,
                    main.center.y, main.max.z - 0.012f);
                result.Muzzle = Marker(root, "PolygonApocalypse_Muzzle", muzzle);
                Renderer activeReloadPart = magazine != null ? magazine
                    : reloadPart != null ? reloadPart : handle;
                if (activeReloadPart != null)
                    result.Reload = Marker(root, "PolygonApocalypse_Reload",
                        PartBounds(root, activeReloadPart, main).center);
            }
            return result;
        }

        private static Bounds PartBounds(Transform root, Renderer renderer, Bounds fallback)
        {
            return renderer != null
                ? RoaApocalypseVisuals.LocalBounds(root, new[] { renderer }) : fallback;
        }

        private static Transform Marker(Transform parent, string name, Vector3 position)
        {
            var marker = new GameObject(name).transform;
            marker.SetParent(parent, false);
            marker.localPosition = position;
            marker.localRotation = Quaternion.identity;
            return marker;
        }
    }
}
