#if UNITY_EDITOR
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

public static class RoaGlobalMapTerritoryProbe
{
    private static RoaGlobalMap _map;
    private static double _deadline;

    [MenuItem("Realm of Ashes/Показать территории глобальной карты", true)]
    private static bool CanRun()
    {
        return Application.isPlaying;
    }

    [MenuItem("Realm of Ashes/Показать территории глобальной карты")]
    private static void Run()
    {
        Rect compactPanel = RoaGlobalMap.InformationPanelRect(840, 500);
        var occupiedLabels = new List<Rect>();
        bool labelResolved = RoaGlobalMap.TryResolveNodeLabelRect(
            new Vector2(compactPanel.xMin - 8f, 110f), compactPanel, occupiedLabels,
            840, 500, out Rect labelRect);
        if (!RoaGlobalMap.MapPointCanSelect(new Vector2(120f, 250f), 840, 500)
            || RoaGlobalMap.MapPointCanSelect(compactPanel.center, 840, 500)
            || !labelResolved || labelRect.Overlaps(compactPanel)
            || RoaGlobalMap.TryResolveNodeLabelRect(compactPanel.center, compactPanel,
                occupiedLabels, 840, 500, out _))
        {
            Debug.LogError("[ГЛОБАЛЬНАЯ КАРТА] кликабельная область или подписи перекрывают правую панель.");
            return;
        }

        RoaGameBootstrap bootstrap = FindLoaded<RoaGameBootstrap>();
        _map = bootstrap != null ? bootstrap.GlobalMap : null;
        if (_map == null) _map = FindLoaded<RoaGlobalMap>();
        if (bootstrap == null || _map == null)
        {
            Debug.LogError("[ГЛОБАЛЬНАЯ КАРТА] RoaGameBootstrap или RoaGlobalMap не найден.");
            return;
        }

        bootstrap.GlobalMap = _map;
        bootstrap.EnterGlobalMapFromServer(new JObject
        {
            ["version"] = 1,
            ["onWorldMap"] = true,
            ["fromLocationId"] = "settlement",
            ["playerX"] = 195f,
            ["playerY"] = 705f,
            ["selectedX"] = 195f,
            ["selectedY"] = 705f
        });
        _deadline = EditorApplication.timeSinceStartup + 20d;
        EditorApplication.update -= Inspect;
        EditorApplication.update += Inspect;
        Debug.Log("[ГЛОБАЛЬНАЯ КАРТА] загружаю серверные территории...");
    }

    private static T FindLoaded<T>() where T : Object
    {
        T[] candidates = Resources.FindObjectsOfTypeAll<T>();
        foreach (T candidate in candidates)
        {
            if (candidate == null || EditorUtility.IsPersistent(candidate)) continue;
            return candidate;
        }
        return null;
    }

    private static void Inspect()
    {
        if (!Application.isPlaying || _map == null)
        {
            Finish();
            return;
        }
        if (!_map.IsActive || _map.TerritoryCellCount <= 0)
        {
            if (EditorApplication.timeSinceStartup <= _deadline) return;
            Debug.LogError("[ГЛОБАЛЬНАЯ КАРТА] серверные территории не появились за 20 секунд.");
            Finish();
            return;
        }

        string selection = _map.SelectionSummary ?? string.Empty;
        string factions = _map.FactionSummary ?? string.Empty;
        float selectedBeforeX = _map.SelectedMapX;
        float selectedBeforeY = _map.SelectedMapY;
        _map.ApplyAuthoritativeState(new JObject
        {
            ["version"] = 1,
            ["onWorldMap"] = true,
            ["fromLocationId"] = "settlement",
            ["playerX"] = 180f,
            ["playerY"] = 700f,
            ["selectedX"] = 0f,
            ["selectedY"] = 0f
        });
        bool idleSelectionPreserved = Mathf.Abs(_map.PlayerMapX - 180f) < 0.01f
                                   && Mathf.Abs(_map.PlayerMapY - 700f) < 0.01f
                                   && Mathf.Abs(_map.SelectedMapX - selectedBeforeX) < 0.01f
                                   && Mathf.Abs(_map.SelectedMapY - selectedBeforeY) < 0.01f;
        bool valid = _map.TerritoryBorderCount > 0
                     && _map.InfluenceZoneCount == 0
                     && _map.SettlementModelCount == 4
                     && _map.SiteMarkerCount >= 100
                     && _map.SettlementStatusCount == 4
                     && _map.SiteMeshVertexCount > 1000
                     && _map.SiteMeshSubMeshCount >= 8
                     && selection.Contains("Территория:")
                     && selection.Contains("Поселение")
                     && factions.Contains("Владение фракций:")
                     && idleSelectionPreserved;
        string report = "[ГЛОБАЛЬНАЯ КАРТА] территории=" + _map.TerritoryCellCount
                        + ", границы=" + _map.TerritoryBorderCount
                        + ", влияние=" + _map.InfluenceZoneCount
                        + ", поселения=" + _map.SettlementModelCount
                        + ", статусы=" + _map.SettlementStatusCount
                        + ", модели точек=" + _map.SiteMarkerCount
                        + ", вершины=" + _map.SiteMeshVertexCount
                        + ", материалы=" + _map.SiteMeshSubMeshCount
                        + ", выбор сохранён=" + idleSelectionPreserved
                        + "\n" + selection + "\n" + factions;
        if (valid) Debug.Log(report + "\n[ГЛОБАЛЬНАЯ КАРТА] готово.");
        else Debug.LogError(report + "\n[ГЛОБАЛЬНАЯ КАРТА] сводка не прошла проверку.");
        Finish();
    }

    private static void Finish()
    {
        EditorApplication.update -= Inspect;
        _map = null;
    }
}
#endif
