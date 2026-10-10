using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class RoaCoreZoneSceneFilterProbe
{
    [MenuItem("Realm of Ashes/Authoring/Remove retired Core scene markers")]
    public static void RemoveRetiredAuthoredMarkers()
    {
        const string scenePath = "Assets/Scenes/Kromka/Locations/coreZone.unity";
        string definitionPath = Path.GetFullPath(Path.Combine(
            Application.dataPath, "../../data/locations/coreZone.json"));
        JObject definition = JObject.Parse(File.ReadAllText(definitionPath));
        var currentIds = new HashSet<string>(
            ((JArray)definition["objects"]).OfType<JObject>()
                .Select(row => row.Value<string>("id")), StringComparer.Ordinal);
        var scene = EditorSceneManager.OpenScene(scenePath);
        var markers = scene.GetRootGameObjects()
            .SelectMany(root => root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            .Where(marker => marker.Role != "terrain" && !currentIds.Contains(marker.StableObjectId))
            .ToList();
        var unexpected = markers.Where(marker =>
            !RoaCoreZoneSceneFilter.IsRetiredObjectId(marker.StableObjectId))
            .Select(marker => marker.StableObjectId).ToList();
        if (unexpected.Count > 0)
            throw new InvalidOperationException("Core scene has unrecognized orphan markers: "
                + string.Join(", ", unexpected));
        var retiredNpcs = scene.GetRootGameObjects()
            .SelectMany(root => root.GetComponentsInChildren<KromkaNpcAuthoring>(true))
            .Where(npc => !currentIds.Contains(npc.NpcId)).ToList();
        var unexpectedNpcs = retiredNpcs.Where(npc =>
            !RoaCoreZoneSceneFilter.IsRetiredObjectId(npc.NpcId))
            .Select(npc => npc.NpcId).ToList();
        if (unexpectedNpcs.Count > 0)
            throw new InvalidOperationException("Core scene has unrecognized orphan NPCs: "
                + string.Join(", ", unexpectedNpcs));
        foreach (var marker in markers)
            UnityEngine.Object.DestroyImmediate(marker.gameObject);
        foreach (var npc in retiredNpcs)
            UnityEngine.Object.DestroyImmediate(npc.gameObject);
        if (markers.Count > 0 || retiredNpcs.Count > 0) EditorSceneManager.SaveScene(scene);
        Debug.Log("[ROA] Core scene retired markers removed: " + markers.Count
            + ", NPCs: " + retiredNpcs.Count);
    }

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
