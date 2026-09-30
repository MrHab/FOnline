#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Радиационная буря выброса в клиенте. Путь бури клиент считает сам по
    /// параметрам сервера, поэтому формула обязана совпадать с серверной до
    /// метров: снимок бури и ожидаемые выборки ниже получены из
    /// src/server/radiation-storm.js (shift_7, зона z_08_06). Дальше — рамка
    /// сектора (север — +Z, как северные ворота и компас), оси бури в сцене, строка
    /// панели, слой карты и подпись полосы на карте мира.
    /// </summary>
    public static class RoaRadiationStormProbe
    {
        private const string Fixture = @"{'id':'shift_7','strength':1,'phase':'active','dirX':-0.940999,'dirY':-0.338409,'headingDeg':199.78,'widthKm':60,'waveKm':10,
            'waves':[{'amp':6,'k':0.041888,'lead':5.469,'trail':5.297},{'amp':3,'k':0.098175,'lead':1.195,'trail':1.023},{'amp':1,'k':0.232711,'lead':3.204,'trail':1.279}],
            'lead0Km':-469.1024,'speedKmPerSec':0.299501,'warningStartAt':54000000,'activeStartAt':54600000,'activeEndAt':56400000,'afterglowEndAt':57600000,
            'bounds':{'minX':0,'minY':0,'maxX':380,'maxY':300},'frame':{'ox':170,'oy':130,'kx':0.0625,'kz':-0.0625}}";

        // x, y, серверное время, под бурей, сила, км до фронта, мс до фронта, передняя линия — из сервера.
        private static readonly (double x, double y, double now, bool inside, float intensity, double ahead, double eta, double line)[] Expected =
        {
            (190, 150, 55500000, true, 1f, 0, 0, -199.5515),
            (60, 40, 54900000, false, 0f, 317.447465, 1059921, -379.2521),
            (300, 260, 56100000, false, 0f, 0, 0, -19.8509),
            (170, 130, 55200000, false, 0f, 79.842001, 266583, -289.4018),
            (20, 280, 55800000, true, 1f, 0, 0, -109.7012),
            (350, 20, 54700000, false, 0f, 106.376617, 355180, -439.1523)
        };

        [MenuItem("Realm of Ashes/Probe/Radiation storm")]
        public static void Run()
        {
            JObject storm = JObject.Parse(Fixture);
            RoaRadiationStormPath path = RoaRadiationStormPath.Parse(storm);
            Require(path != null && path.Id == "shift_7" && path.Waves.Length == 3, "The server storm snapshot parses");
            foreach (var row in Expected)
            {
                RoaRadiationStormPath.Sample sample = path.SampleAt(row.x, row.y, row.now);
                string where = $"({row.x}, {row.y}) at {row.now}";
                Require(Math.Abs(path.LeadLineKm(row.now) - row.line) < 1e-3, where + ": lead line " + path.LeadLineKm(row.now) + " vs server " + row.line);
                Require(sample.Inside == row.inside, where + ": inside " + sample.Inside + " vs server " + row.inside);
                Require(Math.Abs(sample.Intensity - row.intensity) < 1e-3f, where + ": intensity " + sample.Intensity + " vs server " + row.intensity);
                Require(Math.Abs(sample.AheadKm - row.ahead) < 1e-3, where + ": km ahead " + sample.AheadKm + " vs server " + row.ahead);
                Require(Math.Abs(sample.EtaMs - row.eta) < 2d, where + ": ETA " + sample.EtaMs + " vs server " + row.eta);
            }

            // Рамка сектора z_08_06: центр сцены — центр клетки, север — +Z.
            RoaRadiationStormFrame frame = RoaRadiationStormFrame.Parse(storm["frame"] as JObject);
            Require(frame.Valid, "The sector frame parses");
            Vector2 centre = frame.LocalToGlobal(0f, 0f);
            Require(Mathf.Abs(centre.x - 170f) < 1e-3f && Mathf.Abs(centre.y - 130f) < 1e-3f, "The scene centre is the sector centre: " + centre);
            Vector2 northGate = frame.LocalToGlobal(0f, 150f);
            Require(northGate.y < centre.y - 9f, "The north gate (large tz, +Z) lies on the north side of the sector on the map: " + northGate);
            Vector3 back = frame.GlobalToLocal(northGate.x, northGate.y);
            Require(Mathf.Abs(back.z - 150f) < 1e-2f && Mathf.Abs(back.x) < 1e-2f, "Scene ↔ map conversion round-trips: " + back);

            // Оси бури в сцене: шаг вдоль dl идёт по ходу бури на kmPerMetre за метр.
            var go = new GameObject("RadiationStormProbe");
            try
            {
                var component = go.AddComponent<RoaRadiationStorm>();
                component.ApplyShift(new JObject { ["phase"] = "active", ["serverNow"] = 55500000L, ["sheltered"] = false, ["storm"] = storm }, "z_08_06");
                Require(component.Path != null && component.Frame.Valid && component.FrameLocationId == "z_08_06", "The component keeps the path and the frame of its location");
                Require(component.LocalAxes(out Vector2 dl, out Vector2 nl, out float kmPerMetre), "The storm has axes in the scene");
                Require(Mathf.Abs(kmPerMetre - 0.0625f) < 1e-4f, "A zone metre is 1/16 km along the storm: " + kmPerMetre);
                Vector2 from = frame.LocalToGlobal(10f, 20f);
                Vector2 to = frame.LocalToGlobal(10f + dl.x * 100f, 20f + dl.y * 100f);
                double moved = path.Along(to.x, to.y) - path.Along(from.x, from.y);
                Require(Math.Abs(moved - 100f * kmPerMetre) < 1e-3, "100 m along dl move the storm coordinate by 6.25 km: " + moved);
                Vector2 sideTo = frame.LocalToGlobal(10f + nl.x * 100f, 20f + nl.y * 100f);
                Require(Math.Abs(path.Along(sideTo.x, sideTo.y) - path.Along(from.x, from.y)) < 1e-3, "nl runs along the front");
                component.ApplyShift(new JObject { ["phase"] = "active", ["storm"] = null }, "z_08_06");
                Require(component.Path == null, "A shift without a storm clears the storm");
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }

            // Строка панели: где буря относительно игрока, а не фаза где-то в мире.
            JObject Shift(string phase, bool sheltered, JObject here) => new JObject
            {
                ["phase"] = phase, ["strength"] = 2, ["remainingMs"] = 60000, ["sheltered"] = sheltered, ["fieldsExcited"] = false,
                ["storm"] = new JObject { ["id"] = "shift_9", ["dirX"] = 1, ["dirY"] = 0, ["here"] = here }
            };
            string over = RoaKromkaShiftAndDetector.ShiftLine(Shift("active", false, new JObject { ["inside"] = true, ["intensity"] = 1, ["aheadKm"] = 0, ["etaSeconds"] = 0, ["passed"] = false }));
            Require(over.Contains("РАДИАЦИОННАЯ БУРЯ") && over.Contains("сила 2") && over.Contains("ИЩИТЕ УКРЫТИЕ"), "Under the storm the line calls for shelter: " + over);
            string shelter = RoaKromkaShiftAndDetector.ShiftLine(Shift("active", true, new JObject { ["inside"] = true, ["intensity"] = 1, ["aheadKm"] = 0, ["etaSeconds"] = 0, ["passed"] = false }));
            Require(shelter.Contains("УКРЫТИЕ") && !shelter.Contains("ИЩИТЕ"), "Under the storm in a shelter the line says so: " + shelter);
            string ahead = RoaKromkaShiftAndDetector.ShiftLine(Shift("active", false, new JObject { ["inside"] = false, ["intensity"] = 0, ["aheadKm"] = 34.4, ["etaSeconds"] = 115, ["passed"] = false }));
            Require(ahead.Contains("БУРЯ С ЗАПАДА") && ahead.Contains("34 км") && ahead.Contains("через 2 мин"), "Ahead of the storm the line says where from, how far and how soon: " + ahead);
            string warning = RoaKromkaShiftAndDetector.ShiftLine(Shift("warning", false, new JObject { ["inside"] = false, ["intensity"] = 0, ["aheadKm"] = 210, ["etaSeconds"] = 700, ["passed"] = false }));
            Require(warning.Contains("БУРЯ ИДЁТ С ЗАПАДА") && warning.Contains("через 12 мин"), "Before the storm enters the world the line warns: " + warning);
            string passed = RoaKromkaShiftAndDetector.ShiftLine(Shift("active", false, new JObject { ["inside"] = false, ["intensity"] = 0, ["aheadKm"] = 0, ["etaSeconds"] = 0, ["passed"] = true }));
            Require(passed.Contains("БУРЯ ПРОШЛА"), "Behind the storm the line says it passed: " + passed);
            Require(RoaRadiationStorm.EtaText(40) == "40 с" && RoaRadiationStorm.EtaText(300) == "5 мин", "ETA reads in seconds, then minutes");
            Require(RoaRadiationStormPath.FromSideText(0f) == "с севера" && RoaRadiationStormPath.FromSideText(270f) == "с запада"
                && RoaRadiationStormPath.FromSideText(135f) == "с юго-востока", "Sides are named by bearing");

            // Слой карты: глубь бури — зелёная муть, кромка — яркая линия, даль — пусто.
            Color32 deep = RoaStormMapOverlay.Tone(new RoaRadiationStormPath.Sample { Inside = true, Intensity = 1f, DepthKm = 20d }, 0.3f);
            Color32 edge = RoaStormMapOverlay.Tone(new RoaRadiationStormPath.Sample { Inside = true, Intensity = 0.5f, DepthKm = 0.1d }, 0.3f);
            Color32 far = RoaStormMapOverlay.Tone(new RoaRadiationStormPath.Sample { AheadKm = 40d, EtaMs = 1e5 }, 0.3f);
            Require(deep.a >= 120 && deep.g > deep.r && edge.a > deep.a && edge.g == 255 && far.a == 0,
                $"Map overlay tones: deep {deep}, edge {edge}, far {far}");

            // Подпись полосы на карте мира.
            string label = RoaWorldOverviewCanvas.StormLabelText(path, path.SampleAt(170, 130, 55200000));
            Require(label.StartsWith("БУРЯ С ") && label.Contains("сила 1") && label.Contains("до вас 4 мин"), "The world map names the storm and when it reaches the player: " + label);

            Debug.Log("[RADIATION STORM] OK: client storm path matches the server at 6 points, sector frame north is +Z like the gates, scene axes follow the storm, shift line/map overlay/world-map label describe the storm at the player.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("[RADIATION STORM] " + message);
        }
    }
}
#endif
