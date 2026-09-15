using System.Collections.Generic;
using Newtonsoft.Json;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Авторская конфигурация data/global-map.json. Unity получает её через
    /// GET /api/global-map и не держит отдельную копию мировых координат.
    /// </summary>
    public sealed class GlobalMapDefinition
    {
        [JsonProperty("schema")] public string Schema;
        [JsonProperty("version")] public int Version;
        [JsonProperty("worldRevision")] public string WorldRevision;
        [JsonProperty("unityScene")] public string UnityScene;
        [JsonProperty("grid")] public GlobalMapGrid Grid = new GlobalMapGrid();
        [JsonProperty("nodes")] public List<GlobalMapNode> Nodes = new List<GlobalMapNode>();
        [JsonProperty("infrastructure")] public List<GlobalMapInfrastructure> Infrastructure = new List<GlobalMapInfrastructure>();
        [JsonProperty("cells")] public Dictionary<string, GlobalMapCell> Cells = new Dictionary<string, GlobalMapCell>();
    }

    public sealed class GlobalMapGrid
    {
        [JsonProperty("cols")] public int Cols = 38;
        [JsonProperty("rows")] public int Rows = 30;
        [JsonProperty("cellPoints")] public float CellPoints = 10f;
        [JsonProperty("cellKm")] public float CellKm = 10f;
    }

    public sealed class GlobalMapPoint
    {
        [JsonProperty("x")] public float X;
        [JsonProperty("y")] public float Y;
    }

    public sealed class GlobalMapNode
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("locationId")] public string LocationId;
        [JsonProperty("kind")] public string Kind;
        [JsonProperty("x")] public float X;
        [JsonProperty("y")] public float Y;
        [JsonProperty("danger")] public int Danger;
        [JsonProperty("capital")] public bool Capital;
        [JsonProperty("capitalFaction")] public string CapitalFaction;
        [JsonProperty("note")] public string Note;
        [JsonProperty("macroRegion")] public string MacroRegion;
        [JsonProperty("visualProfile")] public string VisualProfile;
        [JsonProperty("worldRevision")] public string WorldRevision;
        // Скрытая метка: сервер такие узлы клиенту не отдаёт, но карта из кэша
        // или прежней сборки может их содержать — рисовать их нельзя.
        [JsonProperty("hidden")] public bool Hidden;

        public string EffectiveLocationId
        {
            get { return string.IsNullOrEmpty(LocationId) ? Id : LocationId; }
        }
    }

    public sealed class GlobalMapInfrastructure
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("name")] public string Name;
        [JsonProperty("type")] public string Type;
        [JsonProperty("walkable")] public bool Walkable;
        [JsonProperty("travelFactor")] public float TravelFactor = 1f;
        [JsonProperty("width")] public float Width = 4f;
        [JsonProperty("points")] public List<GlobalMapPoint> Points = new List<GlobalMapPoint>();
    }

    public sealed class GlobalMapCell
    {
        [JsonProperty("terrain")] public string Terrain;
        [JsonProperty("pvpMode")] public string PvpMode;
        [JsonProperty("chance")] public float Chance;
        [JsonProperty("difficulty")] public int Difficulty;
        [JsonProperty("texture")] public string Texture;
        [JsonProperty("macroRegion")] public string MacroRegion;
        [JsonProperty("danger")] public int Danger;
        [JsonProperty("encounterChance")] public string EncounterChance;
    }
}
