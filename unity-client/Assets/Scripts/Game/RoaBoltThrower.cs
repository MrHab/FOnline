using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// A permanent mercenary tool: B enters throw mode, a ground click chooses the
    /// endpoint, and the server decides trajectory, range, obstruction and anomaly hit.
    /// No bolt item is consumed. The magnetic upgrade is also decided by server state.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaBoltThrower : MonoBehaviour
    {
        public const float RegularRangeMeters = 10f;
        private const float LocalCooldownSeconds = 0.75f;
        private const float ReleaseDelaySeconds = 0.08f;
        private const float FallbackHandHeight = 0.88f;
        private const float FallbackHandSide = 0.22f;
        private const float FallbackHandForward = 0.12f;
        private RoaSocketClient _socket;
        private Camera _camera;
        private RoaMobileControls _mobileControls;
        private Material _material;
        private Text _hint;
        private float _nextThrowAt;
        private float _statusUntil;
        private bool _pending;
        private bool _aiming;
        private bool _retiredAimIndicatorChecked;
        private Vector3 _target;

        public bool IsAiming { get { return _aiming; } }
        public bool Pending { get { return _pending; } }
        public string StatusText { get; private set; } = string.Empty;
        public float ThrowRangeMeters => Mathf.Clamp(_socket?.Session?.Self?["boltRangeMeters"]?.Value<float?>() ?? RegularRangeMeters, 1f, 60f);

        private void OnEnable()
        {
            RemoveRetiredAimIndicator();
        }

        public void Configure(RoaSocketClient socket, Camera worldCamera, RoaMobileControls mobileControls)
        {
            if (_socket != null) _socket.OnBoltThrown -= HandleBoltThrown;
            _socket = socket;
            _camera = worldCamera;
            _mobileControls = mobileControls;
            if (_socket != null) _socket.OnBoltThrown += HandleBoltThrown;
            RemoveRetiredAimIndicator();
            EnsurePresentation();
        }

        public void ToggleAim()
        {
            if (!CanThrow())
            {
                ShowStatus("Болт можно бросать только в локальной игровой зоне.", 2.2f);
                return;
            }
            _aiming = !_aiming;
            UpdateHint();
        }

        public void CancelAim()
        {
            _aiming = false;
            UpdateHint();
        }

        private void Update()
        {
            if (!_retiredAimIndicatorChecked)
            {
                _retiredAimIndicatorChecked = true;
                RemoveRetiredAimIndicator();
            }
            if (_camera == null) _camera = Camera.main;
            if (Input.GetKeyDown(KeyCode.B)) ToggleAim();
            if (Input.GetKeyDown(KeyCode.Escape) && _aiming) CancelAim();

            bool quickThrow = Input.GetMouseButtonDown(2);
            if ((_aiming || quickThrow) && CanThrow() && TryReadGroundTarget(out Vector3 rawTarget))
            {
                Vector3 playerPosition = PlayerPosition();
                _target = ClampToRange(playerPosition, rawTarget, ThrowRangeMeters);
                bool select = Input.GetMouseButtonDown(0) && !PointerOverUi();
                if ((quickThrow || select) && !_pending && Time.realtimeSinceStartup >= _nextThrowAt)
                    ThrowAt(_target);
            }
            else if (_aiming && !CanThrow()) CancelAim();

            if (!_aiming && Time.realtimeSinceStartup >= _statusUntil && _hint != null)
                _hint.gameObject.SetActive(false);
        }

        private void ThrowAt(Vector3 target)
        {
            _pending = true;
            _nextThrowAt = Time.realtimeSinceStartup + LocalCooldownSeconds;
            _aiming = false;
            ShowStatus("Бросок...", 1.2f);
            RoaCoords.ToServer(target, out float serverX, out float serverZ);
            _socket.EmitWithAck("throwBolt", new Dictionary<string, object>
            {
                ["x"] = serverX,
                ["z"] = serverZ
            }, ack =>
            {
                _pending = false;
                bool ok = ack?["ok"]?.Value<bool?>() == true;
                if (!ok)
                {
                    ShowStatus(ack?["error"]?.ToString() ?? "Сервер отклонил бросок.", 2.8f);
                    return;
                }
                if (ack?["anomalies"] is JObject anomalies)
                    RoaGameBootstrap.Active?.Anomalies?.ApplyAnomalyState(anomalies);
                if (ack?["hit"]?.Value<bool?>() == true)
                {
                    string name = ack?["anomaly"]?["displayName"]?.ToString() ?? "Аномалия";
                    long until = ack?["anomaly"]?["dischargedUntil"]?.Value<long?>() ?? 0L;
                    long now = ack?["anomalies"]?["serverNow"]?.Value<long?>() ?? System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    int seconds = Mathf.Max(1, Mathf.CeilToInt((until - now) / 1000f));
                    ShowStatus(ack?["anomaly"]?["permanentlyDischarged"]?.Value<bool?>() == true
                        ? name + " разряжена навсегда."
                        : name + " разряжена примерно на " + seconds + " с.", 2.8f);
                }
                else ShowStatus("Болт звякнул о землю. Аномалия не сработала.", 2.1f);
            });
        }

        private void HandleBoltThrown(JObject payload)
        {
            if (payload == null) return;
            Vector3 serverFrom = RoaCoords.ToUnity(Value(payload["from"] as JObject, "x"),
                Value(payload["from"] as JObject, "z"));
            Vector3 to = RoaCoords.ToUnity(Value(payload["to"] as JObject, "x"),
                Value(payload["to"] as JObject, "z"));
            if (payload["anomaly"]?["contact"] is JObject contact)
                to = RoaCoords.ToUnity(Value(contact, "x"), Value(contact, "z"));
            to.y = 0.13f;
            string playerId = payload["playerId"]?.ToString();
            RoaCharacterView thrower = FindThrowerView(playerId);
            if (thrower != null) thrower.PlayAttack(0.35f);
            StartCoroutine(PlayBolt(thrower, serverFrom, to,
                payload["magnetic"]?.Value<bool?>() == true,
                payload["hit"]?.Value<bool?>() == true));
        }

        private IEnumerator PlayBolt(RoaCharacterView thrower, Vector3 serverFrom, Vector3 to,
                                     bool magnetic, bool hit)
        {
            float releaseAt = Time.realtimeSinceStartup + ReleaseDelaySeconds;
            while (Time.realtimeSinceStartup < releaseAt) yield return null;

            Vector3 from = ResolveThrowOrigin(thrower, serverFrom, to);
            EnsurePresentation();
            GameObject projectile = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            projectile.name = magnetic ? "MagneticBolt_Projectile" : "Bolt_Projectile";
            projectile.transform.SetParent(transform, false);
            // Болт был 3,5 см в поперечнике при камере сверху: около одного пикселя,
            // и полёт не читался вовсе. Остальные боевые эффекты живут в масштабе
            // 0,13–0,28, поэтому щуп приведён к тому же языку: примерно 9 см на 50 см.
            projectile.transform.localScale = new Vector3(0.09f, 0.25f, 0.09f);
            projectile.transform.position = from;
            RemoveCollider(projectile);
            Renderer renderer = projectile.GetComponent<Renderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = _material;
                renderer.shadowCastingMode = ShadowCastingMode.Off;
                renderer.receiveShadows = false;
            }

            var trail = projectile.AddComponent<TrailRenderer>();
            trail.time = 0.3f;
            trail.startWidth = magnetic ? 0.15f : 0.11f;
            trail.endWidth = 0f;
            trail.sharedMaterial = _material;
            trail.startColor = magnetic ? new Color(0.35f, 0.86f, 1f, 0.9f)
                : new Color(0.85f, 0.83f, 0.68f, 0.78f);
            trail.endColor = new Color(trail.startColor.r, trail.startColor.g, trail.startColor.b, 0f);

            const float duration = 0.42f;
            float elapsed = 0f;
            Vector3 previous = from;
            while (elapsed < duration)
            {
                elapsed += Time.unscaledDeltaTime;
                float t = Mathf.Clamp01(elapsed / duration);
                Vector3 position = Vector3.Lerp(from, to, t);
                position.y += Mathf.Sin(t * Mathf.PI) * 1.15f;
                Vector3 direction = position - previous;
                if (direction.sqrMagnitude > 0.0001f)
                    projectile.transform.rotation = Quaternion.LookRotation(direction) * Quaternion.Euler(90f, 0f, 0f);
                projectile.transform.position = position;
                previous = position;
                yield return null;
            }

            projectile.transform.position = to;
            // The field renderer owns the type-specific AnomalyDischargePulse.
            // Only an ordinary miss leaves a small metallic ground impact here.
            if (!hit) StartCoroutine(ImpactPulse(to, false));
            Destroy(projectile, trail.time + 0.05f);
        }

        private IEnumerator ImpactPulse(Vector3 position, bool hit)
        {
            var pulseObject = new GameObject(hit ? "AnomalyDischargePulse" : "BoltImpactPulse");
            pulseObject.transform.SetParent(transform, false);
            pulseObject.transform.position = position + Vector3.up * 0.08f;
            LineRenderer ring = CreateLine(pulseObject.transform, "ImpactRing", true, 32, hit ? 0.09f : 0.085f);
            for (int index = 0; index < ring.positionCount; index++)
            {
                float angle = index / (float)ring.positionCount * Mathf.PI * 2f;
                ring.SetPosition(index, new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)));
            }
            float elapsed = 0f;
            while (elapsed < 0.45f)
            {
                elapsed += Time.unscaledDeltaTime;
                float t = Mathf.Clamp01(elapsed / 0.45f);
                // Кольцо промаха тоже было почти невидимым: 65 см тонкой линией.
                pulseObject.transform.localScale = Vector3.one * Mathf.Lerp(0.08f, hit ? 2.4f : 0.95f, t);
                Color color = hit ? new Color(0.48f, 0.91f, 1f, 1f - t)
                    : new Color(0.82f, 0.78f, 0.58f, 1f - t);
                ring.startColor = ring.endColor = color;
                yield return null;
            }
            Destroy(pulseObject);
        }

        private bool TryReadGroundTarget(out Vector3 target)
        {
            target = default;
            if (_camera == null) return false;
            Vector3 pointer = Input.mousePosition;
            if (Input.touchCount > 0) pointer = Input.GetTouch(0).position;
            Ray ray = _camera.ScreenPointToRay(pointer);
            // Маска «всё» ловила и служебные объёмы движения: RoaLocalTerrain кладёт
            // их на слой 2 именно затем, чтобы они не участвовали в лучах, иначе точка
            // броска садилась на невидимую коробку у дерева или камня вместо земли.
            // DefaultRaycastLayers исключает этот слой — так же, как линия огня.
            RaycastHit[] hits = Physics.RaycastAll(ray, 160f,
                Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);
            if (hits.Length > 0)
            {
                System.Array.Sort(hits, (left, right) => left.distance.CompareTo(right.distance));
                target = hits[0].point;
                return true;
            }
            var plane = new Plane(Vector3.up, Vector3.zero);
            if (!plane.Raycast(ray, out float distance)) return false;
            target = ray.GetPoint(distance);
            return true;
        }

        private void UpdateHint()
        {
            if (_hint == null) return;
            if (_aiming)
            {
                _hint.text = _mobileControls != null && _mobileControls.ControlsEnabled
                    ? "БОЛТ: коснитесь точки броска · повторное нажатие — отмена"
                    : "БОЛТ: ЛКМ — бросить до " + ThrowRangeMeters.ToString("0.#") + " м · B или Esc — отмена";
                _hint.gameObject.SetActive(true);
            }
            else if (Time.realtimeSinceStartup >= _statusUntil) _hint.gameObject.SetActive(false);
        }

        private void ShowStatus(string text, float seconds)
        {
            EnsurePresentation();
            StatusText = text ?? string.Empty;
            _statusUntil = Time.realtimeSinceStartup + Mathf.Max(0.5f, seconds);
            _hint.text = StatusText;
            _hint.gameObject.SetActive(true);
        }

        private bool CanThrow()
        {
            return _socket != null && _socket.Phase == RoaSocketClient.ConnectionPhase.Joined
                && _socket.Session != null && !string.IsNullOrWhiteSpace(_socket.Session.RoomId)
                && RoaGameBootstrap.Active != null
                && !RoaGameBootstrap.BlocksWorldHud && RoaGameBootstrap.Active.PlayerView != null;
        }

        private static bool PointerOverUi()
        {
            if (EventSystem.current == null) return false;
            if (Input.touchCount > 0)
                return EventSystem.current.IsPointerOverGameObject(Input.GetTouch(0).fingerId);
            return EventSystem.current.IsPointerOverGameObject();
        }

        private static Vector3 PlayerPosition()
        {
            RoaCharacterView view = RoaGameBootstrap.Active != null ? RoaGameBootstrap.Active.PlayerView : null;
            return view != null ? view.transform.position : Vector3.zero;
        }

        private RoaCharacterView FindThrowerView(string playerId)
        {
            RoaGameBootstrap bootstrap = RoaGameBootstrap.Active;
            if (bootstrap == null || string.IsNullOrEmpty(playerId)) return null;
            if (string.Equals(playerId, _socket?.Session?.Id, System.StringComparison.Ordinal))
                return bootstrap.PlayerView;
            return bootstrap.RemotePlayers != null
                && bootstrap.RemotePlayers.TryGetCharacterView(playerId, out RoaCharacterView remote)
                    ? remote : null;
        }

        private static Vector3 ResolveThrowOrigin(RoaCharacterView thrower, Vector3 serverFrom,
                                                  Vector3 target)
        {
            if (thrower != null && thrower.TryGetRightHand(out Vector3 hand)) return hand;

            Vector3 actorPosition = thrower != null ? thrower.transform.position : serverFrom;
            Vector3 forward = target - actorPosition;
            forward.y = 0f;
            if (forward.sqrMagnitude > 0.0001f) forward.Normalize();
            else forward = thrower != null ? thrower.transform.forward : Vector3.forward;
            Vector3 right = thrower != null ? thrower.transform.right
                : new Vector3(forward.z, 0f, -forward.x);
            return actorPosition + Vector3.up * FallbackHandHeight
                + right * FallbackHandSide + forward * FallbackHandForward;
        }

        private static Vector3 ClampToRange(Vector3 from, Vector3 target, float range)
        {
            Vector3 flat = target - from;
            flat.y = 0f;
            if (flat.magnitude > range) flat = flat.normalized * range;
            return new Vector3(from.x + flat.x, target.y, from.z + flat.z);
        }

        private void EnsurePresentation()
        {
            if (_material == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                    ?? Shader.Find("Sprites/Default") ?? Shader.Find("Unlit/Color");
                if (shader != null)
                {
                    _material = new Material(shader) { name = "BoltTool_Runtime" };
                    Color color = new Color(0.72f, 0.88f, 0.71f, 0.86f);
                    _material.color = color;
                    if (_material.HasProperty("_BaseColor")) _material.SetColor("_BaseColor", color);
                    if (_material.HasProperty("_Surface")) _material.SetFloat("_Surface", 1f);
                    if (_material.HasProperty("_ZWrite")) _material.SetFloat("_ZWrite", 0f);
                    _material.renderQueue = 3020;
                }
            }
            if (_hint == null) BuildHintCanvas();
        }

        private void RemoveRetiredAimIndicator()
        {
            GameObject retired = GameObject.Find("BoltThrowReticle");
            if (retired == null) return;
            retired.SetActive(false);
            if (Application.isPlaying) Destroy(retired);
            else DestroyImmediate(retired);
        }

        private LineRenderer CreateLine(Transform parent, string name, bool loop, int count, float width)
        {
            var target = new GameObject(name);
            target.transform.SetParent(parent, false);
            var line = target.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.loop = loop;
            line.positionCount = count;
            line.startWidth = width;
            line.endWidth = width;
            line.sharedMaterial = _material;
            line.startColor = line.endColor = new Color(0.72f, 0.88f, 0.71f, 0.86f);
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            return line;
        }

        private void BuildHintCanvas()
        {
            var canvasObject = new GameObject("BoltToolCanvas", typeof(RectTransform), typeof(Canvas),
                typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasObject.transform.SetParent(transform, false);
            Canvas canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 25;
            RoaUiScale.Apply(canvasObject.GetComponent<CanvasScaler>());
            var textObject = new GameObject("BoltToolHint", typeof(RectTransform), typeof(Text),
                typeof(Outline));
            textObject.transform.SetParent(canvasObject.transform, false);
            RectTransform rect = (RectTransform)textObject.transform;
            rect.anchorMin = new Vector2(0.5f, 0f);
            rect.anchorMax = new Vector2(0.5f, 0f);
            rect.pivot = new Vector2(0.5f, 0f);
            rect.anchoredPosition = new Vector2(0f, 112f);
            rect.sizeDelta = new Vector2(650f, 42f);
            _hint = textObject.GetComponent<Text>();
            _hint.font = RoaUiFont.Default;
            _hint.fontSize = 18;
            _hint.fontStyle = FontStyle.Bold;
            _hint.alignment = TextAnchor.MiddleCenter;
            _hint.color = new Color(0.88f, 0.94f, 0.78f, 1f);
            _hint.raycastTarget = false;
            Outline outline = textObject.GetComponent<Outline>();
            outline.effectColor = new Color(0f, 0f, 0f, 0.92f);
            outline.effectDistance = new Vector2(2f, -2f);
            _hint.gameObject.SetActive(false);
        }

        private void OnDestroy()
        {
            if (_socket != null) _socket.OnBoltThrown -= HandleBoltThrown;
            if (_material != null) Destroy(_material);
        }

        private static void RemoveCollider(GameObject target)
        {
            Collider collider = target != null ? target.GetComponent<Collider>() : null;
            if (collider != null) Destroy(collider);
        }

        private static float Value(JObject source, string name)
        {
            return source?[name]?.Value<float?>() ?? 0f;
        }
    }
}
