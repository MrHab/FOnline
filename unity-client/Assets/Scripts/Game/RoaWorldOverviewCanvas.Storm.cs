using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Буря выброса в окне карты мира: полоса на 3D-карте (RoaWorldMap3D.ShowStorm),
    /// подпись у передней кромки напротив игрока и слой бури на местности зоны.
    /// Всё берётся из RoaRadiationStorm.Active — того же пути и тех же часов, что
    /// двигают стену в сцене.
    /// </summary>
    public sealed partial class RoaWorldOverviewCanvas
    {
        private static readonly Color StormLabelColor = new Color(0.78f, 1f, 0.45f, 1f);

        private RoaStormMapOverlay _previewStorm;

        private void UpdateStormView()
        {
            if (_map3D == null || !_map3D.IsOpen) return;
            RoaRadiationStorm storm = RoaRadiationStorm.Active;
            _map3D.ShowStorm(storm != null ? storm.Path : null, storm != null ? storm.ServerNowMs : 0d);
        }

        private void LayoutStormLabel(ref int used)
        {
            RoaRadiationStorm storm = RoaRadiationStorm.Active;
            RoaRadiationStormPath path = storm != null ? storm.Path : null;
            if (path == null || _map3D == null || !_map3D.HasStorm) return;
            double now = storm.ServerNowMs;
            float width = _cols * _zoneKm, height = _rows * _zoneKm;
            Vector2? player = PlayerPoint(CurrentSelf, out JObject _);
            Vector2 near = player ?? new Vector2(width * 0.5f, height * 0.5f);
            if (!RoaWorldMap3D.StormLeadPoint(path, now, near, width, height, out Vector2 lead)) return;
            // Буря ещё за краем мира — подпись стоит на краю, откуда она придёт.
            var at = new Vector2(Mathf.Clamp(lead.x, 6f, width - 6f), Mathf.Clamp(lead.y, 6f, height - 6f));
            if (!_map3D.PointToScreen(at, 0.3f, out Vector2 screen)) return;
            Text label = TakeViewLabel(ref used);
            label.fontSize = 13;
            label.fontStyle = FontStyle.Bold;
            label.color = StormLabelColor;
            label.horizontalOverflow = HorizontalWrapMode.Overflow;
            label.text = StormLabelText(path, player.HasValue ? path.SampleAt(near.x, near.y, now) : (RoaRadiationStormPath.Sample?)null);
            PlaceViewLabel(label, screen + new Vector2(0f, 18f));
        }

        /// <summary>«БУРЯ С ЗАПАДА · сила 2 · до вас 4 мин» — подпись полосы на карте мира.</summary>
        public static string StormLabelText(RoaRadiationStormPath path, RoaRadiationStormPath.Sample? atPlayer)
        {
            var text = new System.Text.StringBuilder("БУРЯ ").Append(path.ComingFromText.ToUpperInvariant())
                .Append(" · сила ").Append(path.Strength);
            if (atPlayer.HasValue)
            {
                RoaRadiationStormPath.Sample sample = atPlayer.Value;
                if (sample.Inside) text.Append(" · над вами");
                else if (sample.AheadKm > 0d) text.Append(" · до вас ").Append(RoaRadiationStorm.EtaText(Mathf.RoundToInt((float)(sample.EtaMs / 1000d))));
                else text.Append(" · прошла");
            }
            return text.ToString();
        }
    }
}
