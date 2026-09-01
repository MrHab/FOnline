using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaWorldActivityCanvas
    {
        private CanvasGroup _introGroup;
        private CanvasGroup _resultGroup;
        private RectTransform _introRect;
        private RectTransform _resultRect;
        private Vector2 _introBasePosition;
        private Vector2 _resultBasePosition;
        private float _introStartedAt;
        private float _resultStartedAt;
        private float _feedbackPulseStartedAt = -100f;
        private RoaActivityFeedbackCue _pendingActivityCue;
        private RoaActivityFeedbackCue _pendingResultCue;
        private bool _resultLayoutInitialized;
        private bool _resultCompactOnMap;

        public RoaActivityFeedbackCue LastFeedbackCue { get; private set; }

        private void ConfigureActivityFeedbackVisuals(RectTransform intro, RectTransform result)
        {
            _introRect = intro;
            _resultRect = result;
            _introBasePosition = intro.anchoredPosition;
            _resultBasePosition = result.anchoredPosition;
            _introGroup = intro.gameObject.GetComponent<CanvasGroup>();
            if (_introGroup == null) _introGroup = intro.gameObject.AddComponent<CanvasGroup>();
            _resultGroup = result.gameObject.GetComponent<CanvasGroup>();
            if (_resultGroup == null) _resultGroup = result.gameObject.AddComponent<CanvasGroup>();
            _introGroup.blocksRaycasts = false;
            _introGroup.interactable = false;
            _resultGroup.blocksRaycasts = false;
            _resultGroup.interactable = false;
        }

        private void QueueActivityFeedback(RoaActivityFeedbackCue cue)
        {
            if (cue == RoaActivityFeedbackCue.None) return;
            if (cue == RoaActivityFeedbackCue.Started)
            {
                _pendingActivityCue = cue;
                return;
            }
            if (CuePriority(cue) >= CuePriority(_pendingActivityCue)) _pendingActivityCue = cue;
        }

        private void FlushActivityFeedback()
        {
            if (_pendingActivityCue == RoaActivityFeedbackCue.None) return;
            RoaActivityFeedbackCue cue = _pendingActivityCue;
            _pendingActivityCue = RoaActivityFeedbackCue.None;
            EmitActivityFeedback(cue);
        }

        private void EmitActivityFeedback(RoaActivityFeedbackCue cue)
        {
            if (cue == RoaActivityFeedbackCue.None) return;
            LastFeedbackCue = cue;
            _feedbackPulseStartedAt = Time.unscaledTime;
            RoaAudio audio = Bootstrap != null ? Bootstrap.Audio : RoaAudio.Active;
            audio?.PlayActivityCue(cue);
        }

        private void UpdateIntroCardAnimation(bool visible)
        {
            if (_introGroup == null || _introRect == null) return;
            ApplyCardAnimation(_introGroup, _introRect, _introBasePosition,
                visible, Time.unscaledTime - _introStartedAt, RoaActivityFeedback.IntroSeconds);
        }

        private void UpdateResultCardAnimation(bool visible)
        {
            if (_resultGroup == null || _resultRect == null) return;
            bool compact = Bootstrap != null && Bootstrap.OnGlobalMap;
            ApplyResultCardLayout(compact);
            float lifetime = compact
                ? RoaActivityFeedback.GlobalMapResultSeconds
                : RoaActivityFeedback.ResultSeconds;
            ApplyCardAnimation(_resultGroup, _resultRect, _resultBasePosition,
                visible, Time.unscaledTime - _resultStartedAt, lifetime);
            _resultGroup.blocksRaycasts = visible;
            _resultGroup.interactable = visible;
        }

        private void ApplyResultCardLayout(bool compact)
        {
            if (_resultLayoutInitialized && _resultCompactOnMap == compact) return;
            _resultLayoutInitialized = true;
            _resultCompactOnMap = compact;

            _resultRect.anchoredPosition = compact ? new Vector2(0f, -22f) : new Vector2(0f, -76f);
            _resultRect.sizeDelta = compact ? new Vector2(410f, 166f) : new Vector2(470f, 214f);
            _resultBasePosition = _resultRect.anchoredPosition;
            if (compact)
            {
                Place(_resultTitle.rectTransform, 14f, -24f, -14f, -6f);
                RectTransform resultFlow = _resultFlowSlots.Count > 0
                    ? _resultFlowSlots[0].Background.transform.parent as RectTransform : null;
                if (resultFlow != null) Place(resultFlow, 14f, -44f, -14f, -29f);
                Place(_resultName.rectTransform, 14f, -66f, -14f, -47f);
                Place(_resultGrade.rectTransform, 14f, -84f, -14f, -68f);
                Place(_resultReward.rectTransform, 14f, -128f, -14f, -86f);
                Place((RectTransform)_resultContinue.transform, 14f, -158f, -14f, -132f);
            }
            else
            {
                Place(_resultTitle.rectTransform, 16f, -27f, -16f, -8f);
                RectTransform resultFlow = _resultFlowSlots.Count > 0
                    ? _resultFlowSlots[0].Background.transform.parent as RectTransform : null;
                if (resultFlow != null) Place(resultFlow, 16f, -46f, -16f, -31f);
                Place(_resultName.rectTransform, 16f, -72f, -16f, -50f);
                Place(_resultGrade.rectTransform, 16f, -95f, -16f, -76f);
                Place(_resultReward.rectTransform, 16f, -164f, -16f, -99f);
                Place((RectTransform)_resultContinue.transform, 16f, -202f, -16f, -169f);
            }
        }

        private static void ApplyCardAnimation(CanvasGroup group, RectTransform rect, Vector2 origin,
                                               bool visible, float age, float lifetime)
        {
            if (!visible)
            {
                group.alpha = 0f;
                rect.anchoredPosition = origin;
                rect.localScale = Vector3.one;
                return;
            }
            RoaActivityFeedback.CardSample sample = RoaActivityFeedback.SampleCard(age, lifetime);
            group.alpha = sample.Alpha;
            rect.anchoredPosition = origin + Vector2.up * sample.SlideY;
            rect.localScale = Vector3.one * sample.Scale;
        }

        private void UpdateActivityPulseVisuals()
        {
            float pulse = RoaActivityFeedback.SamplePulse(Time.unscaledTime - _feedbackPulseStartedAt);
            Color target = LastFeedbackCue == RoaActivityFeedbackCue.ExtractionOpened
                || LastFeedbackCue == RoaActivityFeedbackCue.Success ? Safe
                : LastFeedbackCue == RoaActivityFeedbackCue.Failure ? Danger : Accent;
            foreach (ObjectiveSlot slot in _objectiveSlots)
            {
                if (slot == null || slot.Root == null || !slot.Root.activeSelf) continue;
                Color baseline = ObjectiveViewColor(slot.View);
                slot.Label.color = slot.View.IsCurrent ? Color.Lerp(baseline, target, pulse) : baseline;
                slot.Progress.color = slot.View.State == ObjectiveVisualState.Locked
                    ? baseline : slot.View.IsCurrent ? Color.Lerp(Ink, target, pulse * 0.65f) : Ink;
                slot.Root.transform.localScale = Vector3.one
                    * (slot.View.IsCurrent ? 1f + pulse * 0.035f : 1f);
            }
            if (_action != null && _action.targetGraphic is Image image)
                image.color = Color.Lerp(ButtonBg, target * new Color(0.52f, 0.52f, 0.52f, 1f), pulse);
        }

        private void ResetActivityFeedback()
        {
            _pendingActivityCue = RoaActivityFeedbackCue.None;
            _pendingResultCue = RoaActivityFeedbackCue.None;
            LastFeedbackCue = RoaActivityFeedbackCue.None;
            _feedbackPulseStartedAt = -100f;
            foreach (ObjectiveSlot slot in _objectiveSlots)
            {
                if (slot == null || slot.Root == null) continue;
                Color baseline = ObjectiveViewColor(slot.View);
                slot.Label.color = baseline;
                slot.Progress.color = slot.View.State == ObjectiveVisualState.Locked ? baseline : Ink;
                slot.Root.transform.localScale = Vector3.one;
            }
            if (_action != null && _action.targetGraphic is Image image) image.color = ButtonBg;
        }

        private static int CuePriority(RoaActivityFeedbackCue cue)
        {
            return cue == RoaActivityFeedbackCue.ExtractionOpened ? 3
                : cue == RoaActivityFeedbackCue.Started ? 2
                : cue == RoaActivityFeedbackCue.Progress ? 1 : 0;
        }
    }
}
