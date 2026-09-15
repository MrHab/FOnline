using System;
using System.Collections.Generic;
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
        private Text _detectorText;
        private Image _signalFill;
        private Button _pickupButton;
        private Text _pickupLabel;
        private GameObject _effectsPanel;
        private Text _effectsText;
        private Text _artifactRecordText;
        private Button _stabilizeButton;
        private Text _stabilizeLabel;
        private Button _equipButton;
        private Text _equipLabel;
        private JArray _artifactRecords = new JArray();
        private readonly HashSet<string> _artifactSlots = new HashSet<string>();
        private int _artifactBeltCapacity;
        private int _selectedArtifactIndex;
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
            JObject effects = self?["artifactEffects"] as JObject;
            if (_effectsText != null) _effectsText.text = FormatEffects(effects);
            _artifactRecords = self?["artifactRecords"] is JArray records ? (JArray)records.DeepClone() : new JArray();
            _artifactSlots.Clear();
            foreach (JToken slot in self?["artifactSlots"] as JArray ?? new JArray())
            {
                string id = slot?.ToString();
                if (!string.IsNullOrEmpty(id)) _artifactSlots.Add(id);
            }
            _artifactBeltCapacity = Mathf.Max(0, self?["artifactBeltCapacity"]?.Value<int>() ?? 0);
            if (_artifactRecords.Count == 0) _selectedArtifactIndex = 0;
            else _selectedArtifactIndex = Mathf.Clamp(_selectedArtifactIndex, 0, _artifactRecords.Count - 1);
            RefreshArtifactControls();
            if (!_hasDetector) ClearViews();
        }

        private void SelectArtifact(int direction)
        {
            if (_artifactRecords.Count == 0) return;
            _selectedArtifactIndex = (_selectedArtifactIndex + direction + _artifactRecords.Count) % _artifactRecords.Count;
            RefreshArtifactControls();
        }

        private JObject SelectedArtifact()
        {
            if (_artifactRecords.Count == 0 || _selectedArtifactIndex < 0 || _selectedArtifactIndex >= _artifactRecords.Count) return null;
            return _artifactRecords[_selectedArtifactIndex] as JObject;
        }

        private void StabilizeSelectedArtifact()
        {
            JObject record = SelectedArtifact();
            string recordId = record?["id"]?.ToString();
            if (string.IsNullOrEmpty(recordId) || _socket == null) return;
            _socket.EmitWithAck("stabilizeArtifact", new Dictionary<string, object> { ["recordId"] = recordId }, HandleArtifactActionAck);
        }

        private void ToggleSelectedArtifact()
        {
            JObject record = SelectedArtifact();
            string recordId = record?["id"]?.ToString();
            if (string.IsNullOrEmpty(recordId) || _socket == null) return;
            bool equipped = _artifactSlots.Contains(recordId);
            _socket.EmitWithAck("artifactLoadoutAction", new Dictionary<string, object>
            {
                ["action"] = equipped ? "unequip" : "equip",
                ["recordId"] = recordId,
                ["slotIndex"] = Mathf.Clamp(_artifactSlots.Count, 0, Mathf.Max(0, _artifactBeltCapacity - 1))
            }, HandleArtifactActionAck);
        }

        private void HandleArtifactActionAck(JObject ack)
        {
            if (ack?["ok"]?.Value<bool>() == true && ack["self"] is JObject self) ApplySelf(self);
            else if (_artifactRecordText != null) _artifactRecordText.text = ack?["error"]?.ToString() ?? "Операция с артефактом отклонена.";
        }

        private void RefreshArtifactControls()
        {
            if (_artifactRecordText == null || _stabilizeButton == null || _equipButton == null) return;
            JObject record = SelectedArtifact();
            if (record == null)
            {
                _artifactRecordText.text = "НАХОДКИ\nКонтейнер пуст.";
                _stabilizeButton.gameObject.SetActive(false);
                _equipButton.gameObject.SetActive(false);
                return;
            }
            string id = record["id"]?.ToString() ?? string.Empty;
            string typeId = record["typeId"]?.ToString() ?? "unknown";
            bool hot = record["hot"]?.Value<bool>() == true;
            bool stabilized = record["stabilized"]?.Value<bool>() == true && !hot;
            bool equipped = _artifactSlots.Contains(id);
            _artifactRecordText.text = $"НАХОДКА {_selectedArtifactIndex + 1}/{_artifactRecords.Count}\n{ArtifactDisplayName(typeId)}"
                + $" · {(hot ? "ГОРЯЧИЙ" : stabilized ? "СТАБИЛЬНЫЙ" : "НЕСТАБИЛЬНЫЙ")}" 
                + (equipped ? " · НА ПОЯСЕ" : string.Empty)
                + $"\nПояс: {_artifactSlots.Count}/{_artifactBeltCapacity}";
            _stabilizeButton.gameObject.SetActive(!stabilized);
            _stabilizeLabel.text = "СТАБИЛИЗИРОВАТЬ";
            _equipButton.gameObject.SetActive(stabilized);
            _equipButton.interactable = equipped || _artifactSlots.Count < _artifactBeltCapacity;
            _equipLabel.text = equipped ? "СНЯТЬ С ПОЯСА" : (_artifactSlots.Count >= _artifactBeltCapacity ? "ПОЯС ПОЛОН" : "УСТАНОВИТЬ");
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
            UpdateDetectorUi();
        }

        private void ApplyShift(JObject shift)
        {
            if (shift == null) return;
            string previous = _shiftPhase;
            _shiftPhase = shift["phase"]?.ToString() ?? "calm";
            _sheltered = shift["sheltered"]?.Value<bool>() == true;
            long remainingMs = shift["remainingMs"]?.Value<long>() ?? 0;
            int strength = shift["strength"]?.Value<int>() ?? 1;
            if (_shiftPanel != null)
            {
                bool visible = _shiftPhase != "calm";
                _shiftPanel.gameObject.SetActive(visible);
                if (visible)
                {
                    string title = _shiftPhase == "warning" ? "СДВИГ ПРИБЛИЖАЕТСЯ"
                        : _shiftPhase == "active" ? "СДВИГ ИДЁТ"
                        : "СВЕЖИЕ ПЯТНА";
                    _shiftText.text = $"{title}  •  сила {strength}  •  {Mathf.CeilToInt(remainingMs / 1000f)} с"
                        + (_sheltered ? "  •  УКРЫТИЕ" : (_shiftPhase == "active" ? "  •  ИЩИТЕ УКРЫТИЕ" : string.Empty));
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

        private void UpdateDetectorUi()
        {
            if (_detectorText == null || _signalFill == null || _pickupButton == null) return;
            _detectorText.text = !_hasDetector ? "ДЕТЕКТОР: слот пуст"
                : _strongestSignal <= 0.001f ? "ДЕТЕКТОР: тихо"
                : $"ДЕТЕКТОР: сигнал {Mathf.RoundToInt(_strongestSignal * 100f)}%";
            _signalFill.fillAmount = _hasDetector ? _strongestSignal : 0f;
            bool canPickup = !string.IsNullOrEmpty(_nearestRevealedId);
            _pickupButton.gameObject.SetActive(canPickup);
            if (canPickup) _pickupLabel.text = "ЗАБРАТЬ [G]";
        }

        /// <summary>Рядом лежит проявленный артефакт, который можно поднять.</summary>
        public bool HasRevealedArtifactInRange
        {
            get { return !string.IsNullOrEmpty(_nearestRevealedId); }
        }

        /// <summary>
        /// Поднимает ближайшую находку. Нужен и кнопке взаимодействия на телефоне, где
        /// клавиши G нет вовсе, и клавише G на ПК, где она иначе спорит с выходом на
        /// глобальную карту.
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
                else if (_detectorText != null) _detectorText.text = ack?["error"]?.ToString() ?? "Артефакт не поднят";
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
            UpdateDetectorUi();
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

        private static string FormatEffects(JObject effects)
        {
            if (effects == null) return "ПОЯС-КОНТЕЙНЕР\nНет активных артефактов.";
            int count = (effects["artifactTypeIds"] as JArray)?.Count ?? 0;
            if (count == 0) return "ПОЯС-КОНТЕЙНЕР\nНет активных артефактов.\n\nСтабилизируйте находку и установите её на пояс.";
            return "ИТОГ ЭФФЕКТОВ\n"
                + $"Артефактов: {count}\n"
                + $"Скорость: {Percent(effects, "speedPct")}\n"
                + $"Восстановление ОД: {Percent(effects, "apRegenPct")}\n"
                + $"Груз: {Signed(Value(effects, "carryKg"))} кг\n"
                + $"Макс. здоровье: {Signed(Value(effects, "maxHpFlat"))}\n"
                + $"Регенерация: {Value(effects, "regenHpPerSecond"):0.0} HP/с\n"
                + $"Ближний урон: {Percent(effects, "meleeDamagePct")}\n\n"
                + "Бонусы и штрафы уже учтены сервером.";
        }

        private static string ArtifactDisplayName(string typeId)
        {
            switch (typeId)
            {
                case "spring": return "Пружина";
                case "vein": return "Жила";
                case "node": return "Узел";
                case "drop": return "Капля";
                case "bloodkin": return "Кровник";
                case "shell": return "Панцирь";
                case "warmer": return "Тепляк";
                case "sieve": return "Сито";
                case "thunderer": return "Громник";
                case "husher": return "Молчун";
                case "anchor": return "Якорь";
                case "dew": return "Роса";
                case "memory": return "Память";
                default: return string.IsNullOrEmpty(typeId) ? "Неизвестный артефакт" : typeId;
            }
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
