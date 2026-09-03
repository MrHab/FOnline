#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Синхронная проверка режима «замороженной» анимации: legacy Animation
    /// перестаёт писать кости после клипа WrapMode.Once (attack/hurt) или Stop().
    /// Процедурные смещения (перелом ноги/руки, контузия, презентация активности)
    /// аддитивны, поэтому без окна Begin/End они копились бы каждый LateUpdate и
    /// нога уходила по кругу. Тело берётся из каталога префабов — без сети и
    /// без ожидания цикла редактора, поэтому пробник работает без фокуса окна.
    /// </summary>
    public static class RoaFrozenBoneProbe
    {
        private const string ResultFile = "roa-frozen-bone-probe.json";

        [MenuItem("Realm of Ashes/Проверить заморозку костей (перелом ноги)")]
        public static void Run()
        {
            GameObject host = null;
            var report = new JObject { ["pass"] = false };
            try
            {
                host = new GameObject("RoaFrozenBoneProbe");
                RoaCharacterView view = host.AddComponent<RoaCharacterView>();
                var appearance = new JObject
                {
                    ["sex"] = "male",
                    ["bodyType"] = "medium",
                    ["faceId"] = "male_04",
                    ["hairId"] = "short_crop",
                    ["hairColorId"] = "hair_08"
                };
                Task load = view.Load("http://127.0.0.1:3000", appearance);
                report["loadCompleted"] = load.IsCompleted;
                report["usesProjectPrefab"] = view.UsesProjectPrefab;
                report["bodyKey"] = view.BodyKey;
                Check(load.IsCompleted && !load.IsFaulted && view.Ready,
                    "тело male_medium не загрузилось синхронно из каталога префабов");

                Transform thigh = null;
                foreach (Transform node in view.GetComponentsInChildren<Transform>(true))
                    if (node.name == "thigh_l") { thigh = node; break; }
                Check(thigh != null, "thigh_l не найдена");

                Animation animation = view.GetComponentInChildren<Animation>(true);
                Check(animation != null && animation["idle"] != null, "idle-клип недоступен");
                MethodInfo lateUpdate = typeof(RoaCharacterView).GetMethod("LateUpdate",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Check(lateUpdate != null, "LateUpdate персонажа недоступен");

                AnimationState idle = animation["idle"];
                view.SetGroundingLod(true);
                view.UpdateLocomotion(Vector3.zero, 0f, false, false);
                animation.Play("idle");
                idle.enabled = true;
                idle.weight = 1f;
                idle.time = Mathf.Min(0.35f, idle.length * 0.35f);
                animation.Sample();
                lateUpdate.Invoke(view, null);
                animation.Play("idle");
                animation.Sample();
                Quaternion authored = thigh.localRotation;

                view.SetInjuries(new JObject { ["brokenLeg"] = true });
                Check(view.HasBrokenLegVisual, "перелом ноги не принят");
                animation.Stop();
                lateUpdate.Invoke(view, null);
                Quaternion injured = thigh.localRotation;
                float injuryAngle = Quaternion.Angle(authored, injured);
                report["injuryOffsetDeg"] = injuryAngle;

                float maxDrift = 0f;
                for (int frame = 0; frame < 60; frame++)
                {
                    lateUpdate.Invoke(view, null);
                    maxDrift = Mathf.Max(maxDrift, Quaternion.Angle(injured, thigh.localRotation));
                }
                float drift = Quaternion.Angle(injured, thigh.localRotation);
                report["driftAfter60Deg"] = drift;
                report["maxDriftDeg"] = maxDrift;

                view.SetInjuries(new JObject());
                lateUpdate.Invoke(view, null);
                float healed = Quaternion.Angle(authored, thigh.localRotation);
                report["healedVsAuthoredDeg"] = healed;

                Check(injuryAngle > 3f && injuryAngle < 8f,
                    "смещение перелома наложилось не один раз: " + injuryAngle.ToString("0.00") + "°");
                Check(drift < 0.5f && maxDrift < 0.5f,
                    "нога с переломом крутится на замороженной анимации: "
                    + drift.ToString("0.00") + "° за 60 кадров (max " + maxDrift.ToString("0.00") + "°)");
                Check(healed < 0.5f,
                    "после снятия перелома бедро не вернулось к позе клипа: " + healed.ToString("0.00") + "°");

                // Присед на месте — idle плюс аддитивная поза RoaCharacterPose на тазе,
                // позвоночнике, шее и голове. Таз — корень скелета: если его наклон
                // копится по кадрам, всё тело кувыркается.
                Transform pelvis = null;
                foreach (Transform node in view.GetComponentsInChildren<Transform>(true))
                    if (node.name == "pelvis") { pelvis = node; break; }
                Check(pelvis != null, "pelvis не найден");
                animation.Play("idle");
                idle.time = Mathf.Min(0.35f, idle.length * 0.35f);
                animation.Sample();
                lateUpdate.Invoke(view, null);
                animation.Play("idle");
                animation.Sample();
                Quaternion authoredPelvis = pelvis.localRotation;
                // Разгон blend приседа: в edit mode dt зажат к 0.001 с на вызов.
                for (int frame = 0; frame < 400; frame++) view.UpdateLocomotion(Vector3.zero, 0f, false, true);
                animation.Stop();
                lateUpdate.Invoke(view, null);
                Quaternion crouchedPelvis = pelvis.localRotation;
                float crouchAngle = Quaternion.Angle(authoredPelvis, crouchedPelvis);
                float crouchDrift = 0f;
                for (int frame = 0; frame < 60; frame++)
                {
                    view.UpdateLocomotion(Vector3.zero, 0f, false, true);
                    lateUpdate.Invoke(view, null);
                    crouchDrift = Mathf.Max(crouchDrift, Quaternion.Angle(crouchedPelvis, pelvis.localRotation));
                }
                report["crouchPelvisDeg"] = crouchAngle;
                report["crouchDriftAfter60Deg"] = crouchDrift;
                for (int frame = 0; frame < 400; frame++) view.UpdateLocomotion(Vector3.zero, 0f, false, false);
                lateUpdate.Invoke(view, null);
                float stoodUp = Quaternion.Angle(authoredPelvis, pelvis.localRotation);
                report["stoodUpVsAuthoredDeg"] = stoodUp;
                Check(crouchAngle > 1f && crouchAngle < 8f,
                    "присед не наклонил таз ровно один раз: " + crouchAngle.ToString("0.00") + "°");
                Check(crouchDrift < 0.5f,
                    "таз кувыркается в приседе на замороженной анимации: за 60 кадров ушёл на "
                    + crouchDrift.ToString("0.00") + "°");
                Check(stoodUp < 0.5f,
                    "после выхода из приседа таз не вернулся к позе клипа: " + stoodUp.ToString("0.00") + "°");

                report["pass"] = true;
                Debug.Log("[ЗАМОРОЗКА КОСТЕЙ] готово: перелом=" + injuryAngle.ToString("0.00")
                    + "°, дрейф за 60 кадров=" + drift.ToString("0.000") + "° (max "
                    + maxDrift.ToString("0.000") + "°), после лечения=" + healed.ToString("0.000")
                    + "°; присед: таз=" + crouchAngle.ToString("0.00") + "°, дрейф="
                    + crouchDrift.ToString("0.000") + "°, встал=" + stoodUp.ToString("0.000") + "°");
            }
            catch (Exception error)
            {
                report["error"] = error.Message;
                Debug.LogError("[ЗАМОРОЗКА КОСТЕЙ] ошибка: " + error.Message);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
                WriteReport(report);
            }
        }

        private static void WriteReport(JObject report)
        {
            string projectRoot = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(projectRoot)) return;
            File.WriteAllText(Path.Combine(projectRoot, "Library", ResultFile), report.ToString());
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
