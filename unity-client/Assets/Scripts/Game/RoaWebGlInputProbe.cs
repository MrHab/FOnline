using UnityEngine;
using UnityEngine.EventSystems;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Диагностика ввода в WebGL-сборке: раз в 2 с пишет в консоль браузера, что
    /// видят legacy Input и EventSystem. Только для WebGL и только при
    /// ?roadebug=1 в адресе страницы.
    /// </summary>
    public sealed class RoaWebGlInputProbe : MonoBehaviour
    {
        private float _nextAt;
        private int _frames;
        private float _frameTime;

        private void Update()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (!Application.absoluteURL.Contains("roadebug=1")) return;
            if (Input.GetMouseButtonDown(0)) Debug.Log("[ROA-input] mouse down at " + Input.mousePosition);
            if (Input.anyKeyDown) Debug.Log("[ROA-input] key down: " + Input.inputString);
            _frames++; _frameTime += Time.unscaledDeltaTime;
            if (Time.unscaledTime < _nextAt) return;
            _nextAt = Time.unscaledTime + 2f;
            float fps = _frames / Mathf.Max(0.001f, _frameTime); _frames = 0; _frameTime = 0f;
            EventSystem es = EventSystem.current;
            Debug.Log("[ROA-input] fps=" + fps.ToString("0.0") + " mouse=" + Input.mousePosition + " screen=" + Screen.width + "x" + Screen.height
                + " es=" + (es != null ? es.name + "/" + (es.currentInputModule != null ? es.currentInputModule.GetType().Name : "noModule") + " over=" + es.IsPointerOverGameObject() : "null")
                + " focus=" + Application.isFocused);
#endif
        }
    }
}
