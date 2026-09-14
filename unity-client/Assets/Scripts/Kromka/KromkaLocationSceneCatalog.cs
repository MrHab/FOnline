using System;
using System.Collections.Generic;

namespace Kromka
{
    /// <summary>
    /// Stable scene-name contract for the Unity-authored Kromka world. Runtime
    /// encounter instances intentionally fall back to server-authored geometry.
    /// </summary>
    public static class KromkaLocationSceneCatalog
    {
        public const string GlobalMapSceneName = "KromkaGlobalMap";

        private static readonly HashSet<string> LocationIds = new HashSet<string>(
            new[]
            {
                "settlement", "caravanCamp", "scrapTown", "relayStation", "roadOutpost",
                "klimAmmoWorks", "scrapOutpost", "scrapFoundry", "relayOutpost",
                "relayWorkshop", "solarArray", "oldDepot", "resourceDryWaterPump",
                "resourceChemSpring", "resourceIronMine", "resourceKlimQuarry",
                "resourceOilPump", "resourceOldKlimFarm", "resourceScrapFields",
                "resourceSiliconRidge", "resourceTireDepot", "antHive", "geckoCanyon",
                "radscorpionNest", "mutantCrater", "randomAshGrove", "randomDryBasin",
                "randomRuinedRoad", "randomEncounter", "wasteland", "tutorialCaravanYard",
                "sluiceCity", "secondHaven", "balanceBunker", "cascadeRegenerator",
                "vectorLab", "personalBase", "clanHydroNode2", "clanFilterT6",
                "clanOreExchange", "clanFactoryCycle", "clanDepotBypass",
                "clanChalkSluice", "clanRelayEast", "clanFortZero",
                "coreZone", "coreBaseUprava", "coreBaseArtels", "coreBaseContour",
                "coreBaseLeague", "coreLabSprout", "coreLabCircuit", "coreLabAlloy",
                "coreLabSpectrum", "coreLabCenterService", "coreLabCenterResearch",
                "coreLabCenterReactor"
            },
            StringComparer.Ordinal);

        public static bool Contains(string locationId)
        {
            return !string.IsNullOrWhiteSpace(locationId) && LocationIds.Contains(locationId);
        }

        public static string SceneName(string locationId)
        {
            if (!Contains(locationId)) return null;
            // LoadSceneAsync ignores case: "wasteland" collided with the Wasteland bootstrap.
            return locationId == "wasteland" ? "KromkaGloomDetour" : locationId;
        }

        public static string ScenePath(string locationId)
        {
            string name = SceneName(locationId);
            return name == null ? null : "Assets/Scenes/Kromka/Locations/" + name + ".unity";
        }

        public static int Count => LocationIds.Count;
    }
}
