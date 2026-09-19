using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Один простой цикл: предупреждение о Сдвиге, сигнал отдельного детектора,
    /// проявление артефакта вблизи и серверный подбор. Аномалии сюда намеренно
    /// не передаются — они всегда читаются собственным рендерером.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaKromkaShiftAndDetector : MonoBehaviour
    {
        private sealed class ArtifactView
        {
            public string Id;
            public GameObject Root;
            public float Signal;
            public bool Revealed;
            public bool Trace;
            public float TraceUntil;
            public string ModelId;
            // Предварительное определение до подбора: тир приходит с Mk2,
            // вид с названием — только с Mk3. Клиент их только показывает.
            public int Tier;
            public string TierColor;
            public string DisplayName;
            public GameObject Model;
            public int ModelRequest;
            public bool ModelLoading;
            public float ModelRetryAt;
        }

        private readonly Dictionary<string, ArtifactView> _views = new Dictionary<string, ArtifactView>();
        private RoaGameBootstrap _bootstrap;
        private RoaSocketClient _socket;
        private AudioSource _audio;
        private AudioClip _beep;
        private Canvas _canvas;
        private Image _shiftPanel;
        private Text _shiftText;
        private string _roomId = string.Empty;
        private string _nearestRevealedId = string.Empty;
        private float _nextBeepAt;
        private float _strongestSignal;
        private string _shiftPhase = "calm";
        private bool _sheltered;
        private bool _hasDetector;
        private LineRenderer _shiftWave;
        private float _shiftWaveStartedAt = -10f;
        private Material _artifactRingMaterial;

        public void Configure(RoaGameBootstrap bootstrap, RoaSocketClient socket)
        {
            _bootstrap = bootstrap;
            if (_socket != null) Unsubscribe();
            _socket = socket;
            BuildAudio();
            BuildUi();
            Subscribe();
        }

        private void OnDestroy()
        {
            Unsubscribe();
            foreach (ArtifactView view in _views.Values) if (view.Root != null) Destroy(view.Root);
            _views.Clear();
            if (_artifactRingMaterial != null) Destroy(_artifactRingMaterial);
        }

        private void Subscribe()
        {
            if (_socket == null) return;
            _socket.OnArtifactState += ApplyArtifactState;
            _socket.OnAuthoritativeSelf += ApplySelf;
            _socket.OnJoined += HandleJoined;
        }

        private void Unsubscribe()
        {
            if (_socket == null) return;
            _socket.OnArtifactState -= ApplyArtifactState;
            _socket.OnAuthoritativeSelf -= ApplySelf;
            _socket.OnJoined -= HandleJoined;
        }

        private void HandleJoined(JoinAck ack)
        {
            _roomId = ack?.RoomId ?? string.Empty;
            ClearViews();
            if (ack?.Self != null) ApplySelf(ack.Self);
            ApplyShift(ack?.WorldState?["shift"] as JObject);
            RequestState();
        }

        private void RequestState()
        {
            if (_socket == null || _socket.Phase != RoaSocketClient.ConnectionPhase.Joined || string.IsNullOrEmpty(_roomId)) return;
            _socket.EmitWithAck("requestArtifactState", new Dictionary<string, object>(), ack =>
            {
                JObject state = ack?["state"] as JObject;
                if (state != null) ApplyArtifactState(state);
            });
        }

        private void ApplySelf(JObject self)
        {
            JObject equipment = self?["equipment"] as JObject;
            _hasDetector = !string.IsNullOrEmpty(equipment?["detector"]?.ToString());
            // Пояс и находки живут в ПУТНИКе: там их видно, стабилизируют и
            // ставят на пояс. Здесь остаётся только детектор в мире.
            if (!_hasDetector) ClearViews();
        }







        private void ApplyArtifactState(JObject state)
        {
            if (state == null) return;
            string roomId = state["roomId"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(_roomId) && roomId != _roomId) return;
            _roomId = roomId;
            _hasDetector = state["detector"] is JObject;
            ApplyShift(state["shift"] as JObject);

            var present = new HashSet<string>();
            _strongestSignal = 0f;
            _nearestRevealedId = string.Empty;
            if (state["artifacts"] is JArray artifacts)
            {
                foreach (JToken token in artifacts)
                {
                    if (!(token is JObject row)) continue;
                    string id = row["id"]?.ToString();
                    if (string.IsNullOrEmpty(id)) continue;
                    present.Add(id);
                    float signal = Mathf.Clamp01(Value(row, "signal"));
                    bool revealed = row["revealed"]?.Value<bool>() == true;
                    _strongestSignal = Mathf.Max(_strongestSignal, signal);
                    ArtifactView view;
                    if (!_views.TryGetValue(id, out view))
                    {
                        view = new ArtifactView { Id = id };
                        _views[id] = view;
                    }
                    view.Signal = signal;
                    view.Revealed = revealed;
                    view.Trace = row["trace"]?.Value<bool>() == true;
                    view.Tier = row["tier"]?.Value<int>() ?? 0;
                    view.TierColor = row["tierColor"]?.ToString() ?? string.Empty;
                    view.DisplayName = row["displayName"]?.ToString() ?? string.Empty;
                    view.TraceUntil = Time.unscaledTime + Value(row, "traceSeconds");
                    if (revealed && row["x"] != null && row["z"] != null)
                    {
                        if (view.Root == null) view.Root = CreateArtifactView(id);
                        view.Root.transform.position = RoaCoords.ToUnity(Value(row, "x"), Value(row, "z")) + Vector3.up * 0.42f;
                        view.Root.SetActive(true);
                        SetArtifactModel(view, RoaItemModelCatalog.ArtifactItemId(row["typeId"]?.ToString()));
                        if (!view.Trace && (string.IsNullOrEmpty(_nearestRevealedId) || signal > _views[_nearestRevealedId].Signal))
                            _nearestRevealedId = id;
                    }
                    else if (view.Root != null) view.Root.SetActive(false);
                }
            }
            foreach (string id in new List<string>(_views.Keys))
            {
                if (present.Contains(id)) continue;
                if (_views[id].Root != null) Destroy(_views[id].Root);
                _views.Remove(id);
            }
        }

        /// <summary>
        /// Строка панели сдвига. После выброса поля какое-то время рождают
        /// артефакты чаще обычного — сервер присылает и остаток окна, и во
        /// сколько раз сейчас выше шанс; без этого игрок не знал, что именно
        /// сейчас стоит обходить аномалии с детектором.
        /// </summary>
        public static string ShiftLine(JObject shift)
        {
            if (shift == null) return string.Empty;
            string phase = shift["phase"]?.ToString() ?? "calm";
            bool excited = shift["fieldsExcited"]?.Value<bool>() == true;
            // Радист и разведчик базы (или клановая база) предупреждают о сдвиге
            // раньше: без этой строки их вклад был невидим.
            bool early = shift["earlyWarning"]?.Value<bool>() == true;
            if (phase == "calm" && !excited && !early) return string.Empty;
            bool sheltered = shift["sheltered"]?.Value<bool>() == true;
            long remainingMs = shift["remainingMs"]?.Value<long>() ?? 0;
            int strength = shift["strength"]?.Value<int>() ?? 1;
            var sb = new StringBuilder();
            if (phase == "calm" && early)
            {
                long untilShift = (shift["nextShiftAt"]?.Value<long>() ?? 0L) - (shift["serverNow"]?.Value<long>() ?? 0L);
                sb.Append("СДВИГ СКОРО  •  через ").Append(Mathf.Max(1, Mathf.CeilToInt(untilShift / 60000f)))
                  .Append(" мин  •  ранний прогноз");
            }
            if (phase != "calm")
            {
                string title = phase == "warning" ? "СДВИГ ПРИБЛИЖАЕТСЯ"
                    : phase == "active" ? "СДВИГ ИДЁТ"
                    : "СВЕЖИЕ ПЯТНА";
                sb.Append(title).Append("  •  сила ").Append(strength).Append("  •  ")
                  .Append(Mathf.CeilToInt(remainingMs / 1000f)).Append(" с");
                if (sheltered) sb.Append("  •  УКРЫТИЕ");
                else if (phase == "active") sb.Append("  •  ИЩИТЕ УКРЫТИЕ");
            }
            if (excited)
            {
                if (sb.Length > 0) sb.Append("  •  ");
                int minutes = Mathf.Max(1, Mathf.CeilToInt((shift["fieldsExcitedSeconds"]?.Value<int>() ?? 0) / 60f));
                sb.Append("ПОЛЯ АКТИВНЫ: ещё ").Append(minutes).Append(" мин");
                float multiplier = shift["fieldsChanceMultiplier"]?.Value<float>() ?? 0f;
                if (multiplier > 1.05f) sb.Append(" (находки ×").Append(multiplier.ToString("0.#")).Append(')');
            }
            return sb.ToString();
        }

        private void ApplyShift(JObject shift)
        {
            if (shift == null) return;
            string previous = _shiftPhase;
            _shiftPhase = shift["phase"]?.ToString() ?? "calm";
            _sheltered = shift["sheltered"]?.Value<bool>() == true;
            if (_shiftPanel != null)
            {
                string line = ShiftLine(shift);
                bool visible = !string.IsNullOrEmpty(line);
                _shiftPanel.gameObject.SetActive(visible);
                if (visible)
                {
                    _shiftText.text = line;
                    _shiftPanel.color = _shiftPhase == "active"
                        ? new Color(0.48f, 0.08f, 0.12f, 0.92f)
                        : new Color(0.42f, 0.28f, 0.08f, 0.9f);
                }
            }
            if (previous != "active" && _shiftPhase == "active") StartShiftWave();
        }

        private void Update()
        {
            if (_hasDetector && _strongestSignal > 0.001f && Time.unscaledTime >= _nextBeepAt)
            {
                _nextBeepAt = Time.unscaledTime + Mathf.Lerp(1.35f, 0.16f, _strongestSignal);
                if (_audio != null && _beep != null)
                {
                    _audio.pitch = Mathf.Lerp(0.78f, 1.55f, _strongestSignal);
                    _audio.PlayOneShot(_beep, Mathf.Lerp(0.15f, 0.5f, _strongestSignal));
                }
            }
            foreach (ArtifactView view in _views.Values)
            {
                if (view.Root == null || !view.Root.activeSelf) continue;
                if (view.Trace && Time.unscaledTime >= view.TraceUntil) { view.Root.SetActive(false); continue; }
                if (view.Model == null && !view.ModelLoading && Time.unscaledTime >= view.ModelRetryAt)
                    SetArtifactModel(view, view.ModelId);
                float pulse = 1f + Mathf.Sin(Time.time * 5.2f + view.Signal * 4f) * 0.04f;
                view.Root.transform.localScale = Vector3.one * pulse * (view.Trace ? 0.65f : 1f);
                view.Root.transform.Rotate(Vector3.up, 28f * Time.deltaTime, Space.World);
            }
            if (_shiftWave != null && _shiftWave.gameObject.activeSelf)
            {
                float t = (Time.unscaledTime - _shiftWaveStartedAt) / 2.4f;
                if (t >= 1f) _shiftWave.gameObject.SetActive(false);
                else
                {
                    float radius = Mathf.Lerp(1f, 22f, t);
                    for (int i = 0; i < _shiftWave.positionCount; i++)
                    {
                        float angle = i / (float)(_shiftWave.positionCount - 1) * Mathf.PI * 2f;
                        _shiftWave.SetPosition(i, new Vector3(Mathf.Cos(angle) * radius, 0.16f, Mathf.Sin(angle) * radius));
                    }
                    Color color = new Color(0.5f, 0.85f, 1f, 1f - t);
                    _shiftWave.startColor = color;
                    _shiftWave.endColor = color;
                    Transform player = _bootstrap?.PlayerView?.transform;
                    if (player != null) _shiftWave.transform.position = player.position;
                }
            }
            if (Input.GetKeyDown(KeyCode.G) && !string.IsNullOrEmpty(_nearestRevealedId)) PickupNearest();
        }



        /// <summary>
        /// Подсказка подбора для HUD: что именно лежит под ногами. Mk2 называет
        /// тир, Mk3 — ещё и вид; Mk1 говорит только «находка». Постоянной
        /// панели детектора в клиенте нет, поэтому предварительное определение
        /// игрок видит здесь — в той же строке, которой поднимает находку.
        /// </summary>
        public string PickupHint
        {
            get
            {
                if (string.IsNullOrEmpty(_nearestRevealedId) || !_views.ContainsKey(_nearestRevealedId)) return string.Empty;
                ArtifactView view = _views[_nearestRevealedId];
                return PickupHintText("G", view.Tier, view.TierColor, view.DisplayName);
            }
        }

        /// <summary>Строка подсказки подбора: «G — забрать: Жила · Т4».</summary>
        public static string PickupHintText(string key, int tier, string tierColor, string displayName)
        {
            var sb = new StringBuilder(string.IsNullOrEmpty(key) ? "G" : key).Append(" — забрать");
            if (!string.IsNullOrEmpty(displayName)) sb.Append(": ").Append(displayName);
            else sb.Append(" находку");
            if (tier >= 1 && tier <= 5)
            {
                string hex = string.IsNullOrEmpty(tierColor)
                    ? ColorUtility.ToHtmlStringRGB(RoaGearData.TierTint(tier))
                    : tierColor.TrimStart('#');
                sb.Append(" · <color=#").Append(hex).Append('>').Append(RoaGearData.TierShortLabel(tier)).Append("</color>");
            }
            return sb.ToString();
        }

        /// <summary>Последний отказ сервера на подбор: HUD показывает его в журнале.</summary>
        public string PickupFailed { get; private set; } = string.Empty;

        /// <summary>Журнал забрал сообщение: больше его показывать не нужно.</summary>
        public string ConsumePickupFailure()
        {
            string message = PickupFailed;
            PickupFailed = string.Empty;
            return message;
        }

        /// <summary>Рядом лежит проявленный артефакт, который можно поднять.</summary>
        public bool HasRevealedArtifactInRange
        {
            get { return !string.IsNullOrEmpty(_nearestRevealedId); }
        }

        /// <summary>
        /// Поднимает ближайшую находку: клавишей G на ПК и кнопкой взаимодействия на
        /// телефоне, где клавиши G нет вовсе.
        /// </summary>
        public bool TryPickupRevealedArtifact()
        {
            if (!HasRevealedArtifactInRange) return false;
            PickupNearest();
            return true;
        }

        private void PickupNearest()
        {
            string id = _nearestRevealedId;
            if (string.IsNullOrEmpty(id) || _socket == null) return;
            _socket.EmitWithAck("pickupArtifact", new Dictionary<string, object> { ["artifactId"] = id }, ack =>
            {
                if (ack?["ok"]?.Value<bool>() == true)
                {
                    if (ack["self"] is JObject self) ApplySelf(self);
                    RequestState();
                }
                // Отказ уходит в системный журнал HUD: отдельной панели
                // детектора в клиенте нет.
                else PickupFailed = ack?["error"]?.ToString() ?? "Артефакт не поднят";
            });
        }

        private GameObject CreateArtifactView(string id)
        {
            GameObject root = new GameObject("RevealedArtifact:" + id);
            Color glow = new Color(0.45f, 0.88f, 1f, 1f);
            var ring = root.AddComponent<LineRenderer>();
            ring.useWorldSpace = false;
            ring.loop = true;
            ring.positionCount = 25;
            ring.startWidth = ring.endWidth = 0.035f;
            if (_artifactRingMaterial == null)
                _artifactRingMaterial = new Material(Shader.Find("Sprites/Default")) { name = "ArtifactDetectionRing" };
            ring.sharedMaterial = _artifactRingMaterial;
            ring.startColor = ring.endColor = glow;
            for (int i = 0; i < ring.positionCount; i++)
            {
                float angle = i / (float)ring.positionCount * Mathf.PI * 2f;
                ring.SetPosition(i, new Vector3(Mathf.Cos(angle) * 0.65f, -0.3f, Mathf.Sin(angle) * 0.65f));
            }
            return root;
        }

        private void SetArtifactModel(ArtifactView view, string modelId)
        {
            if (view.Root == null || string.IsNullOrEmpty(modelId)) return;
            if (view.ModelId != modelId)
            {
                view.ModelRequest++;
                view.ModelId = modelId;
                view.ModelLoading = false;
                view.ModelRetryAt = 0f;
                // Hide synchronously: a downgraded detector must not retain the identified shape.
                if (view.Model != null) { view.Model.SetActive(false); Destroy(view.Model); }
                view.Model = null;
            }
            if (view.Model != null || view.ModelLoading || Time.unscaledTime < view.ModelRetryAt) return;
            view.ModelLoading = true;
            _ = LoadArtifactModel(view, modelId, view.ModelRequest);
        }

        private async Task LoadArtifactModel(ArtifactView view, string modelId, int request)
        {
            GameObject model = await RoaItemModelCatalog.InstantiateInactive(
                _socket != null ? _socket.ServerOrigin : string.Empty, modelId, view.Root.transform);
            bool current = this != null && view.Root != null && view.ModelRequest == request
                && _views.TryGetValue(view.Id, out ArtifactView live) && ReferenceEquals(live, view);
            if (!current)
            {
                if (model != null) Destroy(model);
                return;
            }
            view.ModelLoading = false;
            if (model == null) { view.ModelRetryAt = Time.unscaledTime + 5f; return; }
            view.Model = model;
            model.SetActive(true);
        }

        private void StartShiftWave()
        {
            if (_shiftWave == null)
            {
                GameObject wave = new GameObject("KromkaShiftWave");
                _shiftWave = wave.AddComponent<LineRenderer>();
                _shiftWave.useWorldSpace = false;
                _shiftWave.loop = true;
                _shiftWave.positionCount = 49;
                _shiftWave.startWidth = _shiftWave.endWidth = 0.18f;
                _shiftWave.material = new Material(Shader.Find("Sprites/Default"));
            }
            _shiftWave.gameObject.SetActive(true);
            _shiftWaveStartedAt = Time.unscaledTime;
        }

        private void ClearViews()
        {
            foreach (ArtifactView view in _views.Values) if (view.Root != null) Destroy(view.Root);
            _views.Clear();
            _nearestRevealedId = string.Empty;
            _strongestSignal = 0f;
        }

        private void BuildAudio()
        {
            if (_audio == null) _audio = gameObject.AddComponent<AudioSource>();
            _audio.playOnAwake = false;
            _audio.spatialBlend = 0f;
            if (_beep != null) return;
            const int sampleRate = 22050;
            const int sampleCount = 1323;
            float[] samples = new float[sampleCount];
            for (int i = 0; i < samples.Length; i++)
            {
                float t = i / (float)sampleRate;
                float envelope = Mathf.Clamp01(1f - t / 0.06f);
                samples[i] = Mathf.Sin(t * Mathf.PI * 2f * 820f) * envelope * 0.35f;
            }
            _beep = AudioClip.Create("ArtifactDetectorBeep", sampleCount, 1, sampleRate, false);
            _beep.SetData(samples, 0);
        }

        private void BuildUi()
        {
            if (_canvas != null) return;
            GameObject canvasObject = new GameObject("KromkaShiftCanvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasObject.transform.SetParent(transform, false);
            _canvas = canvasObject.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 235;
            CanvasScaler scaler = canvasObject.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1600f, 900f);
            scaler.matchWidthOrHeight = 0.5f;

            _shiftPanel = Panel(canvasObject.transform, "ShiftWarning", new Vector2(0.5f, 1f), new Vector2(0f, -18f), new Vector2(620f, 48f), new Color(0.42f, 0.28f, 0.08f, 0.9f));
            _shiftText = Label(_shiftPanel.transform, "ShiftText", 20, TextAnchor.MiddleCenter, Color.white);
            Stretch(_shiftText.rectTransform, 12f);
            _shiftPanel.gameObject.SetActive(false);

            // Detector signal is communicated by sound and the revealed object in
            // the world. Equipment and the artifact belt live in the inventory;
            // no permanent detector bar or artifact button covers gameplay.
        }






        private static string Percent(JObject row, string key) => Signed(Value(row, key) * 100f) + "%";
        private static string Signed(float value) => value > 0.005f ? "+" + value.ToString("0.#") : value.ToString("0.#");
        private static float Value(JObject row, string key) => row?[key]?.Value<float>() ?? 0f;

        private static Image Panel(Transform parent, string name, Vector2 anchor, Vector2 position, Vector2 size, Color color)
        {
            GameObject go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            RectTransform rect = go.GetComponent<RectTransform>();
            rect.anchorMin = rect.anchorMax = anchor;
            rect.pivot = anchor;
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            Image image = go.GetComponent<Image>();
            image.color = color;
            return image;
        }

        private static Text Label(Transform parent, string name, int size, TextAnchor alignment, Color color)
        {
            GameObject go = new GameObject(name, typeof(RectTransform), typeof(Text));
            go.transform.SetParent(parent, false);
            Text text = go.GetComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = size;
            text.alignment = alignment;
            text.color = color;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            return text;
        }

        private static Button Button(Transform parent, string name, Vector2 anchor, Vector2 position, Vector2 size, out Text label)
        {
            Image image = Panel(parent, name, anchor, position, size, new Color(0.12f, 0.28f, 0.27f, 0.98f));
            Button button = image.gameObject.AddComponent<Button>();
            label = Label(image.transform, "Label", 14, TextAnchor.MiddleCenter, Color.white);
            Stretch(label.rectTransform, 2f);
            return button;
        }

        private static void Stretch(RectTransform rect, float inset)
        {
            rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(inset, inset); rect.offsetMax = new Vector2(-inset, -inset);
        }
    }
}
