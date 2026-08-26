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

        public RoaActivityFeedbackCue LastFeedbackCue { get; private set; }

        private void ConfigureActivityFeedbackVisuals(RectTransform intro, RectTransform result)
        {
            _introRect = intro;
            _resultRect = result;
            _introBasePosition = intro.anchoredPosition;
            _resultBasePosition = result.anchoredPosition;
            _introGroup = intro.gameObject.GetComponent<CanvasGroup>()
                ?? intro.gameObject.AddComponent<CanvasGroup>();
            _resultGroup = result.gameObject.GetComponent<CanvasGroup>()
                ?? result.gameObject.AddComponent<CanvasGroup>();
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
            ApplyCardAnimation(_resultGroup, _resultRect, _resultBasePosition,
                visible, Time.unscaledTime - _resultStartedAt, RoaActivityFeedback.ResultSeconds);
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
            if (_objective != null)
            {
                _objective.color = Color.Lerp(Ink, target, pulse);
                _objective.rectTransform.localScale = Vector3.one * (1f + pulse * 0.035f);
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
            if (_objective != null)
            {
                _objective.color = Ink;
                _objective.rectTransform.localScale = Vector3.one;
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
