using System;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Радиационная буря выброса в клиенте. Сервер присылает путь бури и рамку
    /// сцены игрока (artifactState.shift.storm), компонент сам двигает фронт по
    /// серверным часам и показывает его там же, где он стоит на карте мира:
    /// стена пыли на передней и задней кромке, песок и тучи вокруг игрока, молнии
    /// и гром, темнота и зелёный отсвет (RoaWorldLighting.SetWeather), ветер и
    /// треск дозиметра. Урон считает сервер — здесь только то, что видно и слышно.
    ///
    /// Карта мира, миникарта и окно зоны берут бурю отсюда (Active, Path,
    /// ServerNowMs), поэтому фронт на них и в сцене совпадает.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed partial class RoaRadiationStorm : MonoBehaviour
    {
        /// <summary>За сколько километров карты буря уже чувствуется: темнеет, крепчает ветер.</summary>
        public const double FeelAheadKm = 26d;
        /// <summary>Сколько километров за задней кромкой ещё держится пыль.</summary>
        public const double TailKm = 14d;

        public static RoaRadiationStorm Active { get; private set; }

        /// <summary>Путь текущей бури; null — бури нет.</summary>
        public RoaRadiationStormPath Path { get; private set; }
        /// <summary>Рамка сцены, для которой её прислал сервер (FrameLocationId).</summary>
        public RoaRadiationStormFrame Frame { get; private set; }
        public string FrameLocationId { get; private set; } = string.Empty;
        /// <summary>Игрок в укрытии (город, база, мирная зона): буря идёт, но не бьёт.</summary>
        public bool Sheltered { get; private set; }
        /// <summary>Буря над точкой игрока по серверным часам; HasHere — рамка годится для этой сцены.</summary>
        public RoaRadiationStormPath.Sample Here { get; private set; }
        public bool HasHere { get; private set; }
        /// <summary>Насколько буря ощущается у игрока, 0..1: приближение, стена, глубина, хвост.</summary>
        public float Presence { get; private set; }
        /// <summary>Вспышка молнии, 0..1.</summary>
        public float Flash { get { return _flash; } }

        /// <summary>Передняя кромка бури дошла до игрока.</summary>
        public event Action StormReachedPlayer;

        private RoaGameBootstrap _bootstrap;
        private double _clockOffsetMs;
        private bool _hasClock;
        private bool _wasInside;

        public static double UnixNowMs { get { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); } }

        /// <summary>Серверное время, мс Unix.</summary>
        public double ServerNowMs { get { return UnixNowMs + _clockOffsetMs; } }

        public void Configure(RoaGameBootstrap bootstrap)
        {
            _bootstrap = bootstrap;
            Active = this;
        }

        private void OnEnable()
        {
            if (Active == null) Active = this;
        }

        private void OnDestroy()
        {
            if (Active == this) Active = null;
            if (_bootstrap != null && _bootstrap.Lighting != null) _bootstrap.Lighting.SetWeather(0f, 0f);
            ReleaseVisuals();
            ReleaseAudio();
        }

        /// <summary>
        /// Состояние сдвига с сервера. locationId — локация, для которой сервер
        /// считал рамку (artifactState.locationId); без него рамка не меняется.
        /// </summary>
        public void ApplyShift(JObject shift, string locationId)
        {
            if (shift == null) return;
            long serverNow = shift["serverNow"]?.Value<long>() ?? 0L;
            if (serverNow > 0L) SyncClock(serverNow);
            JObject storm = shift["storm"] as JObject;
            Path = RoaRadiationStormPath.Parse(storm);
            if (!string.IsNullOrEmpty(locationId))
            {
                Sheltered = shift["sheltered"]?.Value<bool>() == true;
                RoaRadiationStormFrame frame = RoaRadiationStormFrame.Parse(storm?["frame"] as JObject);
                if (frame.Valid)
                {
                    Frame = frame;
                    FrameLocationId = locationId;
                }
            }
        }

        private void SyncClock(long serverNow)
        {
            double offset = serverNow - UnixNowMs;
            if (!_hasClock || Math.Abs(offset - _clockOffsetMs) > 1500d)
            {
                _clockOffsetMs = offset;
                _hasClock = true;
            }
            else _clockOffsetMs += (offset - _clockOffsetMs) * 0.15d;
        }

        /// <summary>Локация, в которой стоит игрок (по загрузчику сцены).</summary>
        public string CurrentLocationId
        {
            get { return _bootstrap != null && _bootstrap.Loader != null ? _bootstrap.Loader.Current?.Id ?? string.Empty : string.Empty; }
        }

        /// <summary>Рамка годится для открытой сцены: сервер считал её для этой же локации.</summary>
        public bool FrameMatchesScene
        {
            get { return Frame.Valid && !string.IsNullOrEmpty(FrameLocationId) && FrameLocationId == CurrentLocationId; }
        }

        /// <summary>Насколько буря ощущается в точке с такой выборкой, 0..1.</summary>
        public static float PresenceOf(RoaRadiationStormPath.Sample sample)
        {
            if (sample.Inside) return Mathf.Lerp(0.72f, 1f, sample.Intensity);
            if (sample.AheadKm > 0d) return 0.62f * (1f - Smooth01((float)(sample.AheadKm / FeelAheadKm)));
            return 0.55f * (1f - Smooth01((float)(sample.BehindKm / TailKm)));
        }

        private void Update()
        {
            bool inWorld = _bootstrap != null && _bootstrap.InGame;
            Transform player = inWorld && _bootstrap.PlayerView != null ? _bootstrap.PlayerView.transform : null;
            bool local = Path != null && player != null && FrameMatchesScene;
            double now = ServerNowMs;
            if (local)
            {
                Vector3 at = player.position;
                Vector2 global = Frame.LocalToGlobal(at.x, at.z);
                Here = Path.SampleAt(global.x, global.y, now);
            }
            else Here = default;
            HasHere = local;

            float target = local ? PresenceOf(Here) : 0f;
            // Смена сцены и приход стены — не скачком: стена «ударяет» за пару десятых секунды.
            Presence = Mathf.MoveTowards(Presence, target, Time.deltaTime * (target > Presence ? 0.9f : 0.45f));
            bool inside = local && Here.Inside;
            if (inside && !_wasInside) StormReachedPlayer?.Invoke();
            _wasInside = inside;

            UpdateVisuals(local ? player.position : Vector3.zero, local, now);
            UpdateAudio(inWorld);
            if (_bootstrap != null && _bootstrap.Lighting != null)
                _bootstrap.Lighting.SetWeather(inWorld ? Presence * (Sheltered ? 0.8f : 1f) : 0f, inWorld ? _flash : 0f);
        }

        /// <summary>
        /// Пробы редактора: показать бурю у точки сцены на момент серверного времени
        /// без игрока и сокета (путь и рамку задаёт ApplyShift). strike — ударить
        /// молнией рядом с точкой.
        /// </summary>
        public void PreviewForProbe(Vector3 player, double serverNowMs, bool strike)
        {
            if (Path == null || !Frame.Valid) return;
            Vector2 global = Frame.LocalToGlobal(player.x, player.z);
            Here = Path.SampleAt(global.x, global.y, serverNowMs);
            HasHere = true;
            Presence = PresenceOf(Here);
            // В редакторе время не идёт: вспышка прошлого кадра не погасла бы сама.
            _flash = 0f;
            _nextStrikeAt = float.MaxValue;
            UpdateVisuals(player, true, serverNowMs);
            if (strike)
            {
                Strike(RandomGroundAround(player, 9f, 18f), 1f);
                UpdateBolts();
                // Кадр — середина вспышки, а не её пик.
                _flash = 0.55f;
            }
        }

        private static float Smooth01(float value)
        {
            float t = Mathf.Clamp01(value);
            return t * t * (3f - 2f * t);
        }

        /// <summary>«40 с», «3 мин» — сколько до прихода бури.</summary>
        public static string EtaText(int seconds)
        {
            if (seconds < 0) return string.Empty;
            if (seconds < 90) return Mathf.Max(5, Mathf.RoundToInt(seconds / 5f) * 5) + " с";
            return Mathf.RoundToInt(seconds / 60f) + " мин";
        }
    }
}
