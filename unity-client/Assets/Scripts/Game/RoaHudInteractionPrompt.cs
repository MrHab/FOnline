using System;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Persistent, non-blocking interaction prompt. The system log reports
    /// results, while this strip keeps the currently available action readable.
    /// </summary>
    public sealed partial class RoaHudCanvas
    {
        private GameObject _interactionPrompt;
        private CanvasGroup _interactionPromptGroup;
        private Text _interactionPromptKey;
        private Text _interactionPromptAction;
        private string _lastInteractionPrompt = string.Empty;

        public bool InteractionPromptVisible
        {
            get { return _interactionPrompt != null && _interactionPrompt.activeSelf
                && _interactionPromptGroup != null && _interactionPromptGroup.alpha > 0.01f; }
        }

        public string InteractionPromptText
        {
            get { return _interactionPromptAction != null ? _interactionPromptAction.text : string.Empty; }
        }

        public static void FormatInteractionPrompt(string hint, bool mobile, out string key, out string action)
        {
            string value = (hint ?? string.Empty).Trim();
            key = mobile ? "ДЕЙСТВИЕ" : "E";
            action = value;
            int separator = value.IndexOf(" — ", StringComparison.Ordinal);
            if (separator > 0)
            {
                if (!mobile) key = value.Substring(0, separator).Trim().ToUpperInvariant();
                action = value.Substring(separator + 3).Trim();
            }
            if (string.IsNullOrEmpty(action)) action = "Взаимодействовать";
            else action = char.ToUpperInvariant(action[0]) + action.Substring(1);
        }

        private void BuildInteractionPrompt()
        {
            RectTransform panel = PanelRect("InteractionPrompt", _safeRoot, new Vector2(0.5f, 0f),
                new Vector2(0.5f, 0f), new Vector2(0f, 216f), new Vector2(470f, 46f));
            _interactionPrompt = panel.gameObject;
            Image background = panel.GetComponent<Image>();
            background.color = new Color(0.035f, 0.041f, 0.036f, 0.94f);
            background.raycastTarget = false;
            Outline outline = panel.GetComponent<Outline>();
            outline.effectColor = new Color(Border.r, Border.g, Border.b, 0.92f);

            RectTransform keyPlate = Rect("KeyPlate", panel, new Vector2(0f, 1f), new Vector2(0f, 1f),
                new Vector2(0f, 1f), new Vector2(8f, -7f), new Vector2(78f, 32f));
            Image keyBackground = keyPlate.gameObject.AddComponent<Image>();
            keyBackground.color = new Color(0.24f, 0.18f, 0.075f, 0.98f);
            keyBackground.raycastTarget = false;
            Outline keyOutline = keyPlate.gameObject.AddComponent<Outline>();
            keyOutline.effectColor = new Color(0.88f, 0.67f, 0.24f, 0.95f);
            keyOutline.effectDistance = new Vector2(1f, -1f);

            _interactionPromptKey = Label("Key", keyPlate, Vector2.zero, keyPlate.sizeDelta, 11,
                TextAnchor.MiddleCenter, new Color(1f, 0.88f, 0.55f, 1f), FontStyle.Bold);
            Stretch(_interactionPromptKey.rectTransform, new Vector2(3f, 2f));
            _interactionPromptAction = Label("Action", panel, new Vector2(98f, -7f), new Vector2(356f, 32f), 13,
                TextAnchor.MiddleLeft, new Color(0.92f, 0.86f, 0.70f, 1f), FontStyle.Bold);
            _interactionPromptAction.horizontalOverflow = HorizontalWrapMode.Wrap;
            _interactionPromptAction.verticalOverflow = VerticalWrapMode.Truncate;

            RectTransform accent = Rect("Accent", panel, new Vector2(0f, 0f), new Vector2(1f, 0f),
                new Vector2(0.5f, 0f), Vector2.zero, new Vector2(0f, 3f));
            Image accentImage = accent.gameObject.AddComponent<Image>();
            accentImage.color = new Color(0.91f, 0.66f, 0.20f, 0.88f);
            accentImage.raycastTarget = false;

            _interactionPromptGroup = panel.gameObject.AddComponent<CanvasGroup>();
            _interactionPromptGroup.alpha = 0f;
            _interactionPromptGroup.blocksRaycasts = false;
            _interactionPromptGroup.interactable = false;
            _interactionPrompt.SetActive(false);
        }

        private void ApplyInteractionPromptLayout(bool mobile)
        {
            if (_interactionPrompt == null) return;
            RectTransform rect = (RectTransform)_interactionPrompt.transform;
            rect.anchoredPosition = new Vector2(0f, mobile ? 302f : 216f);
            rect.localScale = Vector3.one * (mobile ? 0.86f : 1f);
        }

        private void RefreshInteractionPrompt(bool worldHud)
        {
            if (_interactionPrompt == null || _interactionPromptGroup == null) return;
            string hint = _interaction != null ? (_interaction.InteractionHint ?? string.Empty) : string.Empty;
            bool show = worldHud && !string.IsNullOrWhiteSpace(hint);
            if (show)
            {
                bool mobile = _mobile != null && _mobile.ControlsEnabled;
                FormatInteractionPrompt(hint, mobile, out string key, out string action);
                _interactionPromptKey.text = key;
                _interactionPromptAction.text = action;
                if (!_interactionPrompt.activeSelf)
                {
                    _interactionPrompt.SetActive(true);
                    _interactionPromptGroup.alpha = 0f;
                }
                if (hint != _lastInteractionPrompt)
                {
                    _lastInteractionPrompt = hint;
                    _interactionPrompt.transform.localScale *= 1.035f;
                }
            }
            else
            {
                _lastInteractionPrompt = string.Empty;
            }

            if (!_interactionPrompt.activeSelf) return;
            float target = show ? 1f : 0f;
            _interactionPromptGroup.alpha = Mathf.MoveTowards(_interactionPromptGroup.alpha, target,
                Time.unscaledDeltaTime * 8f);
            float layoutScale = _mobile != null && _mobile.ControlsEnabled ? 0.86f : 1f;
            _interactionPrompt.transform.localScale = Vector3.Lerp(_interactionPrompt.transform.localScale,
                Vector3.one * layoutScale, 1f - Mathf.Exp(-12f * Time.unscaledDeltaTime));
            if (!show && _interactionPromptGroup.alpha <= 0.001f) _interactionPrompt.SetActive(false);
        }
    }
}
