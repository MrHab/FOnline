#if UNITY_EDITOR
using System;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Checks cadence scaling, alternating feet and the real pooled particle systems.</summary>
    [InitializeOnLoad]
    public static class RoaMovementFxProbe
    {
        private const string RequestName = "RoaMovementFxProbe.request";
        private static double _nextRequestCheck;

        static RoaMovementFxProbe()
        {
            EditorApplication.update += PollRequest;
        }

        private static void PollRequest()
        {
            if (EditorApplication.timeSinceStartup < _nextRequestCheck) return;
            _nextRequestCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string root = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(root)) return;
            string request = Path.Combine(root, "Library", RequestName);
            if (!File.Exists(request)) return;
            File.Delete(request);
            Run();
        }

        [MenuItem("Realm of Ashes/Проверить пыль шагов")]
        public static void Run()
        {
            GameObject host = null;
            try
            {
                RoaMovementFx.EmissionPlan walk = RoaMovementFx.PlanFor(2f, false, false);
                RoaMovementFx.EmissionPlan run = RoaMovementFx.PlanFor(6.4f, false, false);
                RoaMovementFx.EmissionPlan crouch = RoaMovementFx.PlanFor(2f, true, false);
                RoaMovementFx.EmissionPlan mobile = RoaMovementFx.PlanFor(6.4f, false, true);
                Require(run.PuffCount > walk.PuffCount && run.PuffSize > walk.PuffSize
                        && run.Alpha > walk.Alpha,
                    "бег не усиливает визуальный контакт с землёй");
                Require(crouch.PuffCount == 1 && crouch.ScuffCount == 0
                        && crouch.Alpha < walk.Alpha,
                    "присед создаёт слишком заметную пыль");
                Require(mobile.PuffCount < run.PuffCount && mobile.PuffCount >= 2,
                    "мобильный бюджет частиц не ограничен или полностью выключен");

                Vector3 velocity = new Vector3(0f, 0f, 4f);
                Vector3 left = RoaMovementFx.FootOffset(velocity, false);
                Vector3 right = RoaMovementFx.FootOffset(velocity, true);
                Require(Vector3.Distance(left, -right) < 0.0001f
                        && Mathf.Abs(right.magnitude - 0.13f) < 0.0001f,
                    "левая и правая стопа не чередуются симметрично");

                var actorState = new RoaMovementFx.ActorStepState();
                RoaAudio.FootstepCue actorCue;
                Vector3 actorVelocity = new Vector3(0f, 0f, 3f);
                Require(!RoaMovementFx.TryPlanActorStep(ref actorState, Vector3.zero,
                        actorVelocity, true, true, false, 0f, out actorCue),
                    "чужой актёр шумит сразу при появлении");
                Require(RoaMovementFx.TryPlanActorStep(ref actorState, new Vector3(0f, 0f, 0.12f),
                        actorVelocity, true, true, false, 0.2f, out actorCue)
                        && actorCue.RightFoot,
                    "первый реальный шаг чужого актёра не распознан");
                Require(!RoaMovementFx.TryPlanActorStep(ref actorState, new Vector3(0f, 0f, 0.42f),
                        actorVelocity, true, false, false, 0.7f, out actorCue)
                        && !RoaMovementFx.TryPlanActorStep(ref actorState, new Vector3(0f, 0f, 0.45f),
                        actorVelocity, true, true, false, 0.75f, out actorCue),
                    "после тумана войны возникает пачка накопленных шагов");
                Require(RoaMovementFx.TryPlanActorStep(ref actorState, new Vector3(0f, 0f, 0.54f),
                        actorVelocity, true, true, false, 0.9f, out actorCue)
                        && !actorCue.RightFoot,
                    "шаги чужого актёра не возобновляются с правильной стопы");
                Require(!RoaMovementFx.TryPlanActorStep(ref actorState, new Vector3(10f, 0f, 0.54f),
                        actorVelocity, true, true, false, 1.5f, out actorCue),
                    "серверная коррекция позиции ошибочно выглядит как шаг");
                Require(RoaMovementFx.ActorFxMaxDistance(true) < RoaMovementFx.ActorFxMaxDistance(false)
                        && RoaMovementFx.IsActorFxInRange(new Vector3(14.9f, 8f, 0f), Vector3.zero, true)
                        && !RoaMovementFx.IsActorFxInRange(new Vector3(15.1f, 0f, 0f), Vector3.zero, true),
                    "дистанционный или мобильный бюджет чужих шагов не работает");

                host = new GameObject("Movement FX probe");
                RoaMovementFx fx = host.AddComponent<RoaMovementFx>();
                fx.EmitFootstep(new RoaAudio.FootstepCue
                {
                    Position = Vector3.zero,
                    Velocity = velocity,
                    Speed = 6.4f,
                    Crouching = false,
                    RightFoot = true
                });
                Require(fx.Ready && fx.PuffCapacity == 96 && fx.ScuffCapacity == 24,
                    "пулы пыли и следов не готовы");
                foreach (ParticleSystem system in host.GetComponentsInChildren<ParticleSystem>(true))
                    system.Simulate(0.02f, false, false, true);
                Require(fx.ActiveParticleCount == run.PuffCount + run.ScuffCount,
                    "один шаг не создал ожидаемый пакет частиц");
                var pooledActorCue = new RoaAudio.FootstepCue
                {
                    Position = new Vector3(0.25f, 0f, 0f),
                    Velocity = actorVelocity,
                    Speed = actorVelocity.magnitude,
                    Crouching = false,
                    RightFoot = false
                };
                RoaMovementFx.EmissionPlan actorPlan = RoaMovementFx.PlanFor(pooledActorCue.Speed, false, false);
                fx.EmitActorStep(pooledActorCue);
                foreach (ParticleSystem system in host.GetComponentsInChildren<ParticleSystem>(true))
                    system.Simulate(0.02f, false, false, true);
                Require(fx.ActorStepCount == 1
                        && fx.ActiveParticleCount == run.PuffCount + run.ScuffCount
                            + actorPlan.PuffCount + actorPlan.ScuffCount,
                    "чужой шаг не переиспользовал общие пулы частиц");
                ParticleSystemRenderer[] renderers = host.GetComponentsInChildren<ParticleSystemRenderer>(true);
                Require(Array.Exists(renderers, r => r.renderMode == ParticleSystemRenderMode.Billboard)
                        && Array.Exists(renderers, r => r.renderMode == ParticleSystemRenderMode.HorizontalBillboard),
                    "нет отдельного облачка и горизонтального следа");
                Require(Array.TrueForAll(renderers, r => r.sharedMaterial != null
                        && r.sharedMaterial.shader != null
                        && r.sharedMaterial.shader.name.IndexOf("Particle", StringComparison.OrdinalIgnoreCase) >= 0),
                    "материал пыли не использует цвет частиц");
                CaptureIfRequested(host, fx);

                Debug.Log("[ПЫЛЬ ШАГОВ] готово: walk=" + walk.PuffCount
                    + ", run=" + run.PuffCount + "+" + run.ScuffCount
                    + ", crouch=" + crouch.PuffCount + ", mobile=" + mobile.PuffCount
                    + ", actorPool=" + fx.ActorStepCount);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void CaptureIfRequested(GameObject host, RoaMovementFx fx)
        {
            string path = Environment.GetEnvironmentVariable("ROA_MOVEMENT_FX_CAPTURE");
            if (string.IsNullOrWhiteSpace(path)) return;

            RenderTexture previous = RenderTexture.active;
            RenderTexture target = null;
            Texture2D readback = null;
            Material groundMaterial = null;
            Camera camera = null;
            try
            {
                for (int i = -1; i <= 1; i += 2)
                {
                    fx.EmitFootstep(new RoaAudio.FootstepCue
                    {
                        Position = new Vector3(i * 0.28f, 0f, i * 0.08f),
                        Velocity = new Vector3(0f, 0f, 5.6f),
                        Speed = 5.6f,
                        Crouching = false,
                        RightFoot = i > 0
                    });
                }
                foreach (ParticleSystem system in host.GetComponentsInChildren<ParticleSystem>(true))
                    system.Simulate(0.18f, false, false, true);

                GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
                ground.name = "MovementFxCaptureGround";
                ground.transform.SetParent(host.transform, false);
                ground.transform.localPosition = new Vector3(0f, -0.015f, 0f);
                ground.transform.localScale = new Vector3(0.34f, 1f, 0.34f);
                Collider collider = ground.GetComponent<Collider>();
                if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
                Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                    ?? Shader.Find("Unlit/Color") ?? Shader.Find("Standard");
                groundMaterial = new Material(shader) { name = "MovementFxCaptureGroundMaterial" };
                Color groundColor = new Color(0.075f, 0.064f, 0.049f, 1f);
                if (groundMaterial.HasProperty("_BaseColor")) groundMaterial.SetColor("_BaseColor", groundColor);
                if (groundMaterial.HasProperty("_Color")) groundMaterial.SetColor("_Color", groundColor);
                ground.GetComponent<Renderer>().sharedMaterial = groundMaterial;

                GameObject cameraObject = new GameObject("MovementFxCaptureCamera");
                cameraObject.transform.SetParent(host.transform, false);
                cameraObject.transform.position = new Vector3(1.35f, 0.82f, 1.65f);
                cameraObject.transform.LookAt(new Vector3(0f, 0.09f, 0f));
                camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.018f, 0.023f, 0.021f, 1f);
                camera.fieldOfView = 34f;
                camera.nearClipPlane = 0.05f;
                camera.farClipPlane = 8f;

                target = new RenderTexture(512, 320, 24, RenderTextureFormat.ARGB32)
                {
                    name = "MovementFxCapture",
                    antiAliasing = 4
                };
                target.Create();
                camera.targetTexture = target;
                if (GraphicsSettings.currentRenderPipeline != null)
                {
                    var request = new RenderPipeline.StandardRequest { destination = target };
                    RenderPipeline.SubmitRenderRequest(camera, request);
                }
                else camera.Render();

                RenderTexture.active = target;
                readback = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, target.width, target.height), 0, 0);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());
                Debug.Log("[ПЫЛЬ ШАГОВ] кадр: " + path);
            }
            finally
            {
                RenderTexture.active = previous;
                if (camera != null) camera.targetTexture = null;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (target != null)
                {
                    target.Release();
                    UnityEngine.Object.DestroyImmediate(target);
                }
                if (groundMaterial != null) UnityEngine.Object.DestroyImmediate(groundMaterial);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
