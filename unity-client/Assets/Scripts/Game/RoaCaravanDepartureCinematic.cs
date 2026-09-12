using System;
using System.Collections;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Связывает последний диалог подготовки с двумя частями одной сцены:
    /// отправкой «Двенадцатого» со двора и раскрытием засады после подтверждённого
    /// сервером перехода. Квестовое состояние по-прежнему меняет только сервер.
    /// </summary>
    public sealed class RoaCaravanDepartureCinematic : MonoBehaviour
    {
        public const string CinematicId = "caravan_departure_ambush";
        public const string AmbushLocationId = "randomRuinedRoad";

        private enum CinematicPhase
        {
            None,
            Departure,
            AwaitingTransfer,
            Ambush
        }

        private static readonly Color Ink = new Color(0.94f, 0.91f, 0.76f, 1f);
        private static readonly Color Muted = new Color(0.78f, 0.73f, 0.57f, 1f);
        private static readonly Color Accent = new Color(0.96f, 0.66f, 0.18f, 1f);
        private static readonly Color ButtonBackground = new Color(0.08f, 0.09f, 0.06f, 0.94f);
        private static readonly Color ButtonBorder = new Color(0.72f, 0.49f, 0.15f, 1f);

        private RoaGameBootstrap _bootstrap;
        private RoaSocketClient _socket;
        private RoaCameraRig _cameraRig;
        private Coroutine _routine;
        private CinematicPhase _phase;
        private Action _submitDeparture;
        private bool _submitted;
        private bool _transferReceived;
        private bool _skipRequested;

        private Canvas _canvas;
        private RectTransform _safeArea;
        private Image _fade;
        private Image _flash;
        private RectTransform _topBar;
        private RectTransform _bottomBar;
        private Text _chapter;
        private Text _subtitle;
        private Button _skipButton;
        private Rect _lastSafeArea;
        private bool _lastMobile;

        private Transform _focus;
        private Transform _resumeTarget;
        private float _savedDistance;
        private float _savedPitch;
        private float _savedYaw;
        private float _savedSmooth;
        private float _savedFieldOfView;
        private bool _cameraCaptured;

        private GameObject _truck;
        private GameObject _gateLeft;
        private GameObject _gateRight;
        private Vector3 _truckPosition;
        private Quaternion _truckRotation;
        private Quaternion _leftRotation;
        private Quaternion _rightRotation;
        private bool _yardCaptured;
        private RoaCaravanAmbushStage _stage;
        private bool _releasedServerHold;
        private bool _fogCaptured;
        private bool _savedShowFog;
        private GameObject _hiddenPlayerView;
        private bool _savedPlayerViewActive;
        private static readonly Vector3[] ShotCenters = { RoaCoords.ToUnity(0,-16), RoaCoords.ToUnity(2,-9),
            RoaCoords.ToUnity(-3,-8), RoaCoords.ToUnity(2,-10), RoaCoords.ToUnity(-3,-13), RoaCoords.ToUnity(1,-10) };
        private static readonly float[] ShotDistances = { 17f,21f,15f,18f,18f,22f };
        private static readonly float[] ShotPitches = { 43f,47f,42f,45f,48f,67f };
        private static readonly float[] ShotYaws = { 32f,65f,105f,65f,32f,0f };

        public bool IsPlaying { get { return _phase != CinematicPhase.None; } }
        public bool PresentationReady { get { return _canvas != null; } }

        public void Configure(RoaGameBootstrap bootstrap, RoaSocketClient socket, RoaCameraRig cameraRig)
        {
            if (_socket != null)
            {
                _socket.OnServerWorldTransfer -= HandleServerWorldTransfer;
                _socket.OnDisconnected -= HandleDisconnected;
            }
            _bootstrap = bootstrap;
            _socket = socket;
            _cameraRig = cameraRig;
            if (_socket != null)
            {
                _socket.OnServerWorldTransfer += HandleServerWorldTransfer;
                _socket.OnDisconnected += HandleDisconnected;
            }
            EnsurePresentation();
        }

        private void OnDestroy()
        {
            RestoreLiveActors();
            RestoreCamera();
            if (_socket != null)
            {
                _socket.OnServerWorldTransfer -= HandleServerWorldTransfer;
                _socket.OnDisconnected -= HandleDisconnected;
            }
            if (_focus != null) Destroy(_focus.gameObject);
        }

        private void Update()
        {
            UpdateStageLifetime();
            if (!IsPlaying) return;
            UpdateSafeArea();
            if (Input.GetKeyDown(KeyCode.Space)) Skip();
        }

        public bool TryPlayDeparture(string cinematicId, Action submitDeparture)
        {
            if (!string.Equals(cinematicId, CinematicId, StringComparison.Ordinal)
                || submitDeparture == null || _bootstrap == null || _cameraRig == null)
                return false;
            if (IsPlaying) return true;

            _submitDeparture = submitDeparture;
            _submitted = false;
            _transferReceived = false;
            _skipRequested = false;
            _phase = CinematicPhase.Departure;
            CaptureCamera();
            CaptureYard();
            ShowPresentation(true);
            _bootstrap.SetCinematicActive(true);
            _routine = StartCoroutine(PlayDepartureAndAmbush());
            return true;
        }

        public void NotifyDepartureResult(JObject acknowledgement)
        {
            if (!IsPlaying) return;
            if (acknowledgement?["ok"]?.ToObject<bool>() == true) return;
            RestoreYard();
            Finish(true);
        }

        public void Skip()
        {
            if (!IsPlaying) return;
            _skipRequested = true;
            if (_phase == CinematicPhase.Departure)
            {
                SetImageAlpha(_fade, 1f);
                SubmitDepartureOnce();
            }
            else if (_phase == CinematicPhase.Ambush)
            {
                Finish(true);
            }
        }

        private IEnumerator PlayDepartureAndAmbush()
        {
            SetCopy("КОЛОННА №12", "Ворота открыть. «Двенадцатый» — на тракт.");
            SetImageAlpha(_fade, 0f);
            SetImageAlpha(_flash, 0f);
            yield return Fade(_fade, 0f, 1f, 0.24f);
            EnsureStage();
            yield return WaitForCast();
            if (!_skipRequested)
            {
                if (_stage == null || !_stage.Ready) { Skip(); }
            }
            if (!_skipRequested)
            {
                _stage.gameObject.SetActive(true);
                _stage.SampleDeparture(0f);
                HidePlayerPresentation();
                ApplyDepartureCamera();
                _cameraRig.SnapToTarget();
                yield return Fade(_fade, 1f, 0f, 0.48f);
                yield return AnimateGates(0.9f);
                SetCopy("КОЛОННА №12", "Кромка принимает только тех, кто до неё доехал.");
                yield return AnimateTruck(7f);
                yield return Fade(_fade, 0f, 1f, 0.42f);
            }

            _phase = CinematicPhase.AwaitingTransfer;
            if (_stage != null) _stage.gameObject.SetActive(false);
            SetCopy("КРОМКА", "Караван следует по старому тракту…");
            SetImageAlpha(_fade, 1f);
            SubmitDepartureOnce();

            float deadline = Time.unscaledTime + 30f;
            while (!_transferReceived && Time.unscaledTime < deadline)
                yield return null;
            if (!_transferReceived)
            {
                RestoreYard();
                _routine = null;
                Finish(false);
                yield break;
            }

            deadline = Time.unscaledTime + 60f;
            while (!AmbushReady() && Time.unscaledTime < deadline)
                yield return null;
            if (!AmbushReady())
            {
                _routine = null;
                Finish(false);
                yield break;
            }

            CaptureArrivalTarget();
            if (_skipRequested)
            {
                _routine = null;
                Finish(false);
                yield break;
            }

            yield return PlayAmbushReveal();
            _routine = null;
            Finish(false);
        }

        private IEnumerator PlayArrivalOnly()
        {
            _phase = CinematicPhase.AwaitingTransfer;
            _skipRequested = false;
            CaptureCamera();
            ShowPresentation(true);
            SetImageAlpha(_fade, 1f);
            SetImageAlpha(_flash, 0f);
            SetCopy("КРОМКА", "Караван следует по старому тракту…");
            _bootstrap?.SetCinematicActive(true);

            float deadline = Time.unscaledTime + 60f;
            while (!AmbushReady() && Time.unscaledTime < deadline)
                yield return null;
            if (!AmbushReady() || _skipRequested)
            {
                _routine = null;
                Finish(false);
                yield break;
            }

            CaptureArrivalTarget();
            yield return PlayAmbushReveal();
            _routine = null;
            Finish(false);
        }

        private IEnumerator PlayAmbushReveal()
        {
            EnsureStage();
            yield return WaitForCast();
            if (_stage == null || !_stage.Ready || _skipRequested) yield break;
            _phase = CinematicPhase.Ambush;
            _releasedServerHold = false;
            _stage.gameObject.SetActive(true);
            _stage.Sample(0f);
            HidePlayerPresentation();
            if (_bootstrap.Enemies != null) _bootstrap.Enemies.CinematicPresentationSuppressed = true;
            if (_bootstrap.Fog != null)
            { _savedShowFog = _bootstrap.Fog.ShowVisualFog; _fogCaptured = true; _bootstrap.Fog.ShowVisualFog = false; }
            ApplyAmbushCamera(ShotCenters[0] + RoaCaravanAmbushStage.AmbushOffset);
            _cameraRig.SnapToTarget();
            SetCopy("РАЗБИТЫЙ ТРАКТ", "Охрана: «Держать колонну. Браминов не отставлять!»");
            yield return Fade(_fade, 1f, 0f, 0.7f);
            if (_skipRequested) yield break;
            float elapsed = 0f;
            int previousShot = -1;
            while (elapsed < RoaCaravanAmbushStage.Duration && !_skipRequested)
            {
                elapsed += Time.unscaledDeltaTime;
                _stage.Sample(elapsed);
                int shot = elapsed < 4.4f ? 0 : elapsed < 8f ? 1 : elapsed < 12.8f ? 2
                    : elapsed < 18f ? 3 : elapsed < 22f ? 4 : 5;
                DirectAmbushCamera(elapsed, shot, shot != previousShot);
                previousShot = shot;
                yield return null;
            }
            _stage.CompleteAftermath();
            if (!_skipRequested)
                yield return Fade(_fade, 0f, 1f, 0.28f);
        }

        private void DirectAmbushCamera(float time, int shot, bool cut)
        {
            _focus.position = (shot == 0 ? RoaCoords.ToUnity(0,-16 + time) : ShotCenters[shot])
                + RoaCaravanAmbushStage.AmbushOffset + Vector3.up * 0.9f;
            float sinceBlast = time >= 15.4f ? time - 15.4f : time >= 10.1f ? time - 10.1f : time - 5.3f;
            if (sinceBlast >= 0f && sinceBlast < 0.6f)
                _focus.position += new Vector3(Mathf.Sin(sinceBlast * 78f), Mathf.Sin(sinceBlast * 53f),0f)
                    * (0.16f * (1f - sinceBlast / 0.6f));
            _cameraRig.Distance = ShotDistances[shot];
            _cameraRig.PitchDeg = ShotPitches[shot];
            _cameraRig.YawDeg = ShotYaws[shot];
            if (!cut) return;
            _cameraRig.SnapToTarget();
            string[] titles = { "РАЗБИТЫЙ ТРАКТ", "ЗАСАДА", "ПОД ОГНЁМ", "ОТВЕТНЫЙ ОГОНЬ",
                "ОТХОД", "ПОСЛЕ БОЯ" };
            string[] lines = { "Охрана: «Держать колонну. Браминов не отставлять!»",
                "Дозорный: «Справа! Засада! Все с дороги!»",
                "Погонщик: «Уводи браминов! За мной, в низину!»",
                "Охрана: «Прикройте раненых! Бей по стрелкам на обочине!»",
                "Охрана: «Отходим! Кого можете — вытаскивайте!»",
                "«Двенадцатый» разбит. Найдите выживших и верните снаряжение." };
            SetCopy(titles[shot], lines[shot]);
        }

        private IEnumerator AnimateGates(float duration)
        {
            if (!_yardCaptured) yield break;
            Quaternion leftOpen = _leftRotation * Quaternion.Euler(0f, -72f, 0f);
            Quaternion rightOpen = _rightRotation * Quaternion.Euler(0f, 72f, 0f);
            float elapsed = 0f;
            while (elapsed < duration && !_skipRequested)
            {
                elapsed += Time.unscaledDeltaTime;
                float t = Smooth01(elapsed / duration);
                if (_gateLeft != null) _gateLeft.transform.rotation = Quaternion.Slerp(_leftRotation, leftOpen, t);
                if (_gateRight != null) _gateRight.transform.rotation = Quaternion.Slerp(_rightRotation, rightOpen, t);
                yield return null;
            }
        }

        private IEnumerator AnimateTruck(float duration)
        {
            Vector3 start = _truckPosition;
            Vector3 middle = start + new Vector3(-7f, 0f, -3f);
            Vector3 end = start + new Vector3(-12f, 0f, -14f);
            float elapsed = 0f;
            while (elapsed < duration && !_skipRequested)
            {
                elapsed += Time.unscaledDeltaTime;
                float t = Smooth01(elapsed / duration);
                _stage?.SampleDeparture(elapsed / duration);
                if (_focus != null) _focus.position = RoaCoords.ToUnity(0f,17.5f + elapsed / duration * 13f)
                    + Vector3.up * 0.8f;
                if (_truck == null) { yield return null; continue; }
                Vector3 point = EvaluateTruckPath(start, middle, end, t);
                _truck.transform.position = point;
                float inverse = 1f - t;
                Vector3 tangent = 2f * inverse * (middle - start) + 2f * t * (end - middle);
                if (tangent.sqrMagnitude > 0.01f)
                    _truck.transform.rotation = Quaternion.LookRotation(tangent.normalized, Vector3.up);
                yield return null;
            }
        }

        private IEnumerator FlashAmbush()
        {
            float elapsed = 0f;
            const float duration = 0.55f;
            while (elapsed < duration && !_skipRequested)
            {
                elapsed += Time.unscaledDeltaTime;
                float normalized = Mathf.Clamp01(elapsed / duration);
                float alpha = normalized < 0.25f
                    ? normalized / 0.25f * 0.38f
                    : (1f - normalized) / 0.75f * 0.38f;
                SetImageAlpha(_flash, Mathf.Max(0f, alpha));
                yield return null;
            }
            SetImageAlpha(_flash, 0f);
        }

        private static IEnumerator Fade(Image image, float from, float to, float duration)
        {
            float elapsed = 0f;
            SetImageAlpha(image, from);
            while (elapsed < duration)
            {
                elapsed += Time.unscaledDeltaTime;
                SetImageAlpha(image, Mathf.Lerp(from, to, Smooth01(elapsed / duration)));
                yield return null;
            }
            SetImageAlpha(image, to);
        }

        private void HandleServerWorldTransfer(JObject payload)
        {
            if (!string.Equals(payload?["cinematicId"]?.ToString(), CinematicId,
                    StringComparison.Ordinal)) return;
            _transferReceived = true;
            if (IsPlaying) return;
            if (_bootstrap == null || _cameraRig == null) return;
            _routine = StartCoroutine(PlayArrivalOnly());
        }

        private void HandleDisconnected(string reason)
        {
            RestoreYard();
            Finish(true);
            ClearStage();
        }

        private bool AmbushReady()
        {
            return _bootstrap != null && _bootstrap.InGame && !_bootstrap.OnGlobalMap
                && _bootstrap.Loader != null && !_bootstrap.Loader.IsLoading
                && string.Equals(_bootstrap.Loader.Current?.Id, AmbushLocationId,
                    StringComparison.Ordinal);
        }

        private void SubmitDepartureOnce()
        {
            if (_submitted) return;
            _submitted = true;
            Action submit = _submitDeparture;
            _submitDeparture = null;
            submit?.Invoke();
        }

        private void CaptureCamera()
        {
            if (_cameraRig == null || _cameraCaptured) return;
            _resumeTarget = _cameraRig.Target;
            _savedDistance = _cameraRig.Distance;
            _savedPitch = _cameraRig.PitchDeg;
            _savedYaw = _cameraRig.YawDeg;
            _savedSmooth = _cameraRig.SmoothTime;
            _savedFieldOfView = _cameraRig.CurrentFieldOfView;
            _cameraCaptured = true;
            if (_focus == null)
            {
                var focusObject = new GameObject("CaravanCinematicCameraFocus");
                focusObject.transform.SetParent(transform, false);
                _focus = focusObject.transform;
            }
        }

        private void CaptureArrivalTarget()
        {
            if (_cameraRig != null && _cameraRig.Target != null && _cameraRig.Target != _focus)
                _resumeTarget = _cameraRig.Target;
        }

        private void ApplyDepartureCamera()
        {
            Vector3 focus = RoaCoords.ToUnity(0f,18f) + Vector3.up * 0.8f;
            _focus.position = focus;
            _cameraRig.Target = _focus;
            _cameraRig.Distance = 20f;
            _cameraRig.PitchDeg = 48f;
            _cameraRig.YawDeg = 32f;
            _cameraRig.SmoothTime = 0.14f;
            _cameraRig.SetFieldOfView(48f);
        }

        private void ApplyAmbushCamera(Vector3 center)
        {
            _focus.position = center + Vector3.up * 0.6f;
            _cameraRig.Target = _focus;
            _cameraRig.Distance = 18f;
            _cameraRig.PitchDeg = 60f;
            _cameraRig.YawDeg = 32f;
            _cameraRig.SmoothTime = 0.18f;
            _cameraRig.SetFieldOfView(51f);
        }

        private void RestoreCamera()
        {
            if (!_cameraCaptured || _cameraRig == null) return;
            _cameraRig.Target = _resumeTarget;
            _cameraRig.Distance = _savedDistance;
            _cameraRig.PitchDeg = _savedPitch;
            _cameraRig.YawDeg = _savedYaw;
            _cameraRig.SmoothTime = _savedSmooth;
            _cameraRig.SetFieldOfView(_savedFieldOfView);
            if (_cameraRig.Target != null) _cameraRig.SnapToTarget();
            _cameraCaptured = false;
        }

        private void CaptureYard()
        {
            _yardCaptured = false;
            RoaLocationLoader loader = _bootstrap?.Loader;
            if (loader == null) return;
            loader.TryGetObjectRoot("yard_caravan_truck", out _truck);
            loader.TryGetObjectRoot("yard_gate_left", out _gateLeft);
            loader.TryGetObjectRoot("yard_gate_right", out _gateRight);
            if (_truck != null)
            { _truckPosition = _truck.transform.position; _truckRotation = _truck.transform.rotation; }
            if (_gateLeft != null) _leftRotation = _gateLeft.transform.rotation;
            if (_gateRight != null) _rightRotation = _gateRight.transform.rotation;
            _yardCaptured = _truck != null || _gateLeft != null || _gateRight != null;
        }

        private void RestoreYard()
        {
            if (!_yardCaptured) return;
            if (_truck != null)
            {
                _truck.transform.position = _truckPosition;
                _truck.transform.rotation = _truckRotation;
            }
            if (_gateLeft != null) _gateLeft.transform.rotation = _leftRotation;
            if (_gateRight != null) _gateRight.transform.rotation = _rightRotation;
            _yardCaptured = false;
        }

        private void Finish(bool stopRoutine)
        {
            if (stopRoutine && _routine != null) StopCoroutine(_routine);
            _routine = null;
            RestoreLiveActors();
            if (IsPrivateAmbush())
            {
                EnsureStage();
                if (_stage != null && _stage.Ready)
                {
                    _stage.gameObject.SetActive(true);
                    _stage.CompleteAftermath();
                }
                ReleaseServerHold();
            }
            else if (_stage != null) _stage.gameObject.SetActive(false);
            RestoreCamera();
            _bootstrap?.SetCinematicActive(false);
            ShowPresentation(false);
            _phase = CinematicPhase.None;
            _submitDeparture = null;
            _submitted = false;
            _transferReceived = false;
            _skipRequested = false;
            SetImageAlpha(_flash, 0f);
            SetImageAlpha(_fade, 0f);
        }

        private bool IsPrivateAmbush()
        {
            return AmbushReady() && (_socket?.Session?.RoomId ?? string.Empty)
                .StartsWith(AmbushLocationId + "#intro_", StringComparison.Ordinal);
        }

        private void EnsureStage()
        {
            if (_stage != null) return;
            var root = new GameObject("CaravanTwelve_StagedCast");
            root.transform.SetParent(transform, false);
            root.SetActive(false);
            _stage = root.AddComponent<RoaCaravanAmbushStage>();
            _stage.BeginLoad(_bootstrap.BaseUrl, _bootstrap.CombatPresentation, _bootstrap.Audio);
        }

        private IEnumerator WaitForCast()
        {
            float deadline = Time.unscaledTime + 30f;
            while (_stage != null && !_stage.Loading.IsCompleted && Time.unscaledTime < deadline
                && !_skipRequested) yield return null;
            if (_stage != null && !_stage.Ready && !_skipRequested)
                Debug.LogError("[КАТ-СЦЕНА КАРАВАНА] Actors unavailable; showing aftermath instead of an empty movie.");
        }

        private void UpdateStageLifetime()
        {
            if (_bootstrap == null || IsPlaying) return;
            bool yard = _bootstrap.InGame && _bootstrap.Loader?.Current?.Id == "tutorialCaravanYard";
            if (yard && _bootstrap.Onboarding?.StepId == "departure") EnsureStage();
            if (IsPrivateAmbush())
            {
                EnsureStage();
                if (_stage.Ready && !_stage.Aftermath)
                { _stage.gameObject.SetActive(true); _stage.CompleteAftermath(); }
                ReleaseServerHold();
            }
            else if (!yard && _stage != null) ClearStage();
        }

        private void ReleaseServerHold()
        {
            if (_releasedServerHold || _socket == null) return;
            _releasedServerHold = true;
            _socket.Emit("kromkaOnboardingAction", new JObject {
                ["action"] = "finish_cinematic", ["cinematicId"] = CinematicId
            });
        }

        private void RestoreLiveActors()
        {
            if (_hiddenPlayerView != null) _hiddenPlayerView.SetActive(_savedPlayerViewActive);
            _hiddenPlayerView = null;
            if (_bootstrap?.Enemies != null) _bootstrap.Enemies.CinematicPresentationSuppressed = false;
            if (_fogCaptured && _bootstrap?.Fog != null) _bootstrap.Fog.ShowVisualFog = _savedShowFog;
            _fogCaptured = false;
        }

        private void HidePlayerPresentation()
        {
            GameObject view = _bootstrap?.PlayerView?.gameObject;
            if (view == null || view == _hiddenPlayerView) return;
            _hiddenPlayerView = view;
            _savedPlayerViewActive = view.activeSelf;
            view.SetActive(false);
        }

        private void ClearStage()
        {
            if (_stage != null) Destroy(_stage.gameObject);
            _stage = null;
            _releasedServerHold = false;
        }

        private void SetCopy(string chapter, string subtitle)
        {
            if (_chapter != null) _chapter.text = chapter ?? string.Empty;
            if (_subtitle != null) _subtitle.text = subtitle ?? string.Empty;
        }

        private void ShowPresentation(bool visible)
        {
            EnsurePresentation();
            if (_canvas != null) _canvas.gameObject.SetActive(visible);
            if (visible) UpdateSafeArea(true);
        }

        public void BuildPresentationForProbe()
        {
            EnsurePresentation();
        }

        private void EnsurePresentation()
        {
            if (_canvas != null) return;
            var canvasObject = new GameObject("CaravanDepartureCinematicCanvas", typeof(RectTransform),
                typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasObject.transform.SetParent(transform, false);
            _canvas = canvasObject.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 90;
            RoaUiScale.Apply(canvasObject.GetComponent<CanvasScaler>());

            RectTransform canvasRect = (RectTransform)canvasObject.transform;
            _fade = StretchImage("Fade", canvasRect, Color.black, true);
            _flash = StretchImage("AmbushFlash", canvasRect, new Color(0.55f, 0.04f, 0.01f, 0f), false);

            _topBar = Rect("TopLetterbox", canvasRect, new Vector2(0f, 1f), Vector2.one,
                new Vector2(0.5f, 1f), Vector2.zero, new Vector2(0f, 92f));
            AddImage(_topBar, Color.black, false);
            _bottomBar = Rect("BottomLetterbox", canvasRect, Vector2.zero, new Vector2(1f, 0f),
                new Vector2(0.5f, 0f), Vector2.zero, new Vector2(0f, 112f));
            AddImage(_bottomBar, Color.black, false);

            _chapter = Label("Chapter", _topBar, 27, FontStyle.Bold, TextAnchor.MiddleCenter, Accent);
            Stretch(_chapter.rectTransform, 18f);
            _subtitle = Label("Subtitle", _bottomBar, 18, FontStyle.Normal, TextAnchor.MiddleCenter, Ink);
            _subtitle.horizontalOverflow = HorizontalWrapMode.Wrap;
            Stretch(_subtitle.rectTransform, 24f);

            _safeArea = Rect("SafeArea", canvasRect, Vector2.zero, Vector2.one,
                new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            _skipButton = MakeButton("Skip", _safeArea, "ПРОПУСТИТЬ  ›", Skip);
            RectTransform skipRect = (RectTransform)_skipButton.transform;
            skipRect.anchorMin = skipRect.anchorMax = new Vector2(1f, 1f);
            skipRect.pivot = new Vector2(1f, 1f);
            skipRect.anchoredPosition = new Vector2(-22f, -20f);
            skipRect.sizeDelta = new Vector2(190f, 52f);

            UpdateSafeArea(true);
            canvasObject.SetActive(false);
        }

        private void UpdateSafeArea(bool force = false)
        {
            if (_safeArea == null) return;
            Rect area = Screen.safeArea;
            bool mobile = Application.isMobilePlatform;
            if (!force && area == _lastSafeArea && mobile == _lastMobile) return;
            _lastSafeArea = area;
            _lastMobile = mobile;
            Vector2 min = area.position;
            Vector2 max = area.position + area.size;
            min.x /= Mathf.Max(1f, Screen.width);
            min.y /= Mathf.Max(1f, Screen.height);
            max.x /= Mathf.Max(1f, Screen.width);
            max.y /= Mathf.Max(1f, Screen.height);
            _safeArea.anchorMin = min;
            _safeArea.anchorMax = max;
            _safeArea.offsetMin = Vector2.zero;
            _safeArea.offsetMax = Vector2.zero;
            if (_skipButton != null)
                ((RectTransform)_skipButton.transform).sizeDelta = SkipTargetSize(mobile);
        }

        public static float Smooth01(float value)
        {
            float t = Mathf.Clamp01(value);
            return t * t * (3f - 2f * t);
        }

        public static Vector3 EvaluateTruckPath(Vector3 start, Vector3 middle, Vector3 end, float value)
        {
            float t = Mathf.Clamp01(value);
            float inverse = 1f - t;
            return inverse * inverse * start + 2f * inverse * t * middle + t * t * end;
        }

        public static Vector2 SkipTargetSize(bool mobile)
        {
            return mobile ? new Vector2(220f, 58f) : new Vector2(190f, 52f);
        }

        private static void SetImageAlpha(Image image, float alpha)
        {
            if (image == null) return;
            Color color = image.color;
            color.a = Mathf.Clamp01(alpha);
            image.color = color;
        }

        private static Image StretchImage(string name, RectTransform parent, Color color, bool raycast)
        {
            RectTransform rect = Rect(name, parent, Vector2.zero, Vector2.one,
                new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            Image image = AddImage(rect, color, raycast);
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            return image;
        }

        private static Image AddImage(RectTransform rect, Color color, bool raycast)
        {
            Image image = rect.gameObject.AddComponent<Image>();
            image.color = color;
            image.raycastTarget = raycast;
            return image;
        }

        private static RectTransform Rect(string name, Transform parent, Vector2 anchorMin,
            Vector2 anchorMax, Vector2 pivot, Vector2 position, Vector2 size)
        {
            var go = new GameObject(name, typeof(RectTransform));
            RectTransform rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.pivot = pivot;
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            return rect;
        }

        private static void Stretch(RectTransform rect, float horizontalInset)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(horizontalInset, 0f);
            rect.offsetMax = new Vector2(-horizontalInset, 0f);
        }

        private static Text Label(string name, Transform parent, int size, FontStyle style,
            TextAnchor alignment, Color color)
        {
            RectTransform rect = Rect(name, parent, Vector2.zero, Vector2.one,
                new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            Text text = rect.gameObject.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.fontStyle = style;
            text.alignment = alignment;
            text.color = color;
            text.raycastTarget = false;
            return text;
        }

        private static Button MakeButton(string name, Transform parent, string caption,
            UnityEngine.Events.UnityAction action)
        {
            RectTransform rect = Rect(name, parent, Vector2.zero, Vector2.zero,
                new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            Image image = AddImage(rect, ButtonBackground, true);
            Outline outline = rect.gameObject.AddComponent<Outline>();
            outline.effectColor = ButtonBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            Button button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(action);
            Text label = Label("Label", rect, 13, FontStyle.Bold, TextAnchor.MiddleCenter, Muted);
            label.text = caption;
            return button;
        }
    }
}
