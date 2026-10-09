using System;
using Kromka.Authoring;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Hides retired Core metro platforms, inner outposts and market dressing in
    /// the authored scene. The laboratory shells, anomaly fields and Object Zero
    /// use other IDs and remain available. Disabled roots include their colliders.
    /// </summary>
    public static class RoaCoreZoneSceneFilter
    {
        public static bool IsRetiredObjectId(string id)
        {
            if (string.IsNullOrEmpty(id)) return false;
            return id.StartsWith("room_coreZone_transport_", StringComparison.Ordinal)
                || id.StartsWith("room_coreZone_platform_", StringComparison.Ordinal)
                || id.StartsWith("room_coreZone_boarding_", StringComparison.Ordinal)
                || id.StartsWith("platform_", StringComparison.Ordinal)
                || id.StartsWith("outpostDepot_", StringComparison.Ordinal)
                || id.StartsWith("outpostPump_", StringComparison.Ordinal)
                || id.StartsWith("outpostRelay_", StringComparison.Ordinal)
                || id == "market_stairs";
        }

        public static int HideRetired(RoaUnityLocationScene scene)
        {
            if (scene == null || scene.LocationId != "coreZone") return 0;
            int hidden = 0;
            foreach (KromkaPlacedObjectAuthoring marker in scene.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if (marker == null || !IsRetiredObjectId(marker.StableObjectId)
                    || !marker.gameObject.activeSelf) continue;
                marker.gameObject.SetActive(false);
                hidden++;
            }
            foreach (RoaUnityLocationObject marker in scene.GetComponentsInChildren<RoaUnityLocationObject>(true))
            {
                if (marker == null || !IsRetiredObjectId(marker.ObjectId)
                    || !marker.gameObject.activeSelf) continue;
                marker.gameObject.SetActive(false);
                hidden++;
            }
            return hidden;
        }
    }
}
