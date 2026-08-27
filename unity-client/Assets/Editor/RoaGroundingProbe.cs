#if UNITY_EDITOR
using System;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Validates foot-ground sampling, LOD and shared contact-shadow resources.</summary>
    public static class RoaGroundingProbe
    {
        [MenuItem("Realm of Ashes/Проверить контакт с землёй")]
        public static void Run()
        {
            GameObject ownerA = null;
            GameObject ownerB = null;
            GameObject rig = null;
            GameObject flightRig = null;
            GameObject staleLockRig = null;
            GameObject floor = null;
            GameObject step = null;
            var shadowA = new RoaActorGroundShadow();
            var shadowB = new RoaActorGroundShadow();
            int usersBefore = RoaActorGroundShadow.SharedUsers;
            try
            {
                Require(RoaFootIk.MaxDistance(true) < RoaFootIk.MaxDistance(false)
                        && RoaFootIk.ShouldRun(new Vector3(19.9f, 8f, 0f), Vector3.zero, true, false)
                        && !RoaFootIk.ShouldRun(new Vector3(20.1f, 0f, 0f), Vector3.zero, true, false)
                        && !RoaFootIk.ShouldRun(Vector3.zero, Vector3.zero, false, false),
                    "LOD foot IK не учитывает платформу, дальность или видимость");

                ownerA = new GameObject("GroundShadowOwnerA");
                ownerB = new GameObject("GroundShadowOwnerB");
                shadowA.Bind(ownerA.transform);
                shadowB.Bind(ownerB.transform);
                Require(shadowA.Ready && shadowB.Ready
                        && RoaActorGroundShadow.SharedUsers == usersBefore + 2,
                    "контактные тени не создались или не считают пользователей");

                Transform nodeA = ownerA.transform.Find("ActorContactShadow");
                Transform nodeB = ownerB.transform.Find("ActorContactShadow");
                Require(nodeA != null && nodeB != null,
                    "узлы контактной тени не добавлены персонажам");
                MeshRenderer rendererA = nodeA.GetComponent<MeshRenderer>();
                MeshRenderer rendererB = nodeB.GetComponent<MeshRenderer>();
                Require(rendererA != null && rendererB != null
                        && rendererA.sharedMaterial == rendererB.sharedMaterial
                        && nodeA.GetComponent<MeshFilter>().sharedMesh == nodeB.GetComponent<MeshFilter>().sharedMesh,
                    "актёры не переиспользуют общий меш и материал контактной тени");

                Vector3 slopeNormal = new Vector3(0f, 0.94f, 0.34f).normalized;
                shadowA.UpdatePose(new Vector3(1f, 0f, 2f), 0.27f, slopeNormal, 25f, false, false);
                Require(Mathf.Abs(nodeA.position.y - 0.286f) < 0.001f
                        && Vector3.Dot(nodeA.up, slopeNormal) > 0.999f,
                    "контактная тень не следует высоте и нормали земли");
                shadowA.UpdatePose(new Vector3(0.42f, 0f, 0.75f), 0f,
                    Vector3.up, 0f, true, false, 1f);
                Require(nodeA.localScale.x < 1.3f && nodeA.localScale.z > 2f
                        && nodeA.position.z > 0.7f,
                    "тень лежащего тела не расширяется и не следует за падением");
                shadowA.SetActive(false);
                Require(!shadowA.Visible, "LOD не скрывает дальнюю контактную тень");
                shadowA.SetActive(true);

                rig = new GameObject("GroundingRig");
                GameObject model = Node(rig.transform, "character_root", Vector3.zero);
                Transform leftFoot = Leg(model.transform, "l", -0.20f);
                Transform rightFoot = Leg(model.transform, "r", 0.20f);
                floor = GameObject.CreatePrimitive(PrimitiveType.Cube);
                floor.name = "GroundingFloor";
                floor.transform.position = new Vector3(0f, -0.05f, 0f);
                floor.transform.localScale = new Vector3(4f, 0.1f, 4f);
                step = GameObject.CreatePrimitive(PrimitiveType.Cube);
                step.name = "GroundingStep";
                step.transform.position = new Vector3(0.20f, 0.09f, 0f);
                step.transform.localScale = new Vector3(0.30f, 0.18f, 0.46f);
                Physics.SyncTransforms();

                var ik = new RoaFootIk();
                ik.Bind(rig.transform, model.transform);
                Require(ik.Ready, "синтетические кости ног не привязались");
                ik.Apply(1f / 60f, false, false, false, "idle", 0f);
                Require(ik.GroundProbeCount == 2,
                    "один кадр foot IK не сделал ровно две безаллокционные пробы земли");
                Require(ik.TryGetGroundPose(out float sampledY, out Vector3 sampledNormal)
                        && Mathf.Abs(sampledY - 0.09f) < 0.025f
                        && sampledNormal.y > 0.98f,
                    "foot IK не усреднил разные высоты опоры под стопами");
                Require(rightFoot.position.y > leftFoot.position.y + 0.12f,
                    "правая стопа не встала на ступень выше левой");
                ik.Reset();
                Require(ik.LockedCount == 0 && !ik.TryGetGroundPose(out _, out _),
                    "сброс LOD оставил старые замки или поверхность");

                flightRig = new GameObject("DualFlightRig");
                flightRig.transform.position = new Vector3(0f, 0f, 1.1f);
                GameObject flightModel = Node(flightRig.transform, "character_root", Vector3.zero);
                Transform flightLeft = Leg(flightModel.transform, "l", -0.20f);
                Transform flightRight = Leg(flightModel.transform, "r", 0.20f);
                var flightIk = new RoaFootIk();
                flightIk.Bind(flightRig.transform, flightModel.transform);
                flightLeft.parent.localRotation = Quaternion.Euler(60f, 0f, 0f);
                flightRight.parent.localRotation = Quaternion.Euler(60f, 0f, 0f);
                Physics.SyncTransforms();
                flightIk.Apply(1f / 60f, true, false, false, "run", 0f);
                Require(flightIk.SupportSafetyActive
                        && Mathf.Min(flightLeft.position.y, flightRight.position.y) < 0.17f,
                    "обе свободные стопы остаются в воздухе в фазе полёта клипа");

                staleLockRig = new GameObject("StaleFootLockRig");
                staleLockRig.transform.position = new Vector3(0f, 0f, -1.1f);
                GameObject staleModel = Node(staleLockRig.transform, "character_root", Vector3.zero);
                Transform staleLeft = Leg(staleModel.transform, "l", -0.20f);
                Leg(staleModel.transform, "r", 0.20f);
                var staleIk = new RoaFootIk();
                staleIk.Bind(staleLockRig.transform, staleModel.transform);
                for (int frame = 0; frame < 20; frame++)
                    staleIk.Apply(1f / 60f, false, false, false, "idle", 0f);
                Require(staleIk.LockedCount == 2, "стопы не зафиксировались перед проверкой старого замка");
                staleLockRig.transform.position += Vector3.forward * 0.55f;
                Physics.SyncTransforms();
                staleIk.Apply(1f / 60f, true, false, false, "run", 0f);
                Transform staleThigh = staleLeft.parent.parent;
                float staleReach = Vector3.Distance(staleThigh.position, staleLeft.parent.position)
                    + Vector3.Distance(staleLeft.parent.position, staleLeft.position);
                float staleExtension = Vector3.Distance(staleThigh.position, staleLeft.position) / staleReach;
                float staleHorizontal = Vector2.Distance(
                    new Vector2(staleThigh.position.x, staleThigh.position.z),
                    new Vector2(staleLeft.position.x, staleLeft.position.z));
                Require(staleExtension < 0.995f && staleHorizontal < 0.16f,
                    "устаревший замок вытянул ногу за персонажем: extension="
                    + staleExtension.ToString("F3") + ", xz=" + staleHorizontal.ToString("F3"));

                Destroy(floor);
                Destroy(step);
                floor = null;
                step = null;
                Physics.SyncTransforms();
                CaptureIfRequested(ownerA, shadowA);
                shadowA.Dispose();
                Require(RoaActorGroundShadow.SharedUsers == usersBefore + 1 && shadowB.Ready,
                    "удаление одной тени уничтожило общие ресурсы живого актёра");
                shadowB.Dispose();
                Require(RoaActorGroundShadow.SharedUsers == usersBefore,
                    "общие ресурсы контактной тени протекли после удаления актёров");

                Debug.Log("[КОНТАКТ С ЗЕМЛЁЙ] готово: IK 2 пробы, ступень="
                    + (rightFoot.position.y - leftFoot.position.y).ToString("F2")
                    + " м, LOD=" + RoaFootIk.MaxDistance(false) + "/" + RoaFootIk.MaxDistance(true) + " м");
            }
            finally
            {
                shadowA.Dispose();
                shadowB.Dispose();
                Destroy(ownerA);
                Destroy(ownerB);
                Destroy(rig);
                Destroy(flightRig);
                Destroy(staleLockRig);
                Destroy(floor);
                Destroy(step);
            }
        }

        private static Transform Leg(Transform model, string side, float x)
        {
            GameObject thigh = Node(model, "thigh_" + side, new Vector3(x, 1f, 0f));
            GameObject calf = Node(thigh.transform, "calf_" + side, new Vector3(0f, -0.44f, 0.07f));
            return Node(calf.transform, "foot_" + side, new Vector3(0f, -0.44f, -0.07f)).transform;
        }

        private static GameObject Node(Transform parent, string name, Vector3 localPosition)
        {
            var node = new GameObject(name);
            node.transform.SetParent(parent, false);
            node.transform.localPosition = localPosition;
            return node;
        }

        private static void CaptureIfRequested(GameObject owner, RoaActorGroundShadow shadow)
        {
            string path = Environment.GetEnvironmentVariable("ROA_GROUNDING_CAPTURE");
            if (string.IsNullOrWhiteSpace(path)) return;

            GameObject stage = null;
            Material groundMaterial = null;
            Material actorMaterial = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                stage = new GameObject("GroundingCaptureStage");
                shadow.UpdatePose(Vector3.zero, 0f, Vector3.up, 0f, false, false);
                GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
                ground.transform.SetParent(stage.transform, false);
                ground.transform.localScale = new Vector3(0.28f, 1f, 0.28f);
                Destroy(ground.GetComponent<Collider>());
                GameObject actor = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                actor.transform.SetParent(stage.transform, false);
                actor.transform.localPosition = new Vector3(0f, 0.78f, 0f);
                actor.transform.localScale = new Vector3(0.32f, 0.78f, 0.32f);
                Destroy(actor.GetComponent<Collider>());

                Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                    ?? Shader.Find("Unlit/Color") ?? Shader.Find("Standard");
                Color groundColor = new Color(0.31f, 0.23f, 0.14f);
                Color actorColor = new Color(0.30f, 0.35f, 0.34f);
                groundMaterial = new Material(shader) { color = groundColor };
                actorMaterial = new Material(shader) { color = actorColor };
                if (groundMaterial.HasProperty("_BaseColor")) groundMaterial.SetColor("_BaseColor", groundColor);
                if (actorMaterial.HasProperty("_BaseColor")) actorMaterial.SetColor("_BaseColor", actorColor);
                ground.GetComponent<Renderer>().sharedMaterial = groundMaterial;
                actor.GetComponent<Renderer>().sharedMaterial = actorMaterial;

                GameObject cameraObject = new GameObject("GroundingCaptureCamera");
                cameraObject.transform.SetParent(stage.transform, false);
                cameraObject.transform.position = new Vector3(1.65f, 1.25f, 1.85f);
                cameraObject.transform.LookAt(new Vector3(0f, 0.43f, 0f));
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.055f, 0.048f, 0.038f);
                camera.fieldOfView = 34f;
                target = new RenderTexture(512, 320, 24, RenderTextureFormat.ARGB32)
                {
                    antiAliasing = 4,
                    name = "GroundingCapture"
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
                Debug.Log("[КОНТАКТ С ЗЕМЛЁЙ] кадр: " + path);
            }
            finally
            {
                RenderTexture.active = previous;
                if (readback != null) Destroy(readback);
                if (target != null)
                {
                    target.Release();
                    Destroy(target);
                }
                Destroy(groundMaterial);
                Destroy(actorMaterial);
                Destroy(stage);
            }
        }

        private static void Destroy(UnityEngine.Object value)
        {
            if (value != null) UnityEngine.Object.DestroyImmediate(value);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
