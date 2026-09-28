using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>Displays the current NPC line in Synty's subtitle frame.</summary>
    public sealed class RoaSubtitlesCanvas : MonoBehaviour
    {
        private RoaGameBootstrap _bootstrap;
        private RoaInteraction _interaction;
        private GameObject _canvasObject;
        private GameObject _subtitle;
        private TextMeshProUGUI _speaker;
        private TextMeshProUGUI _line;

        public void Configure(RoaGameBootstrap bootstrap, RoaInteraction interaction)
        {
            _bootstrap = bootstrap;
            _interaction = interaction;
        }

        private void Update()
        {
            bool show = _bootstrap != null && _bootstrap.InGame
                && _interaction != null && _interaction.NpcOpen;
            if (!show)
            {
                if (_canvasObject != null) _canvasObject.SetActive(false);
                return;
            }
            if (_canvasObject == null) Build();
            if (_canvasObject == null) return;
            if (!_canvasObject.activeSelf) _canvasObject.SetActive(true);
            string speech = _interaction.NpcSpeech;
            _subtitle.SetActive(!string.IsNullOrWhiteSpace(speech));
            if (_speaker != null) _speaker.text = _interaction.DialogueTitle;
            if (_line != null) _line.text = speech;
            RectTransform rect = (RectTransform)_subtitle.transform;
            bool mobile = _bootstrap.Combat?.MobileInputMode == true;
            rect.localScale = Vector3.one * (mobile ? 0.44f : 0.60f);
            rect.anchoredPosition = new Vector2(0f, mobile ? 36f : 58f);
        }

        private void Build()
        {
            GameObject prefab = Resources.Load<GameObject>(
                "ApocalypseHud/HUD_Apocalypse_Subtitles_01");
            if (prefab == null) { enabled = false; return; }
            _canvasObject = new GameObject("ApocalypseSubtitlesCanvas",
                typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler));
            _canvasObject.transform.SetParent(transform, false);
            Canvas canvas = _canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 43;
            RoaUiScale.Apply(_canvasObject.GetComponent<CanvasScaler>());
            _subtitle = Instantiate(prefab, _canvasObject.transform, false);
            _subtitle.name = "ApocalypseSubtitles";
            RectTransform rect = (RectTransform)_subtitle.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0f);
            rect.pivot = new Vector2(0.5f, 0f);
            _speaker = rect.Find("Name/Label_Name")?.GetComponent<TextMeshProUGUI>();
            _line = rect.Find("Subtitle/Label_Subtitle")?.GetComponent<TextMeshProUGUI>();
            RoaApocalypseTmpFonts.Apply(_subtitle);
            foreach (Animator animator in _subtitle.GetComponentsInChildren<Animator>(true))
                animator.enabled = false;
            foreach (Graphic graphic in _subtitle.GetComponentsInChildren<Graphic>(true))
                graphic.raycastTarget = false;
        }
    }
}
