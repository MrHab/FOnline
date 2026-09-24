#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    public static class RoaChatCanvasProbe
    {
        [MenuItem("Realm of Ashes/Probe/Apocalypse Chat")]
        public static void Run()
        {
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D image = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                host = new GameObject("ChatProbeHost");
                RoaChatCanvas chat = host.AddComponent<RoaChatCanvas>();
                Invoke(chat, "Build");
                Transform panel = host.transform.Find("ApocalypseChatCanvas/ApocalypseChat");
                Require(panel != null, "Apocalypse chat prefab was not installed");
                Require(!panel.parent.gameObject.activeSelf,
                    "chat should open on Enter instead of covering the fixed HUD");
                Require(host.transform.Find("ApocalypseChatLauncher/OpenChat")
                    ?.GetComponent<Button>() != null,
                    "mobile chat launcher is missing");
                panel.parent.gameObject.SetActive(true);
                RectTransform chatRect = (RectTransform)panel;
                bool mobileCapture = string.Equals(
                    Environment.GetEnvironmentVariable("ROA_CHAT_CAPTURE_MOBILE"), "1",
                    StringComparison.Ordinal);
                Require(chatRect.sizeDelta == new Vector2(600f, 420f),
                    "chat should fit beside the HUD action bar");
                chatRect.localScale = Vector3.one * (mobileCapture ? 0.58f : 0.40f);
                chatRect.anchoredPosition = new Vector2(mobileCapture ? 8f : 14f,
                    mobileCapture ? 145f : 115f);
                for (int i = 0; i < 5; i++)
                    Require(panel.Find("Header/Channel_" +
                        new[] { "world", "local", "faction", "group", "clan" }[i]) != null,
                        "Chat channel tab is missing: " + i);
                Require(panel.Find("Input")?.GetComponent<TMPro.TMP_InputField>() != null,
                    "Chat input is missing");
                foreach (var message in new[] {
                    new { senderName = "Странник", text = "Кто идёт к лагерю?" },
                    new { senderName = "Проводник", text = "Отряд уже на месте." },
                    new { senderName = "Странник", text = "Встречаемся у ворот." }
                })
                    Invoke(chat, "Receive", new JObject {
                        ["channel"] = "world", ["senderName"] = message.senderName,
                        ["text"] = message.text });

                string path = Environment.GetEnvironmentVariable("ROA_CHAT_CAPTURE");
                if (string.IsNullOrWhiteSpace(path))
                {
                    Debug.Log("[ROA PROBE] Five Apocalypse chat tabs, input and messages passed.");
                    return;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                cameraObject = new GameObject("ChatCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.17f, 0.18f, 0.16f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                target = new RenderTexture(mobileCapture ? 896 : 1280,
                    mobileCapture ? 414 : 720, 24, RenderTextureFormat.ARGB32);
                target.Create();
                camera.targetTexture = target;
                foreach (RectMask2D mask in host.GetComponentsInChildren<RectMask2D>(true))
                    mask.enabled = false;
                foreach (TMPro.TMP_Text label in host.GetComponentsInChildren<TMPro.TMP_Text>(true))
                {
                    if (label.gameObject.activeInHierarchy && label.enabled)
                        label.ForceMeshUpdate(true, true);
                    Debug.Log("[ROA PROBE] Chat text " + label.name + " font="
                        + (label.font != null ? label.font.name : "null")
                        + " content=" + label.text);
                }
                Canvas.ForceUpdateCanvases();
                if (GraphicsSettings.currentRenderPipeline != null)
                {
                    var request = new RenderPipeline.StandardRequest { destination = target };
                    RenderPipeline.SubmitRenderRequest(camera, request);
                }
                else camera.Render();
                RenderTexture.active = target;
                image = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
                image.ReadPixels(new Rect(0f, 0f, target.width, target.height), 0, 0);
                image.Apply(false, false);
                File.WriteAllBytes(path, image.EncodeToPNG());
                Debug.Log("[ROA PROBE] Apocalypse chat capture: " + path);
            }
            finally
            {
                RenderTexture.active = previous;
                if (image != null) UnityEngine.Object.DestroyImmediate(image);
                if (target != null) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Invoke(object target, string method, object arg = null)
        {
            MethodInfo info = target.GetType().GetMethod(method,
                BindingFlags.Instance | BindingFlags.NonPublic);
            Require(info != null, "Chat probe method is missing: " + method);
            info.Invoke(target, method == "Build" ? null : new[] { arg });
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
