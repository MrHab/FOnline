using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RealmOfAshes.World
{
    // Модель авторской локации. Источник — data/locations/*.json на сервере,
    // отдаётся клиенту через GET /api/locations (server.js:1560).
    //
    // Формат уже декларативный: каждый объект несёт готовый URL на GLB, мировую
    // позицию, поворот, масштаб и режим коллизии. Портировать нечего — Unity читает
    // ровно тот же JSON, что и Three.js-клиент. Это главная причина, по которой
    // перенос клиента реалистичен: авторский контент не конвертируется вообще.

    public sealed class LocationDefinition
    {
        [JsonProperty("schema")] public string Schema;
        [JsonProperty("version")] public int Version;
        [JsonProperty("id")] public string Id;
        [JsonProperty("name")] public string Name;
        [JsonProperty("seed")] public long Seed;
        [JsonProperty("safe")] public bool Safe;
        [JsonProperty("pvpMode")] public string PvpMode;
        [JsonProperty("kind")] public string Kind;
        [JsonProperty("encounterOnly")] public bool EncounterOnly;
        [JsonProperty("randomTemplate")] public bool RandomTemplate;
        [JsonProperty("runtimeMode")] public string RuntimeMode;
        [JsonProperty("worldSiteInstance")] public bool WorldSiteInstance;
        [JsonProperty("templateLocationId")] public string TemplateLocationId;
        [JsonProperty("noRespawn")] public bool NoRespawn;
        [JsonProperty("enemyCap")] public int EnemyCap;
        [JsonProperty("spawnCount")] public int SpawnCount;
        [JsonProperty("visualProfile")] public JObject VisualProfile;
        [JsonProperty("playableBounds")] public PlayableBoundsDefinition PlayableBounds;

        [JsonProperty("ground")] public GroundDefinition Ground;
        [JsonProperty("map")] public MapDefinition Map;
        [JsonProperty("grid")] public GridDefinition Grid;
        [JsonProperty("spawn")] public TileCoord Spawn;
        [JsonProperty("entryFromWorld")] public TileCoord EntryFromWorld;
        [JsonProperty("exit")] public LocationTransition Exit;
        [JsonProperty("transitions")] public List<LocationTransition> Transitions = new List<LocationTransition>();

        [JsonProperty("worldZones")] public List<WorldZone> WorldZones = new List<WorldZone>();
        [JsonProperty("objects")] public List<LocationObject> Objects = new List<LocationObject>();
        [JsonProperty("containers")] public JArray Containers;
        [JsonProperty("storage")] public JObject Storage;

        /// <summary>
        /// map.width/map.depth are authored in world metres (76 for the standard
        /// 38x38 map), while all server snapshots address tiles. Keep the conversion
        /// in one place so render, fog, minimap and interactions cannot drift apart.
        /// </summary>
        [JsonIgnore]
        public float TileStep
        {
            get { return Grid != null && Grid.Step > 0.001f ? Grid.Step : RoaCoords.Tile; }
        }

        [JsonIgnore]
        public int TileWidth
        {
            get
            {
                float metres = Map != null && Map.TechnicalWidth > 0
                    ? Map.TechnicalWidth
                    : (Map != null && Map.Width > 0 ? Map.Width : 76f);
                return System.Math.Max(1, (int)System.Math.Round(metres / TileStep));
            }
        }

        [JsonIgnore]
        public int TileDepth
        {
            get
            {
                float metres = Map != null && Map.TechnicalDepth > 0
                    ? Map.TechnicalDepth
                    : (Map != null && Map.Depth > 0 ? Map.Depth : 76f);
                return System.Math.Max(1, (int)System.Math.Round(metres / TileStep));
            }
        }

        [JsonIgnore]
        public float WorldWidth
        {
            get
            {
                if (Map != null && Map.TechnicalWidth > 0) return Map.TechnicalWidth;
                return Map != null && Map.Width > 0 ? Map.Width : TileWidth * TileStep;
            }
        }

        [JsonIgnore]
        public float WorldDepth
        {
            get
            {
                if (Map != null && Map.TechnicalDepth > 0) return Map.TechnicalDepth;
                return Map != null && Map.Depth > 0 ? Map.Depth : TileDepth * TileStep;
            }
        }
    }

    public sealed class GroundDefinition
    {
        [JsonProperty("preset")] public string Preset;
        [JsonProperty("label")] public string Label;
        [JsonProperty("texture")] public string Texture;
    }

    public sealed class MapDefinition
    {
        [JsonProperty("width")] public int Width;
        [JsonProperty("depth")] public int Depth;
        [JsonProperty("technicalWidth")] public int TechnicalWidth;
        [JsonProperty("technicalDepth")] public int TechnicalDepth;

        /// <summary>Пока встречается только "center". Другое значение — повод остановиться, а не догадываться.</summary>
        [JsonProperty("origin")] public string Origin;
    }

    public sealed class PlayableBoundsDefinition
    {
        [JsonProperty("minX")] public int MinX;
        [JsonProperty("minZ")] public int MinZ;
        [JsonProperty("maxX")] public int MaxX;
        [JsonProperty("maxZ")] public int MaxZ;
        [JsonProperty("width")] public int Width;
        [JsonProperty("height")] public int Height;
    }

    public sealed class GridDefinition
    {
        [JsonProperty("snap")] public bool Snap;
        [JsonProperty("step")] public float Step;
    }

    public sealed class TileCoord
    {
        [JsonProperty("tx")] public int Tx;
        [JsonProperty("tz")] public int Tz;
    }

    public sealed class WorldZone
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("label")] public string Label;
        [JsonProperty("tx")] public int Tx;
        [JsonProperty("tz")] public int Tz;
        [JsonProperty("radius")] public float Radius;
    }

    public sealed class LocationTransition
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("type")] public string Type;
        [JsonProperty("label")] public string Label;
        [JsonProperty("to")] public string To;
        [JsonProperty("entryKey")] public string EntryKey;
        [JsonProperty("tx")] public int Tx;
        [JsonProperty("tz")] public int Tz;
        [JsonProperty("radius")] public float Radius;
    }

    public sealed class Vec3
    {
        [JsonProperty("x")] public float X;
        [JsonProperty("y")] public float Y;
        [JsonProperty("z")] public float Z;
    }

    public sealed class Vec2Xz
    {
        [JsonProperty("x")] public float X;
        [JsonProperty("z")] public float Z;
    }

    public sealed class LocationObject
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("model")] public string Model;
        [JsonProperty("name")] public string Name;
        [JsonProperty("kind")] public string Kind;

        /// <summary>Путь вида /assets/models/wasteland/trader_npc.glb — относительно origin сервера.</summary>
        [JsonProperty("url")] public string Url;

        [JsonProperty("position")] public Vec3 Position;
        [JsonProperty("rotation")] public Vec3 Rotation;
        [JsonProperty("scale")] public Vec3 Scale;

        /// <summary>"solid", "none" и прочие режимы. Определяет, ставить ли коллайдер.</summary>
        [JsonProperty("collision")] public string Collision;
        [JsonProperty("playerCollision")] public JToken PlayerCollision;
        [JsonProperty("movementCollision")] public JToken MovementCollision;

        [JsonProperty("tags")] public List<string> Tags = new List<string>();
        [JsonProperty("footprint")] public Vec2Xz Footprint;
        [JsonProperty("placement")] public JObject Placement;
        [JsonProperty("interactive")] public JObject Interactive;
        [JsonProperty("resourceType")] public string ResourceType;
        [JsonProperty("resource")] public string Resource;
        [JsonProperty("craftingStations")] public List<string> CraftingStations = new List<string>();

        /// <summary>Заполнено только у NPC и врагов: фракция, диалог, торговый профиль и т.д.</summary>
        [JsonProperty("entity")] public JObject Entity;

        [JsonProperty("vision")] public JObject Vision;

        /// <summary>
        /// role: wall / window / roof / floor и флаг losBlocking. Ни одна из текущих
        /// локаций этого не задаёт, но сервер поле читает (server.js:12292), а разбор
        /// здания на роли — штатный способ не накрывать игрока его же крышей.
        /// </summary>
        [JsonProperty("occlusion")] public JObject Occlusion;

        /// <summary>
        /// Явный размер коллизии в метрах, приоритетнее footprint. Пишется двумя
        /// способами — width/depth и x/z, — поэтому разбирается вручную.
        /// </summary>
        [JsonProperty("collisionSize")] public JObject CollisionSize;
        [JsonProperty("collisionParts")] public JArray CollisionParts;

        public bool HasTag(string tag)
        {
            return Tags != null && Tags.Contains(tag);
        }

        /// <summary>
        /// NPC и враги приходят в objects вместе с декорациями, но их позиции авторитетно
        /// задаёт сервер через enemySnapshot. Статическую геометрию грузим из локации,
        /// живых существ — нет, иначе получим дубли.
        /// </summary>
        public bool IsLiveEntity()
        {
            string kind = Entity?["kind"]?.ToString().Trim().ToLowerInvariant() ?? string.Empty;
            if (kind == "npc" || kind == "enemy" || kind == "monster") return true;

            if (Tags != null)
            {
                foreach (string rawTag in Tags)
                {
                    string tag = (rawTag ?? string.Empty).ToLowerInvariant();
                    if (tag == "npc" || tag == "enemy" || tag == "monster" || tag == "living"
                        || tag == "friendly" || tag == "guard" || tag == "merchant" || tag == "trader")
                        return true;
                }
            }

            string model = (Model ?? string.Empty).ToLowerInvariant();
            return model.StartsWith("enemy") || model.StartsWith("npc") || model.StartsWith("tradernpc")
                || model.StartsWith("caravanmerchant") || model.StartsWith("caravanguard")
                || model.StartsWith("klimpatrolguard") || model.StartsWith("wastelandsettler")
                || model.StartsWith("friendlybrahmin");
        }
    }
}
