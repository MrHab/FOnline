using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

public static class RoaAlifePresentationProbe
{
    [MenuItem("Realm of Ashes/Tests/A-Life Presentation")]
    public static void Run()
    {
        var snapshot = JObject.Parse(@"{
          'version':4,'locationId':'z_06_10','sites':[
            {'id':'lair-1','kind':'lair','locationId':'z_06_10','x':-30,'z':10,'active':true},
            {'id':'alife_scrap_outpost','kind':'outpost','locationId':'z_06_10','x':55,'z':47,
             'radius':20,'bounds':{'minX':26,'maxX':86,'minZ':22,'maxZ':74},
             'ownerFaction':'free_artels','capturePercent':75,'bossAlive':false}
          ],'captureTasks':[{'id':'capture:alife_scrap_outpost','siteId':'alife_scrap_outpost',
             'title':'Захват аванпоста','phase':'hold','progressPercent':75,
             'requiredSeconds':180,'captureFaction':'seconds','bossAlive':false}]}");
        if (!RoaWorldEventsPresentation.ShouldApplyAlifeUpdate("z_06_10", 3, snapshot)
            || RoaWorldEventsPresentation.ShouldApplyAlifeUpdate("z_06_10", 4, snapshot)
            || RoaWorldEventsPresentation.ShouldApplyAlifeUpdate("z_13_10", 3, snapshot))
            throw new Exception("A-Life snapshot location/version guard failed.");
        string outpost = RoaWorldEventsPresentation.DescribeAlifeOutposts(snapshot, "z_06_10");
        if (!outpost.Contains("75%") || !outpost.Contains("босс побеждён")
            || RoaWorldEventsPresentation.DescribeAlifeOutposts(snapshot, "z_13_10") != string.Empty)
            throw new Exception("A-Life outpost progress presentation failed.");
        var markers = new List<RoaMinimap.Marker>();
        RoaWorldEventsPresentation.CollectAlifeMarkers(snapshot, "z_06_10", markers);
        if (markers.Count != 2 || markers[1].Kind != RoaMinimap.MarkerKind.Outpost
            || markers[1].Position != RoaCoords.ToUnity(55f, 47f))
            throw new Exception("A-Life outpost minimap marker failed.");
        markers.Clear();
        RoaWorldEventsPresentation.CollectAlifeMarkers(snapshot, "z_13_10", markers);
        if (markers.Count != 0) throw new Exception("Outpost marker leaked to another sector.");
        Vector3 inside = RoaCoords.ToUnity(55f, 47f);
        Vector3 insideBoundsOutsideRadius = RoaCoords.ToUnity(85f, 47f);
        Vector3 outside = RoaCoords.ToUnity(90f, 47f);
        string task = RoaWorldEventsPresentation.DescribeAlifeCaptureTask(snapshot, "z_06_10", inside);
        if (!task.Contains("ЗАДАНИЕ") || !task.Contains("Этап 2/2") || !task.Contains("75%")
            || !task.Contains("03:00")
            || RoaWorldEventsPresentation.DescribeAlifeCaptureTask(snapshot, "z_06_10",
                insideBoundsOutsideRadius) != task
            || RoaWorldEventsPresentation.DescribeAlifeCaptureTask(snapshot, "z_06_10", outside) != string.Empty
            || RoaWorldEventsPresentation.DescribeAlifeCaptureTask(snapshot, "z_13_10", inside) != string.Empty)
            throw new Exception("A-Life capture task selection/progress failed.");
        JObject capture = (JObject)snapshot["captureTasks"][0];
        capture["phase"] = "defeatBoss";
        capture["bossAlive"] = true;
        if (!RoaWorldEventsPresentation.DescribeAlifeCaptureTask(snapshot, "z_06_10", inside)
            .Contains("победите босса"))
            throw new Exception("A-Life capture boss gate failed.");
        if (RoaEnemies.ResolveNpcActivityVisual("guard", "", "emerge", "guard", false, false, true) != "emerge"
            || RoaEnemies.ResolveNpcActivityVisual("guard", "", "loot", "combat", false, false, true) != string.Empty)
            throw new Exception("NPC action priorities failed.");
        if (RoaEnemies.ResolveNpcActivityVisual("guard", "", "cover", "tactical", false, false, true) != "cover"
            || RoaEnemies.ResolveNpcActivityVisual("guard", "", "cover", "combat", false, false, true) != "cover"
            || RoaEnemies.ResolveNpcActivityVisual("guard", "", "cover", "tactical", true, false, true) != string.Empty
            || RoaEnemies.ResolveNpcActivityVisual("guard", "", "cover", "combat", false, true, true) != string.Empty)
            throw new Exception("Tactical cover presentation priority failed.");
        if (RoaEnemies.ResolveNpcActivityVisual("search", "approach", "search", "idle", true, false) != string.Empty
            || RoaEnemies.ResolveNpcActivityVisual("search", "act", "search", "idle", false, false) != "search"
            || RoaEnemies.ResolveNpcActivityVisual("search", "act", "gather", "idle", false, false) != "gather"
            || RoaEnemies.ResolveNpcActivityVisual("search", "act", "ability", "attack", false, false) != "ability"
            || RoaEnemies.ResolveNpcActivityVisual("search", "act", "ability", "attack", true, false) != string.Empty
            || RoaEnemies.ResolveNpcActivityVisual("search", "act", "ability", "attack", false, true) != string.Empty)
            throw new Exception("Stalker artifact presentation failed.");
        if (RoaEnemies.ResolveNpcActivityVisual("guard", "", "grenade", "attack", false, false) != "grenade"
            || RoaEnemies.ResolveNpcActivityVisual("guard", "", "grenade", "attack", true, false) != string.Empty
            || RoaEnemies.ResolveNpcActivityVisual("guard", "", "grenade", "attack", false, true) != string.Empty
            || RoaEnemies.ResolveNpcActivityVisual("work", "use", "interact", "idle", false, false) != "work"
            || RoaEnemies.ResolveNpcActivityVisual("rest", "use", "rest", "idle", false, false) != "rest"
            || RoaEnemies.ResolveNpcActivityVisual("eat", "use", "eat", "idle", false, false) != "eat"
            || RoaEnemies.ResolveNpcActivityVisual("heal", "use", "heal", "idle", false, false) != "heal"
            || RoaEnemies.ResolveNpcActivityVisual("mine", "use", "mine", "idle", false, false) != "work"
            || RoaEnemies.ResolveNpcActivityVisual("mine", "travel", "mine", "idle", true, false) != string.Empty
            || RoaEnemies.ResolveNpcActivityVisual("eat", "travel", "eat", "idle", true, false) != string.Empty
            || RoaEnemies.ResolveNpcActivityVisual("guard", "travel", "return", "return", true, false) != string.Empty)
            throw new Exception("NPC action and locomotion transitions failed.");
        Debug.Log("[ROA] A-Life presentation probe passed.");
    }
}
