using System;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

public static class RoaCoreZoneSceneFilterProbe
{
    [MenuItem("Realm of Ashes/Tests/Core Zone Retired Scene Filter")]
    public static void Run()
    {
        var root = new GameObject("CoreFilterProbe");
        try
        {
            var scene = root.AddComponent<RoaUnityLocationScene>();
            scene.Configure("coreZone", null);
            GameObject retired = Add(root.transform, "platform_uprava_hall");
            GameObject outpost = Add(root.transform, "outpostDepot_flag");
            GameObject lab = Add(root.transform, "coreLabSprout_door");
            GameObject anomaly = Add(root.transform, "core-middle-dew");
            GameObject boss = Add(root.transform, "center_object_zero");
            int hidden = RoaCoreZoneSceneFilter.HideRetired(scene);
            if (hidden != 2 || retired.activeInHierarchy || outpost.activeInHierarchy
                || retired.GetComponent<Collider>().enabled && retired.GetComponent<Collider>().gameObject.activeInHierarchy
                || !lab.activeInHierarchy || !anomaly.activeInHierarchy || !boss.activeInHierarchy)
                throw new Exception("Core scene filter disabled a retained object or left retired collision active.");
            if (!RoaCoreZoneSceneFilter.IsRetiredObjectId("room_coreZone_transport_floor")
                || !RoaCoreZoneSceneFilter.IsRetiredObjectId("room_coreZone_boarding_gate")
                || RoaCoreZoneSceneFilter.IsRetiredObjectId("room_coreZone_lab_airlock"))
                throw new Exception("Core scene filter ID contract failed.");
            Debug.Log("[ROA] Core zone retired scene filter probe passed.");
        }
        finally { UnityEngine.Object.DestroyImmediate(root); }
    }

    private static GameObject Add(Transform parent, string id)
    {
        var child = new GameObject(id);
        child.transform.SetParent(parent, false);
        child.AddComponent<BoxCollider>();
        child.AddComponent<RoaUnityLocationObject>().Configure(id);
        return child;
    }
}
