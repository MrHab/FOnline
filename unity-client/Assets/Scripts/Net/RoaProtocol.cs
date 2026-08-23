using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RealmOfAshes.Net
{
    // Контракт зафиксирован в docs/wiki/SOCKET_EVENTS.md и проверяется на сервере
    // скриптом tools/check-socket-event-contract.js. Имена полей менять нельзя:
    // они совпадают с production-сервером (server.js) буква в букву.
    //
    // Гибкие блоки состояния (инвентарь, задания, экономика и социальные данные)
    // оставлены как JObject: сервер развивает их независимо, а игровые подсистемы
    // читают только нужные поля, не теряя остальные при авторитетной сверке.

    #region HTTP: авторизация и персонажи

    public sealed class LoginRequest
    {
        [JsonProperty("login")] public string Login;
        [JsonProperty("password")] public string Password;
    }

    public sealed class LoginResponse
    {
        [JsonProperty("ok")] public bool Ok;
        [JsonProperty("error")] public string Error;
        [JsonProperty("token")] public string Token;
        [JsonProperty("hasSave")] public bool HasSave;
        [JsonProperty("characters")] public List<CharacterSummary> Characters = new List<CharacterSummary>();
    }

    /// <summary>
    /// Строка списка персонажей. Формируется summarizeState() (server.js:1317).
    /// Идентификатор приходит в поле "id", а не "characterId" — в join его нужно
    /// передавать уже как characterId.
    /// </summary>
    public sealed class CharacterSummary
    {
        [JsonProperty("id")] public string CharacterId;
        [JsonProperty("name")] public string Name;
        [JsonProperty("level")] public int Level;
        [JsonProperty("xp")] public int Xp;
        [JsonProperty("factionId")] public string FactionId;
        [JsonProperty("locationId")] public string LocationId;
        [JsonProperty("appearance")] public JObject Appearance;
        /// <summary>Сервер (listStoredUserCharacters) отдаёт updatedAt, не savedAt.</summary>
        [JsonProperty("updatedAt")] public long UpdatedAt;
        [JsonProperty("createdAt")] public long CreatedAt;

        public override string ToString()
        {
            return Name + " (ур. " + Level + ", " + LocationId + ")";
        }
    }

    #endregion

    #region Socket.IO: join

    /// <summary>
    /// Payload события join. Разбор — server.js:19118.
    /// enemyFrameVersion = 1 обязателен: иначе сервер шлёт тяжёлые полные enemySnapshot
    /// вместо компактных enemyFrame (docs/wiki/SOCKET_EVENTS.md, раздел «Частота и порядок»).
    /// </summary>
    public sealed class JoinRequest
    {
        [JsonProperty("token")] public string Token;
        [JsonProperty("deviceId")] public string DeviceId;
        [JsonProperty("clientInstanceId")] public string ClientInstanceId;
        [JsonProperty("deviceType")] public string DeviceType = "desktop";
        [JsonProperty("controlType")] public string ControlType = "keyboard_mouse";
        [JsonProperty("characterId")] public string CharacterId;
        [JsonProperty("enemyFrameVersion")] public int EnemyFrameVersion = 1;

        // Ниже — только для первого входа новым персонажем. Для существующего
        // персонажа поля остаются null и не сериализуются: сервер проверяет их
        // через newServerCharacterSelectionError() лишь когда персонажа ещё нет
        // в хранилище (server.js:6939).

        [JsonProperty("name", NullValueHandling = NullValueHandling.Ignore)]
        public string Name;

        [JsonProperty("appearance", NullValueHandling = NullValueHandling.Ignore)]
        public CharacterAppearance Appearance;

        [JsonProperty("special", NullValueHandling = NullValueHandling.Ignore)]
        public CharacterSpecial Special;

        [JsonProperty("taggedSkills", NullValueHandling = NullValueHandling.Ignore)]
        public string[] TaggedSkills;

        [JsonProperty("traits", NullValueHandling = NullValueHandling.Ignore)]
        public string[] Traits;
    }

    /// <summary>
    /// Внешность нового персонажа. Допустимые значения жёстко заданы на сервере:
    /// schema — realm.character-appearance.v1; sex — female/male; bodyType —
    /// slim/medium/large; faceId — female_01..04 или male_01..04; hairId и
    /// hairColorId — из SERVER_CHARACTER_HAIR_IDS и SERVER_CHARACTER_HAIR_COLOR_IDS.
    /// skinToneId сейчас зафиксирован сервером как skin_03.
    /// </summary>
    public sealed class CharacterAppearance
    {
        [JsonProperty("schema")] public string Schema = "realm.character-appearance.v1";
        [JsonProperty("sex")] public string Sex = "male";
        [JsonProperty("bodyType")] public string BodyType = "medium";
        [JsonProperty("faceId")] public string FaceId = "male_01";
        [JsonProperty("hairId")] public string HairId = "short_crop";
        [JsonProperty("skinToneId")] public string SkinToneId = "skin_03";
        [JsonProperty("hairColorId")] public string HairColorId = "hair_01";
    }

    /// <summary>
    /// Starting SPECIAL distribution. The web creator spends 40 points with every
    /// stat constrained to 1..10; the Node server remains authoritative after join.
    /// </summary>
    public sealed class CharacterSpecial
    {
        [JsonProperty("str")] public int Strength = 5;
        [JsonProperty("per")] public int Perception = 5;
        [JsonProperty("end")] public int Endurance = 5;
        [JsonProperty("cha")] public int Charisma = 5;
        [JsonProperty("int")] public int Intelligence = 5;
        [JsonProperty("agi")] public int Agility = 5;
        [JsonProperty("luck")] public int Luck = 5;

        public int Total
        {
            get { return Strength + Perception + Endurance + Charisma + Intelligence + Agility + Luck; }
        }
    }

    /// <summary>Ack события join. Формируется в currentJoinedSocketAck(), server.js:19063.</summary>
    public sealed class JoinAck
    {
        [JsonProperty("ok")] public bool Ok;
        [JsonProperty("error")] public string Error;
        [JsonProperty("alreadyJoined")] public bool AlreadyJoined;
        [JsonProperty("id")] public string Id;
        [JsonProperty("roomId")] public string RoomId;
        [JsonProperty("locationId")] public string LocationId;
        [JsonProperty("lastVisitedSettlementId")] public string LastVisitedSettlementId;
        [JsonProperty("characterId")] public string CharacterId;
        [JsonProperty("characterLeaseId")] public string CharacterLeaseId;
        [JsonProperty("x")] public float X;
        [JsonProperty("z")] public float Z;
        [JsonProperty("self")] public JObject Self;
        [JsonProperty("combat")] public JObject Combat;
        [JsonProperty("players")] public List<PublicPlayer> Players = new List<PublicPlayer>();
        [JsonProperty("worldState")] public JObject WorldState;
        [JsonProperty("serverAuthoritativeEnemies")] public bool ServerAuthoritativeEnemies;
    }

    #endregion

    #region Socket.IO: игроки и движение

    /// <summary>Полное публичное состояние игрока. Портирует publicPlayer(), server.js:18236.</summary>
    public sealed class PublicPlayer
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("characterId")] public string CharacterId;
        [JsonProperty("name")] public string Name;
        [JsonProperty("deviceType")] public string DeviceType;
        [JsonProperty("controlType")] public string ControlType;
        [JsonProperty("appearance")] public JObject Appearance;
        [JsonProperty("factionId")] public string FactionId;
        [JsonProperty("worldFactionId")] public string WorldFactionId;
        [JsonProperty("x")] public float X;
        [JsonProperty("z")] public float Z;
        [JsonProperty("vx")] public float Vx;
        [JsonProperty("vz")] public float Vz;
        [JsonProperty("angle")] public float Angle;
        [JsonProperty("crouching")] public bool Crouching;
        [JsonProperty("moving")] public bool Moving;
        [JsonProperty("turning")] public bool Turning;
        [JsonProperty("hp")] public int Hp;
        [JsonProperty("maxHp")] public int MaxHp;
        [JsonProperty("ap")] public float Ap;
        [JsonProperty("maxAp")] public int MaxAp;
        [JsonProperty("dead")] public bool Dead;
        [JsonProperty("level")] public int Level;
        [JsonProperty("weapon")] public string Weapon;
        [JsonProperty("equipment")] public JObject Equipment;
        [JsonProperty("injuries")] public JObject Injuries;
        [JsonProperty("locationId")] public string LocationId;
        [JsonProperty("roomId")] public string RoomId;
    }

    /// <summary>
    /// Предложение собственного состояния — событие state, без ack.
    /// Разбор на сервере: server.js:19439. Сервер авторитетен: он может отклонить пакет
    /// по бюджету коллизий и прислать поправку через authoritativePlayerState
    /// с reason = "movementCorrection".
    /// seq должен строго расти — устаревшие пакеты сервер молча отбрасывает.
    /// </summary>
    public sealed class StateUpdate
    {
        [JsonProperty("seq")] public long Seq;
        [JsonProperty("x")] public float X;
        [JsonProperty("z")] public float Z;
        [JsonProperty("angle")] public float Angle;
        [JsonProperty("vx")] public float Vx;
        [JsonProperty("vz")] public float Vz;
        [JsonProperty("moving")] public bool Moving;
        [JsonProperty("crouching")] public bool Crouching;
        [JsonProperty("turning")] public bool Turning;
    }

    /// <summary>Компактный hot-path пакет движения другого игрока (20 Гц, volatile).</summary>
    public sealed class PlayerStateEvent
    {
        [JsonProperty("roomId")] public string RoomId;
        [JsonProperty("locationId")] public string LocationId;
        [JsonProperty("t")] public long T;
        [JsonProperty("player")] public PlayerMovement Player;
    }

    public sealed class PlayerMovement
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("seq")] public long Seq;
        [JsonProperty("x")] public float X;
        [JsonProperty("z")] public float Z;
        [JsonProperty("vx")] public float Vx;
        [JsonProperty("vz")] public float Vz;
        [JsonProperty("angle")] public float Angle;
        [JsonProperty("moving")] public bool Moving;
        [JsonProperty("crouching")] public bool Crouching;
        [JsonProperty("turning")] public bool Turning;
    }

    public sealed class SessionRejected
    {
        [JsonProperty("error")] public string Error;
        [JsonProperty("reason")] public string Reason;
    }

    #endregion

    #region Socket.IO: враги и NPC

    /// <summary>
    /// Volatile realtime-кадр уже известных врагов. Не создаёт и не удаляет сущности —
    /// появление и смерть приходят надёжным enemySnapshot.
    /// Пакет с seq не больше принятого нужно отбрасывать.
    /// </summary>
    public sealed class EnemyFrameEvent
    {
        [JsonProperty("roomId")] public string RoomId;
        [JsonProperty("locationId")] public string LocationId;
        [JsonProperty("t")] public long T;
        [JsonProperty("seq")] public long Seq;
        [JsonProperty("enemies")] public JArray Enemies;
    }

    /// <summary>Биты поля flags в enemyFrame. Значения из docs/wiki/SOCKET_EVENTS.md.</summary>
    public static class EnemyFrameFlags
    {
        public const int Moving = 1;
        public const int Dead = 2;
        public const int Searched = 4;
        public const int HostileToViewer = 8;
        public const int HasLook = 16;
        public const int HasSpeech = 32;
    }

    #endregion
}
