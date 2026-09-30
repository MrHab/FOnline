using System.Collections.Generic;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Следы на земле зоны: подошвы людей, лапы зверей, колея транспорта. Каждый отпечаток —
    /// запись в мировых координатах (кольцевой буфер на локацию); карта следов вокруг камеры
    /// (RenderTexture, R — глубина) перерисовывается из этих записей и отдаётся шейдеру
    /// земли Kromka Ground глобально (_KromkaPrintMap, _KromkaPrintWindow, _KromkaPrintStrength).
    /// Глубину и срок отпечаток получает в момент шага: мягкость грунта зоны (каталог
    /// наборов земли, prints), влажность и грязь по погоде, вес следа. В пыли след живёт
    /// пару минут, дождь размывает его в разы быстрее; в грязи — полчаса и остаётся, когда
    /// грязь подсохнет. Каждый клиент печатает следы сам по позициям, которые и так приходят
    /// с сервера, и только за видимыми актёрами — следы не выдают спрятанных туманом.
    /// </summary>
    public sealed class RoaGroundPrints : MonoBehaviour
    {
        public enum Kind { Boot = 0, Paw = 1, Tire = 2 }

        /// <summary>Шаги одного актёра: путь с прошлого шага и какая нога следующая.</summary>
        public struct Track
        {
            public Vector3 Last;
            public float Travel;
            public bool Initialized;
            public bool RightFoot;
        }

        /// <summary>Колея одного транспорта: где кончился прошлый отрезок и сколько пройдено.</summary>
        public struct WheelTrack
        {
            public Vector3 Last;
            public float Distance;
            public bool Initialized;
        }

        private struct Print
        {
            public Vector2 Position;
            public Vector2 Forward;
            public float Length;
            public float Width;
            public float Depth;
            public float Mud;
            public float Age;
            public float Life;
            public float Mirror;
            public float V0;
            public float V1;
            public Kind Shape;
        }

        private sealed class Ring
        {
            public Print[] Items;
            public int Next;
            public int Count;
            public float LeftAt = -1f;
        }

        public const string StampShaderName = "Hidden/Realm of Ashes/Kromka Ground Print";
        public const float DustLifeSeconds = 150f;
        public const float MudLifeSeconds = 1800f;
        /// <summary>Дождь старит след в пыли в (1 + 5·дождь) раз быстрее; след в грязи — нет.</summary>
        public const float RainWash = 5f;
        public const float BootLength = 0.29f;
        public const float BootWidth = 0.11f;
        public const float FootSpacing = 0.11f;
        public const float TireSegment = 0.35f;
        public const float BikeTireWidth = 0.11f;
        public const float CarTireWidth = 0.24f;
        public const float CarTrackHalfWidth = 0.78f;
        /// <summary>Слабее этого отпечаток не печатается: бетон и мостовая следов не держат, пока на них нет грязи.</summary>
        public const float MinimumDepth = 0.08f;
        private const float FadeInterval = 2f;
        private const int MaxLocations = 4;

        private static readonly int MapId = Shader.PropertyToID("_KromkaPrintMap");
        private static readonly int WindowId = Shader.PropertyToID("_KromkaPrintWindow");
        private static readonly int StrengthId = Shader.PropertyToID("_KromkaPrintStrength");

        public Camera ViewCamera;
        public RoaPlayerController Player;

        private readonly Dictionary<string, Ring> _rings = new Dictionary<string, Ring>();
        private readonly List<string> _recent = new List<string>();
        private readonly List<int> _pending = new List<int>();
        private readonly List<Vector3> _vertices = new List<Vector3>();
        private readonly List<Vector4> _uvs = new List<Vector4>();
        private readonly List<int> _indices = new List<int>();
        private Ring _ring;
        private RenderTexture _map;
        private Material _stamp;
        private Mesh _mesh;
        private CommandBuffer _command;
        private Vector2 _center;
        private bool _windowValid;
        private bool _drewAlive;
        private float _lastFade;
        private float _nextFade;
        private float _wetness;
        private float _mud;
        private float _rain;
        private Track _localFeet;

        public static bool Mobile { get { return Application.isMobilePlatform; } }
        /// <summary>Сторона карты следов, м: её центр — точка земли под центром кадра.</summary>
        public static float WindowSize { get { return Mobile ? 32f : 48f; } }
        public static int MapSize { get { return Mobile ? 1024 : 2048; } }
        public static int Capacity { get { return Mobile ? 1536 : 4096; } }

        public bool Active { get { return _ring != null && _map != null && _stamp != null; } }
        public string LocationId { get; private set; }
        public float Softness { get; private set; }
        public int PrintCount { get { return _ring != null ? _ring.Count : 0; } }
        public int DrawCount { get; private set; }
        public RenderTexture Map { get { return _map; } }
        public Vector2 WindowCenter { get { return _center; } }
        public float Wetness { get { return _wetness; } }
        public float Mud { get { return _mud; } }
        public float Rain { get { return _rain; } }

        /// <summary>Погода комнаты (RoaWeather): влажность и грязь углубляют новые следы, дождь размывает следы в пыли.</summary>
        public void SetConditions(float wetness, float mud, float rain)
        {
            _wetness = Mathf.Clamp01(wetness);
            _mud = Mathf.Clamp01(mud);
            _rain = Mathf.Clamp01(rain);
        }

        /// <summary>
        /// Новая локация: свои следы (последние четыре локации помнят их, пока клиент жив),
        /// мягкость её грунта. null — вне мира, шейдер земли следов не читает.
        /// </summary>
        public void SetLocation(string locationId, string groundPreset)
        {
            float now = Time.unscaledTime;
            if (_ring != null) _ring.LeftAt = now;
            _pending.Clear();
            _localFeet = default(Track);
            _windowValid = false;
            if (string.IsNullOrEmpty(locationId))
            {
                _ring = null;
                LocationId = null;
                Shader.SetGlobalFloat(StrengthId, 0f);
                return;
            }
            LocationId = locationId;
            string set = RoaGroundTextures.SetForPreset(groundPreset);
            Softness = string.IsNullOrEmpty(set) ? 0.5f : RoaGroundTextures.Info(set).Prints;
            if (!_rings.TryGetValue(locationId, out Ring ring))
            {
                ring = new Ring { Items = new Print[Capacity] };
                _rings[locationId] = ring;
            }
            else if (ring.LeftAt >= 0f)
            {
                Age(ring, now - ring.LeftAt, 0f);
            }
            _recent.Remove(locationId);
            _recent.Add(locationId);
            while (_recent.Count > MaxLocations)
            {
                _rings.Remove(_recent[0]);
                _recent.RemoveAt(0);
            }
            _ring = ring;
            _lastFade = now;
            _nextFade = now + FadeInterval;
            EnsureResources();
        }

        /// <summary>
        /// Шаги актёра по пройденному пути: шаг человека 0,7–1,3 м от ходьбы к бегу, лапы
        /// чаще. active — актёр виден, рядом и идёт; иначе счёт шагов начинается заново.
        /// </summary>
        public bool TrackFeet(ref Track track, Vector3 position, Vector3 velocity, bool active,
                              Kind kind = Kind.Boot, float scale = 1f)
        {
            if (_ring == null || !active || !track.Initialized)
            {
                track.Last = position;
                track.Travel = 0f;
                track.Initialized = active && _ring != null;
                return false;
            }
            Vector3 delta = position - track.Last;
            delta.y = 0f;
            float distance = delta.magnitude;
            track.Last = position;
            if (distance > 3f)
            {
                track.Travel = 0f;
                return false;
            }
            if (distance < 0.0001f) return false;
            Vector3 forward = delta / distance;
            velocity.y = 0f;
            float pace = Mathf.InverseLerp(1.2f, 6.5f, velocity.magnitude);
            float stride = kind == Kind.Paw
                ? Mathf.Lerp(0.3f, 0.7f, pace) * Mathf.Clamp(scale, 0.3f, 2f)
                : Mathf.Lerp(0.7f, 1.3f, pace) * Mathf.Clamp(scale, 0.8f, 1.3f);
            track.Travel += distance;
            bool stamped = false;
            for (int guard = 0; track.Travel >= stride && guard < 4; guard++)
            {
                track.Travel -= stride;
                track.RightFoot = !track.RightFoot;
                stamped |= StampFoot(position - forward * track.Travel, forward, kind, track.RightFoot, scale);
            }
            if (track.Travel >= stride) track.Travel = 0f;
            return stamped;
        }

        /// <summary>
        /// Колея: отрезок шины на каждые 35 см пути. Мотоцикл — одна колея за задним колесом,
        /// машина (twin) — две колеи по бокам.
        /// </summary>
        public bool TrackWheels(ref WheelTrack track, Vector3 position, Vector3 velocity, bool active, bool twin)
        {
            velocity.y = 0f;
            Vector3 forward = velocity.sqrMagnitude > 0.01f ? velocity.normalized : Vector3.zero;
            Vector3 axle = twin || forward == Vector3.zero ? position : position - forward * RoaMovementFx.RearWheelOffset;
            if (_ring == null || !active || !track.Initialized)
            {
                track.Last = axle;
                track.Initialized = active && _ring != null;
                return false;
            }
            Vector3 delta = axle - track.Last;
            delta.y = 0f;
            float length = delta.magnitude;
            if (length > 6f)
            {
                track.Last = axle;
                return false;
            }
            if (length < TireSegment) return false;
            Vector3 direction = delta / length;
            Vector3 middle = (axle + track.Last) * 0.5f;
            bool stamped;
            if (twin)
            {
                Vector3 side = new Vector3(direction.z, 0f, -direction.x) * CarTrackHalfWidth;
                stamped = StampTire(middle - side, direction, length, CarTireWidth, track.Distance);
                stamped |= StampTire(middle + side, direction, length, CarTireWidth, track.Distance);
            }
            else
            {
                stamped = StampTire(middle, direction, length, BikeTireWidth, track.Distance);
            }
            track.Distance += length;
            track.Last = axle;
            return stamped;
        }

        /// <summary>Машина с двумя колеями по id предмета транспорта; остальное — одноколейные.</summary>
        public static bool TwinTrack(string vehicleItemId)
        {
            if (string.IsNullOrEmpty(vehicleItemId)) return false;
            string id = vehicleItemId.ToLowerInvariant();
            return id.Contains("pickup") || id.Contains("truck") || id.Contains("car") || id.Contains("buggy");
        }

        public bool StampFoot(Vector3 position, Vector3 forward, Kind kind, bool rightFoot, float scale = 1f)
        {
            forward.y = 0f;
            if (forward.sqrMagnitude < 0.000001f) return false;
            forward.Normalize();
            bool paw = kind == Kind.Paw;
            Vector3 side = new Vector3(forward.z, 0f, -forward.x);
            Vector3 at = position + side * ((paw ? 0.09f : FootSpacing) * scale * (rightFoot ? 1f : -1f));
            return Add(new Print
            {
                Position = new Vector2(at.x, at.z),
                Forward = new Vector2(forward.x, forward.z),
                Length = (paw ? 0.15f : BootLength) * scale,
                Width = (paw ? 0.13f : BootWidth) * scale,
                Mirror = rightFoot ? 1f : -1f,
                Shape = paw ? Kind.Paw : Kind.Boot
            }, paw ? 0.75f : 0.85f);
        }

        public bool StampTire(Vector3 middle, Vector3 direction, float length, float width, float distance)
        {
            direction.y = 0f;
            if (direction.sqrMagnitude < 0.000001f) return false;
            direction.Normalize();
            // Отрезки заходят друг на друга, чтобы колея шла без щелей.
            float overlap = width * 0.3f;
            return Add(new Print
            {
                Position = new Vector2(middle.x, middle.z),
                Forward = new Vector2(direction.x, direction.z),
                Length = length + overlap * 2f,
                Width = width,
                Mirror = 1f,
                V0 = distance - overlap,
                V1 = distance + length + overlap,
                Shape = Kind.Tire
            }, 1f);
        }

        /// <summary>Глубина нового отпечатка сейчас: мягкость грунта, влажность и грязь, вес следа.</summary>
        public float Impression(float weight)
        {
            float soft = Mathf.Clamp01(Softness * (1f + 0.5f * _wetness) + _mud * 0.9f);
            return Mathf.Clamp01(weight * soft);
        }

        /// <summary>Сколько секунд проживёт новый след: в пыли пару минут, в грязи полчаса.</summary>
        public float LifeSeconds { get { return Mathf.Lerp(DustLifeSeconds, MudLifeSeconds, Mathf.Clamp01(_mud * 1.3f)); } }

        /// <summary>Глубина самого глубокого живого отпечатка в радиусе, как её видит шейдер (для проб).</summary>
        public float DepthNear(Vector3 position, float radius)
        {
            if (_ring == null) return 0f;
            var point = new Vector2(position.x, position.z);
            float best = 0f;
            for (int i = 0; i < _ring.Count; i++)
            {
                if ((_ring.Items[i].Position - point).sqrMagnitude > radius * radius) continue;
                best = Mathf.Max(best, _ring.Items[i].Depth * Fade(_ring.Items[i]));
            }
            return best;
        }

        /// <summary>Координаты карты следов для точки мира — та же формула, что в шейдере земли.</summary>
        public Vector2 MapUV(Vector3 world)
        {
            return new Vector2((world.x - _center.x) / WindowSize + 0.5f, (world.z - _center.y) / WindowSize + 0.5f);
        }

        /// <summary>Состарить следы на seconds при нынешнем дожде (пробы; в игре — по времени).</summary>
        public void Advance(float seconds)
        {
            if (_ring == null) return;
            Age(_ring, seconds, _rain);
            _windowValid = false;
        }

        /// <summary>Перерисовать карту сейчас; center — центр окна (пробы), иначе точка под камерой.</summary>
        public void Refresh(Vector2? center = null)
        {
            if (_ring == null) return;
            EnsureResources();
            if (!Active) return;
            Redraw(center ?? Focus(), true);
        }

        private void LateUpdate()
        {
            if (_ring == null) return;
            EnsureResources();
            if (!Active) return;
            if (!_map.IsCreated())
            {
                _map.Create();
                _windowValid = false;
            }
            TrackLocalPlayer();

            float now = Time.unscaledTime;
            bool full = !_windowValid;
            if (now >= _nextFade)
            {
                bool alive = Age(_ring, now - _lastFade, _rain) > 0;
                _lastFade = now;
                _nextFade = now + FadeInterval;
                full |= alive || _drewAlive;
            }
            Vector2 focus = Focus();
            if ((focus - _center).sqrMagnitude > WindowSize * WindowSize / 64f) full = true;
            if (full) Redraw(focus, true);
            else if (_pending.Count > 0) Redraw(_center, false);
        }

        private void OnDisable()
        {
            Shader.SetGlobalFloat(StrengthId, 0f);
            _windowValid = false;
        }

        private void OnDestroy()
        {
            Shader.SetGlobalFloat(StrengthId, 0f);
            if (_map != null) _map.Release();
            Dispose(_map);
            Dispose(_stamp);
            Dispose(_mesh);
            _command?.Release();
            _map = null;
            _stamp = null;
            _mesh = null;
            _command = null;
        }

        private void TrackLocalPlayer()
        {
            if (Player == null || Player.Mounted)
            {
                _localFeet.Initialized = false;
                return;
            }
            Vector3 ground = Player.View != null ? Player.View.transform.position : Player.transform.position;
            TrackFeet(ref _localFeet, ground, Player.Velocity, Player.Moving && Player.isActiveAndEnabled);
        }

        private bool Add(Print print, float weight)
        {
            if (_ring == null) return false;
            float depth = Impression(weight);
            if (depth < MinimumDepth) return false;
            print.Depth = depth;
            print.Mud = Mathf.Clamp01(_mud * 1.3f);
            print.Life = LifeSeconds;
            print.Age = 0f;
            int index = _ring.Next;
            _ring.Items[index] = print;
            _ring.Next = (index + 1) % _ring.Items.Length;
            _ring.Count = Mathf.Min(_ring.Count + 1, _ring.Items.Length);
            if (_pending.Count < 256) _pending.Add(index);
            else _windowValid = false;
            return true;
        }

        private static int Age(Ring ring, float seconds, float rain)
        {
            if (seconds <= 0f) return CountAlive(ring);
            int alive = 0;
            for (int i = 0; i < ring.Count; i++)
            {
                ref Print print = ref ring.Items[i];
                if (print.Age >= print.Life) continue;
                print.Age += seconds * (1f + rain * RainWash * (1f - print.Mud));
                if (print.Age < print.Life) alive++;
            }
            return alive;
        }

        private static int CountAlive(Ring ring)
        {
            int alive = 0;
            for (int i = 0; i < ring.Count; i++)
                if (ring.Items[i].Age < ring.Items[i].Life) alive++;
            return alive;
        }

        private static float Fade(in Print print)
        {
            if (print.Age >= print.Life) return 0f;
            return 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(print.Life * 0.55f, print.Life, print.Age));
        }

        private Vector2 Focus()
        {
            float groundY = 0f;
            if (Player != null) groundY = (Player.View != null ? Player.View.transform : Player.transform).position.y;
            Camera view = ViewCamera != null ? ViewCamera : Camera.main;
            if (view != null)
            {
                Ray ray = view.ViewportPointToRay(new Vector3(0.5f, 0.5f, 0f));
                if (ray.direction.y < -0.05f)
                {
                    Vector3 hit = ray.origin + ray.direction * ((groundY - ray.origin.y) / ray.direction.y);
                    return new Vector2(hit.x, hit.z);
                }
            }
            if (Player != null) return new Vector2(Player.transform.position.x, Player.transform.position.z);
            return _center;
        }

        private void Redraw(Vector2 center, bool full)
        {
            if (full)
            {
                // Центр — на сетке текселей: при переносе окна отпечатки ложатся в те же тексели.
                float texel = WindowSize / MapSize;
                _center = new Vector2(Mathf.Round(center.x / texel) * texel, Mathf.Round(center.y / texel) * texel);
            }
            _vertices.Clear();
            _uvs.Clear();
            _indices.Clear();
            float half = WindowSize * 0.5f + 0.5f;
            bool alive = false;
            if (full)
            {
                for (int i = 0; i < _ring.Count; i++) alive |= Append(i, half);
            }
            else
            {
                foreach (int i in _pending) alive |= Append(i, half);
            }
            _pending.Clear();

            _mesh.Clear();
            if (_vertices.Count > 0)
            {
                _mesh.SetVertices(_vertices);
                _mesh.SetUVs(0, _uvs);
                _mesh.SetTriangles(_indices, 0, false);
            }
            _command.Clear();
            _command.SetRenderTarget(_map);
            if (full) _command.ClearRenderTarget(false, true, Color.clear);
            if (_vertices.Count > 0)
            {
                float size = WindowSize * 0.5f;
                Matrix4x4 projection = Matrix4x4.Ortho(_center.x - size, _center.x + size, _center.y - size, _center.y + size, -1f, 1f);
                // Матрицу под платформу и переворот цели приводит сам SetViewProjectionMatrices.
                _command.SetViewProjectionMatrices(Matrix4x4.identity, projection);
                _command.DrawMesh(_mesh, Matrix4x4.identity, _stamp, 0, 0);
            }
            Graphics.ExecuteCommandBuffer(_command);
            DrawCount++;
            if (full)
            {
                _windowValid = true;
                _drewAlive = alive;
            }
            else
            {
                _drewAlive |= alive;
            }
            Shader.SetGlobalTexture(MapId, _map);
            Shader.SetGlobalVector(WindowId, new Vector4(_center.x, _center.y, 1f / WindowSize, 1f / MapSize));
            Shader.SetGlobalFloat(StrengthId, 1f);
        }

        private bool Append(int index, float half)
        {
            Print print = _ring.Items[index];
            float fade = Fade(print);
            if (fade <= 0.01f) return false;
            if (Mathf.Abs(print.Position.x - _center.x) > half || Mathf.Abs(print.Position.y - _center.y) > half) return true;
            Vector2 forward = print.Forward;
            var side = new Vector2(forward.y, -forward.x);
            float halfLength = print.Length * 0.5f;
            float halfWidth = print.Width * 0.5f;
            float depth = print.Depth * fade;
            int start = _vertices.Count;
            for (int corner = 0; corner < 4; corner++)
            {
                float across = corner == 0 || corner == 3 ? -1f : 1f;
                float along = corner < 2 ? -1f : 1f;
                Vector2 world = print.Position + side * (across * halfWidth) + forward * (along * halfLength);
                _vertices.Add(new Vector3(world.x, world.y, 0f));
                float v = print.Shape == Kind.Tire ? (along < 0f ? print.V0 : print.V1) : along;
                _uvs.Add(new Vector4(across * print.Mirror, v, depth, (float)print.Shape));
            }
            _indices.Add(start);
            _indices.Add(start + 1);
            _indices.Add(start + 2);
            _indices.Add(start);
            _indices.Add(start + 2);
            _indices.Add(start + 3);
            return true;
        }

        private void EnsureResources()
        {
            if (_stamp == null)
            {
                Shader shader = Shader.Find(StampShaderName);
                if (shader == null || !shader.isSupported) return;
                _stamp = new Material(shader) { name = "KromkaGroundPrintStamp", hideFlags = HideFlags.HideAndDontSave };
            }
            if (_map == null)
            {
                RenderTextureFormat format = SystemInfo.SupportsRenderTextureFormat(RenderTextureFormat.R8)
                    ? RenderTextureFormat.R8 : RenderTextureFormat.ARGB32;
                _map = new RenderTexture(MapSize, MapSize, 0, format, RenderTextureReadWrite.Linear)
                {
                    name = "KromkaGroundPrints",
                    filterMode = FilterMode.Bilinear,
                    wrapMode = TextureWrapMode.Clamp,
                    useMipMap = false,
                    autoGenerateMips = false,
                    hideFlags = HideFlags.HideAndDontSave
                };
                _map.Create();
                _windowValid = false;
            }
            if (_mesh == null)
            {
                _mesh = new Mesh { name = "KromkaGroundPrints", hideFlags = HideFlags.HideAndDontSave };
                _mesh.MarkDynamic();
            }
            if (_command == null) _command = new CommandBuffer { name = "Kromka ground prints" };
        }

        private static void Dispose(Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
