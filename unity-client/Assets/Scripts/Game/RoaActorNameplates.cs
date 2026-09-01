using System.Collections.Generic;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Имена и состояние здоровья разговорных NPC и других игроков. Точное HP
    /// открывает только серверно сохранённый талант «Осведомлённость».
    /// </summary>
    public sealed class RoaActorNameplates : MonoBehaviour
    {
        public RoaSocketClient Socket;
        public RoaEnemies Enemies;
        public RoaRemotePlayers RemotePlayers;
        public RoaPlayerController Player;
        public Camera WorldCamera;
        public float MaxDistance = 20f;

        public struct Entry
        {
            public string Name;
            public string Faction;
            public int Hp;
            public int MaxHp;
            public Vector3 World;
            public bool Hostile;
            public bool IsPlayer;
            /// <summary>Свой персонаж: здоровье всегда числом, без перка «Осведомлённость».</summary>
            public bool IsSelf;
        }

        public readonly struct Presentation
        {
            public readonly bool ShowName;
            public readonly bool ShowFaction;
            public readonly bool ShowHealthText;
            public readonly string HealthText;
            public readonly float Width;
            public readonly float Height;
            public readonly float Alpha;

            public Presentation(bool showName, bool showFaction, bool showHealthText, string healthText,
                                float width, float height, float alpha)
            {
                ShowName = showName;
                ShowFaction = showFaction;
                ShowHealthText = showHealthText;
                HealthText = healthText;
                Width = width;
                Height = height;
                Alpha = alpha;
            }
        }

        public static bool IsImportantNpc(bool canDialogue, string role, string encounterRole)
        {
            if (!canDialogue) return false;
            string value = string.IsNullOrWhiteSpace(role) ? encounterRole : role;
            switch ((value ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "merchant":
                case "trader":
                case "quartermaster":
                case "shopkeeper":
                    return true;
                default:
                    return false;
            }
        }

        public static Presentation ResolvePresentation(Entry entry, bool awareness,
                                                       float distance, float maxDistance)
        {
            bool showName = !string.IsNullOrWhiteSpace(entry.Name);
            bool showFaction = !entry.IsPlayer && !string.IsNullOrWhiteSpace(entry.Faction);
            float ratio = entry.Hp / (float)Mathf.Max(1, entry.MaxHp);
            bool exact = awareness || entry.IsSelf;
            bool showHealthText = exact || ratio < 0.995f;
            string healthText = exact
                ? Mathf.Max(0, entry.Hp) + "/" + Mathf.Max(1, entry.MaxHp)
                : CompactHealthState(entry.Hp, entry.MaxHp);
            float t = Mathf.Clamp01(distance / Mathf.Max(0.01f, maxDistance));
            float near = 1f - Mathf.SmoothStep(0.45f, 1f, t);
            float floor = entry.IsSelf ? 1f : entry.Hostile ? 0.68f : 0.34f;
            float alpha = Mathf.Lerp(floor, 1f, near);
            float width = showName || showFaction ? 164f : showHealthText ? 88f : 68f;
            float healthHeight = showHealthText ? 12f : 7f;
            float height = healthHeight + (showFaction ? 14f : 0f) + (showName ? 14f : 0f);
            return new Presentation(showName, showFaction, showHealthText, healthText,
                width, height, alpha);
        }

        public static string NpcFactionLine(string factionId, bool hostile)
        {
            return (hostile ? "ВРАГ" : "МИРНЫЙ") + " · " + RoaPipboy.FactionLabel(factionId);
        }

        private readonly List<Entry> _entries = new List<Entry>();
        private readonly List<Rect> _occupied = new List<Rect>();
        private GUIStyle _nameStyle;
        private GUIStyle _healthStyle;

        public void Configure(RoaSocketClient socket, RoaEnemies enemies,
                              RoaRemotePlayers remotePlayers, Camera worldCamera)
        {
            Socket = socket;
            Enemies = enemies;
            RemotePlayers = remotePlayers;
            WorldCamera = worldCamera;
        }

        public void SetPlayer(RoaPlayerController player)
        {
            Player = player;
        }

        // --- uGUI-вариант (.actor-nameplate, 04_mobile_inventory_trade_quality.css:114) ---

        /// <summary>Подписи рисует канва; IMGUI-вариант молчит.</summary>
        public bool CanvasDriven { get; set; }

        private sealed class Plate
        {
            public GameObject Root;
            public RectTransform Rect;
            public Image Back;
            public Text Name;
            public Text Faction;
            public Text Health;
            public Image HealthTrack;
            public Image HealthFill;
        }

        private Canvas _canvas;
        private RectTransform _layer;
        private readonly List<Plate> _pool = new List<Plate>();

        private static readonly Color PlateBg = new Color(0.035f, 0.055f, 0.039f, 0.52f);
        private static readonly Color PlateBorder = new Color(0.494f, 0.62f, 0.424f, 0.34f);
        private static readonly Color NameInk = new Color(0.859f, 0.906f, 0.784f, 1f);    // #dbe7c8
        private static readonly Color NamePlayer = new Color(0.561f, 0.827f, 1f, 1f);     // #8fd3ff
        private static readonly Color NameHostile = new Color(0.953f, 0.71f, 0.541f, 1f); // #f3b58a
        private static readonly Color HealthInk = new Color(0.624f, 0.843f, 0.627f, 1f);  // #9fd7a0
        private static readonly Color HealthHurt = new Color(0.941f, 0.776f, 0.357f, 1f); // #f0c65b
        private static readonly Color HealthCritical = new Color(1f, 0.416f, 0.322f, 1f); // #ff6a52

        private void EnsureCanvas()
        {
            if (_canvas != null) return;
            var go = new GameObject("ActorNameplates", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler));
            go.transform.SetParent(transform, false);
            _canvas = go.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 5; // z-index 6 web: под всеми окнами, слой не ловит указатель
            var scaler = go.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ConstantPixelSize;
            _layer = (RectTransform)go.transform;
        }

        private Plate AcquirePlate(int index)
        {
            while (_pool.Count <= index)
            {
                var root = new GameObject("Plate", typeof(RectTransform));
                root.transform.SetParent(_layer, false);
                var rect = (RectTransform)root.transform;
                rect.anchorMin = rect.anchorMax = Vector2.zero;
                rect.pivot = new Vector2(0.5f, 0f); // translate(-50%, -100%): центр снизу над точкой
                // Как в браузере: только текст с тенью, без фона и рамки.
                var back = root.AddComponent<Image>();
                back.color = new Color(0f, 0f, 0f, 0f);
                back.raycastTarget = false;
                Text name = PlateText("Name", rect, 11, FontStyle.Bold);
                name.rectTransform.anchorMin = new Vector2(0f, 0.5f);
                name.rectTransform.anchorMax = new Vector2(1f, 1f);
                name.rectTransform.offsetMin = new Vector2(6f, -1f);
                name.rectTransform.offsetMax = new Vector2(-6f, -1f);
                Text health = PlateText("Health", rect, 9, FontStyle.Bold);
                Text faction = PlateText("Faction", rect, 9, FontStyle.Bold);
                health.rectTransform.anchorMin = new Vector2(0f, 0f);
                health.rectTransform.anchorMax = new Vector2(1f, 0.5f);
                health.rectTransform.offsetMin = new Vector2(6f, 2f);
                health.rectTransform.offsetMax = new Vector2(-6f, 1f);
                var trackObject = new GameObject("HealthTrack", typeof(RectTransform), typeof(Image));
                trackObject.transform.SetParent(rect, false);
                var trackRect = (RectTransform)trackObject.transform;
                trackRect.anchorMin = trackRect.anchorMax = new Vector2(0.5f, 0f);
                trackRect.pivot = new Vector2(0.5f, 0f);
                trackRect.sizeDelta = new Vector2(64f, 6f);
                trackRect.anchoredPosition = new Vector2(0f, 1f);
                Image track = trackObject.GetComponent<Image>();
                track.color = new Color(0.015f, 0.018f, 0.014f, 0.82f);
                track.raycastTarget = false;
                var fillObject = new GameObject("Fill", typeof(RectTransform), typeof(Image));
                fillObject.transform.SetParent(trackRect, false);
                var fillRect = (RectTransform)fillObject.transform;
                fillRect.anchorMin = Vector2.zero;
                fillRect.anchorMax = Vector2.one;
                fillRect.offsetMin = new Vector2(1f, 1f);
                fillRect.offsetMax = new Vector2(-1f, -1f);
                Image fill = fillObject.GetComponent<Image>();
                fill.type = Image.Type.Filled;
                fill.fillMethod = Image.FillMethod.Horizontal;
                fill.fillOrigin = 0;
                fill.raycastTarget = false;
                health.transform.SetAsLastSibling();
                _pool.Add(new Plate { Root = root, Rect = rect, Back = back, Name = name,
                    Faction = faction, Health = health, HealthTrack = track, HealthFill = fill });
            }
            return _pool[index];
        }

        private static Text PlateText(string name, RectTransform parent, int size, FontStyle style)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.fontStyle = style;
            text.alignment = TextAnchor.MiddleCenter;
            text.raycastTarget = false;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            var shadow = go.AddComponent<Shadow>();
            shadow.effectColor = new Color(0f, 0f, 0f, 0.85f);
            shadow.effectDistance = new Vector2(0f, -1f);
            return text;
        }

        // --- Подсказка цели (#target-hint): имя и шанс попадания у курсора ---

        public RoaCombat Combat;
        public RoaHud Hud;
        private GameObject _hint;
        private RectTransform _hintRect;
        private Text _hintName;
        private Text _hintChance;

        private void EnsureHint()
        {
            if (_hint != null) return;
            var go = new GameObject("TargetHint", typeof(RectTransform), typeof(Canvas));
            go.transform.SetParent(transform, false);
            var canvas = go.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 50; // z-index 12020 web: поверх всего
            var panel = new GameObject("Panel", typeof(RectTransform));
            panel.transform.SetParent(go.transform, false);
            _hintRect = (RectTransform)panel.transform;
            _hintRect.anchorMin = _hintRect.anchorMax = Vector2.zero;
            _hintRect.pivot = new Vector2(0f, 1f);
            _hintRect.sizeDelta = new Vector2(170f, 44f);
            // По просьбе игрока: только цифра шанса, без фона и рамки.
            _hintName = PlateText("Name", _hintRect, 12, FontStyle.Bold);
            _hintName.alignment = TextAnchor.MiddleLeft;
            _hintName.color = new Color(0.941f, 0.824f, 0.541f, 1f); // #f0d28a
            _hintName.rectTransform.anchorMin = new Vector2(0f, 0.5f);
            _hintName.rectTransform.anchorMax = new Vector2(1f, 1f);
            _hintName.rectTransform.offsetMin = new Vector2(10f, 0f);
            _hintName.rectTransform.offsetMax = new Vector2(-10f, -4f);
            _hintChance = PlateText("Chance", _hintRect, 11, FontStyle.Bold);
            _hintChance.alignment = TextAnchor.MiddleLeft;
            _hintChance.color = new Color(1f, 0.176f, 0.122f, 1f); // .hit-chance #ff2d1f
            _hintChance.rectTransform.anchorMin = new Vector2(0f, 0f);
            _hintChance.rectTransform.anchorMax = new Vector2(1f, 0.5f);
            _hintChance.rectTransform.offsetMin = new Vector2(10f, 4f);
            _hintChance.rectTransform.offsetMax = new Vector2(-10f, 0f);
            _hint = panel;
            _hint.SetActive(false);
        }

        private void RefreshHint(bool show)
        {
            EnsureHint();
            string label = string.Empty;
            Color color = Color.white;
            bool visible = show && Combat != null
                && Combat.TryGetTargetDisplay(out _, out label, out color);
            if (!visible)
            {
                if (_hint.activeSelf) _hint.SetActive(false);
                return;
            }

            _hint.SetActive(true);
            // Keep the deliberately compact target hint: one value beside the
            // pointer. Invalid shots now explain why instead of looking like 0%.
            _hintName.text = string.Empty;
            _hintChance.text = label;
            _hintChance.color = color;
            _hintChance.fontSize = label.EndsWith("%") ? 16 : 12;
            _hintRect.sizeDelta = new Vector2(label.EndsWith("%") ? 80f : 154f, 44f);
            Vector2 mouse = Input.mousePosition;
            const float pad = 14f;
            float x = Mathf.Min(Screen.width - _hintRect.sizeDelta.x - 8f,
                Mathf.Max(8f, mouse.x + pad));
            float y = Mathf.Max(52f, Mathf.Min(Screen.height - 8f, mouse.y - pad));
            _hintRect.anchoredPosition = new Vector2(x, y);
        }
        private void LateUpdate()
        {
            if (!CanvasDriven) return;
            EnsureCanvas();
            int used = 0;
            bool show = !RoaGameBootstrap.BlocksWorldHud && Player != null && Player.gameObject.activeInHierarchy
                && !(RoaGameBootstrap.Active != null && RoaGameBootstrap.Active.FrontendVisible);
            Camera camera = WorldCamera != null ? WorldCamera : Camera.main;
            if (show && camera != null)
            {
                _entries.Clear();
                bool mobile = RoaGameBootstrap.Active?.MobileControls?.ControlsEnabled == true;
                float maxDistance = Mathf.Min(MaxDistance, mobile ? 14f : 20f);
                Enemies?.CollectNameplates(_entries, Player.transform.position, maxDistance);
                RemotePlayers?.CollectNameplates(_entries, Player.transform.position, maxDistance);
                // Свой персонаж: ник и здоровье над головой, как у остальных игроков.
                if (Hud != null && Hud.HasState)
                    _entries.Add(new Entry
                    {
                        Name = string.IsNullOrEmpty(Hud.Name) ? "Странник" : Hud.Name,
                        Hp = Hud.Hp,
                        MaxHp = Hud.MaxHp,
                        World = Player.transform.position + Vector3.up * 1.07f,
                        IsPlayer = true,
                        IsSelf = true
                    });
                Vector3 origin = Player.transform.position;
                _entries.Sort((a, b) => Vector3.SqrMagnitude(a.World - origin).CompareTo(Vector3.SqrMagnitude(b.World - origin)));
                bool awareness = Socket?.Session?.Self?["talentRanks"]?["awareness"]?.ToObject<int>() > 0;
                _occupied.Clear();
                foreach (Entry entry in _entries)
                {
                    Vector3 screen = camera.WorldToScreenPoint(entry.World);
                    if (screen.z <= 0f || screen.x < 0f || screen.x > Screen.width || screen.y < 0f || screen.y > Screen.height) continue;
                    // Та же раскладка без наложений, что и у IMGUI (координаты сверху вниз).
                    if (!TryResolveScreenRect(new Vector2(screen.x, Screen.height - screen.y), _occupied, Screen.width, Screen.height, out Rect rect))
                        continue;
                    _occupied.Add(rect);

                    Plate plate = AcquirePlate(used++);
                    plate.Root.SetActive(true);
                    float distance = Vector3.Distance(origin, entry.World);
                    Presentation presentation = ResolvePresentation(entry, awareness, distance, maxDistance);
                    plate.Name.gameObject.SetActive(presentation.ShowName);
                    plate.Name.text = presentation.ShowName ? entry.Name : string.Empty;
                    plate.Faction.gameObject.SetActive(presentation.ShowFaction);
                    plate.Faction.text = presentation.ShowFaction ? entry.Faction : string.Empty;
                    plate.Health.gameObject.SetActive(presentation.ShowHealthText);
                    plate.Health.text = presentation.HealthText;
                    float identityWidth = Mathf.Max(
                        presentation.ShowName ? plate.Name.preferredWidth : 0f,
                        presentation.ShowFaction ? plate.Faction.preferredWidth : 0f);
                    float width = presentation.ShowName || presentation.ShowFaction
                        ? Mathf.Max(presentation.Width, identityWidth + 14f)
                        : presentation.Width;
                    plate.Rect.sizeDelta = new Vector2(width, presentation.Height);
                    plate.Rect.anchoredPosition = new Vector2(rect.x + rect.width * 0.5f, Screen.height - rect.yMax);
                    float alpha = presentation.Alpha;
                    Color nameColor = entry.IsPlayer ? NamePlayer : entry.Hostile ? NameHostile : NameInk;
                    plate.Name.color = new Color(nameColor.r, nameColor.g, nameColor.b, alpha);
                    Color factionColor = entry.Hostile ? NameHostile : HealthInk;
                    plate.Faction.color = new Color(factionColor.r, factionColor.g, factionColor.b, alpha);
                    float ratio = entry.Hp / (float)Mathf.Max(1, entry.MaxHp);
                    Color healthColor = ratio <= 0.34f ? HealthCritical : ratio <= 0.72f ? HealthHurt : HealthInk;
                    plate.HealthTrack.color = new Color(0.015f, 0.018f, 0.014f, alpha * 0.86f);
                    plate.HealthFill.color = new Color(healthColor.r, healthColor.g, healthColor.b, alpha);
                    plate.HealthFill.fillAmount = Mathf.Clamp01(ratio);
                    RectTransform trackRect = plate.HealthTrack.rectTransform;
                    trackRect.sizeDelta = new Vector2(presentation.ShowName || presentation.ShowFaction ? 64f : width - 4f,
                        presentation.ShowHealthText ? 11f : 6f);
                    plate.Health.color = new Color(1f, 1f, 0.94f, alpha);
                    RectTransform healthRect = plate.Health.rectTransform;
                    healthRect.anchorMin = healthRect.anchorMax = new Vector2(0.5f, 0f);
                    healthRect.pivot = new Vector2(0.5f, 0f);
                    healthRect.sizeDelta = new Vector2(trackRect.sizeDelta.x, 12f);
                    healthRect.anchoredPosition = Vector2.zero;
                    float rowY = presentation.ShowHealthText ? 12f : 7f;
                    RectTransform factionRect = plate.Faction.rectTransform;
                    factionRect.anchorMin = factionRect.anchorMax = new Vector2(0.5f, 0f);
                    factionRect.pivot = new Vector2(0.5f, 0f);
                    factionRect.sizeDelta = new Vector2(width, 14f);
                    factionRect.anchoredPosition = new Vector2(0f, rowY);
                    RectTransform nameRect = plate.Name.rectTransform;
                    nameRect.anchorMin = nameRect.anchorMax = new Vector2(0.5f, 0f);
                    nameRect.pivot = new Vector2(0.5f, 0f);
                    nameRect.sizeDelta = new Vector2(width, 14f);
                    nameRect.anchoredPosition = new Vector2(0f, rowY + (presentation.ShowFaction ? 14f : 0f));
                }
            }
            for (int i = used; i < _pool.Count; i++) if (_pool[i].Root.activeSelf) _pool[i].Root.SetActive(false);
            RefreshHint(show);
        }

        private void OnGUI()
        {
            if (CanvasDriven) return;
            RoaUiTheme.Apply();
            if (RoaGameBootstrap.BlocksWorldHud) return;
            if (Player == null || !Player.gameObject.activeInHierarchy) return;
            Camera camera = WorldCamera != null ? WorldCamera : Camera.main;
            if (camera == null) return;

            _entries.Clear();
            Enemies?.CollectNameplates(_entries, Player.transform.position, MaxDistance);
            RemotePlayers?.CollectNameplates(_entries, Player.transform.position, MaxDistance);
            _entries.Sort((a, b) => Vector3.SqrMagnitude(a.World - Player.transform.position)
                .CompareTo(Vector3.SqrMagnitude(b.World - Player.transform.position)));
            bool awareness = Socket?.Session?.Self?["talentRanks"]?["awareness"]?.ToObject<int>() > 0;

            EnsureStyles();
            _occupied.Clear();
            foreach (Entry entry in _entries)
            {
                Vector3 screen = camera.WorldToScreenPoint(entry.World);
                if (screen.z <= 0f) continue;
                float x = screen.x;
                float y = Screen.height - screen.y;
                if (x < 0f || x > Screen.width || y < 0f || y > Screen.height) continue;
                if (!TryResolveScreenRect(new Vector2(x, y), _occupied, Screen.width, Screen.height, out Rect rect))
                    continue;
                _occupied.Add(rect);
                float distance = Vector3.Distance(Player.transform.position, entry.World);
                float alpha = Mathf.Lerp(0.48f, 0.92f, 1f - Mathf.Clamp01(distance / MaxDistance));
                Color previous = GUI.color;
                GUI.color = new Color(0.025f, 0.028f, 0.024f, alpha * 0.86f);
                GUI.DrawTexture(rect, Texture2D.whiteTexture);
                Color accent = entry.IsPlayer
                    ? new Color(0.50f, 0.78f, 1f, alpha)
                    : entry.Hostile ? new Color(1f, 0.48f, 0.36f, alpha)
                    : new Color(0.67f, 0.90f, 0.56f, alpha);
                GUI.color = accent;
                GUI.DrawTexture(new Rect(rect.x, rect.y, 2f, rect.height), Texture2D.whiteTexture);
                GUI.color = previous;

                string identity = string.IsNullOrEmpty(entry.Name)
                    ? (entry.IsPlayer ? "Игрок" : entry.Faction)
                    : (string.IsNullOrEmpty(entry.Faction) ? entry.Name : entry.Name + " · " + entry.Faction);
                GUI.Label(new Rect(rect.x + 5f, rect.y + 1f, rect.width - 10f, 17f),
                    string.IsNullOrEmpty(identity) ? "Персонаж" : identity, _nameStyle);
                _healthStyle.normal.textColor = HealthColor(entry.Hp, entry.MaxHp);
                string health = awareness
                    ? Mathf.Max(0, entry.Hp) + "/" + Mathf.Max(1, entry.MaxHp)
                    : HealthState(entry.Hp, entry.MaxHp);
                GUI.Label(new Rect(rect.x + 5f, rect.y + 17f, rect.width - 10f, 14f), health, _healthStyle);
            }
        }

        public static bool TryResolveScreenRect(Vector2 point, IReadOnlyList<Rect> occupied,
                                                int screenWidth, int screenHeight, out Rect resolved)
        {
            const float width = 164f;
            const float height = 46f;
            const float margin = 6f;
            float baseX = Mathf.Clamp(point.x - width * 0.5f, margin,
                                      Mathf.Max(margin, screenWidth - width - margin));
            float baseY = Mathf.Clamp(point.y - height - 8f, margin,
                                      Mathf.Max(margin, screenHeight - height - margin));
            for (int attempt = 0; attempt < 7; attempt++)
            {
                int step = attempt == 0 ? 0 : (attempt + 1) / 2;
                float direction = attempt == 0 || attempt % 2 == 1 ? -1f : 1f;
                float y = Mathf.Clamp(baseY + direction * step * 49f, margin,
                                      Mathf.Max(margin, screenHeight - height - margin));
                var candidate = new Rect(baseX, y, width, height);
                bool overlaps = false;
                for (int i = 0; i < occupied.Count; i++)
                {
                    if (!candidate.Overlaps(occupied[i])) continue;
                    overlaps = true;
                    break;
                }
                if (overlaps) continue;
                resolved = candidate;
                return true;
            }
            resolved = default;
            return false;
        }

        private void EnsureStyles()
        {
            if (_nameStyle != null) return;
            _nameStyle = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontStyle = FontStyle.Bold,
                fontSize = Mathf.Max(11, GUI.skin.label.fontSize - 1),
                clipping = TextClipping.Clip
            };
            _healthStyle = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontSize = Mathf.Max(10, GUI.skin.label.fontSize - 1),
                clipping = TextClipping.Clip
            };
        }

        private static string HealthState(int hp, int maxHp)
        {
            if (hp <= 0) return "при смерти";
            float ratio = hp / (float)Mathf.Max(1, maxHp);
            if (hp >= maxHp || ratio >= 0.995f) return "здоров";
            if (ratio >= 0.8f) return "лёгкое ранение";
            if (ratio >= 0.5f) return "ранен";
            if (ratio >= 0.3f) return "сильное ранение";
            if (ratio >= 0.1f) return "критическое ранение";
            return "при смерти";
        }

        private static string CompactHealthState(int hp, int maxHp)
        {
            if (hp <= 0) return "при смерти";
            float ratio = hp / (float)Mathf.Max(1, maxHp);
            if (ratio >= 0.995f) return string.Empty;
            if (ratio >= 0.8f) return "царапина";
            if (ratio >= 0.5f) return "ранен";
            if (ratio >= 0.3f) return "тяжело";
            if (ratio >= 0.1f) return "критично";
            return "при смерти";
        }

        private static Color HealthColor(int hp, int maxHp)
        {
            float ratio = hp / (float)Mathf.Max(1, maxHp);
            if (ratio <= 0.34f) return new Color(1f, 0.46f, 0.38f);
            if (ratio <= 0.72f) return new Color(1f, 0.78f, 0.35f);
            return new Color(0.82f, 1f, 0.76f);
        }
    }
}
