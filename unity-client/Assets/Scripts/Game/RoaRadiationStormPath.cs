using System;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Путь радиационной бури выброса — та же формула, что у сервера
    /// (src/server/radiation-storm.js). Сервер присылает параметры в
    /// artifactState.shift.storm, клиент по ним сам двигает фронт каждый кадр:
    /// в зоне, на миникарте и на карте мира буря стоит в одной и той же точке.
    ///
    /// Координаты карты — километры: x на восток, y на юг. p — расстояние вдоль
    /// направления движения бури, q — поперёк. Передняя кромка — lead0 + v·t с
    /// рваным горбом по q, задняя — на widthKm позади со своим горбом.
    /// </summary>
    public sealed class RoaRadiationStormPath
    {
        public struct Wave
        {
            public double Amp;
            public double K;
            public double Lead;
            public double Trail;
        }

        public struct Sample
        {
            public bool Inside;
            public float Intensity;
            /// <summary>Сколько километров до передней кромки; 0 — буря уже здесь или прошла.</summary>
            public double AheadKm;
            /// <summary>Сколько километров задняя кромка уже отошла от точки (прошла).</summary>
            public double BehindKm;
            /// <summary>Через сколько миллисекунд сюда дойдёт передняя кромка.</summary>
            public double EtaMs;
            /// <summary>Сколько километров вглубь бури от передней кромки (внутри).</summary>
            public double DepthKm;
        }

        public const double LeadWallKm = 4d;
        public const double TrailFadeKm = 12d;

        public string Id = string.Empty;
        public int Strength = 1;
        public string Phase = "calm";
        public double DirX = 1d;
        public double DirY;
        public double HeadingDeg;
        public double WidthKm = 60d;
        public double WaveKm = 10d;
        public Wave[] Waves = Array.Empty<Wave>();
        public double Lead0Km;
        public double SpeedKmPerSec = 0.25d;
        public long WarningStartAt;
        public long ActiveStartAt;
        public long ActiveEndAt;
        public long AfterglowEndAt;
        public double MinX;
        public double MinY;
        public double MaxX = 380d;
        public double MaxY = 300d;

        /// <summary>Разобрать shift.storm; null — бури нет.</summary>
        public static RoaRadiationStormPath Parse(JObject storm)
        {
            if (storm == null || string.IsNullOrEmpty(storm["id"]?.ToString())) return null;
            var path = new RoaRadiationStormPath
            {
                Id = storm["id"].ToString(),
                Strength = Mathf.Clamp(storm["strength"]?.Value<int>() ?? 1, 1, 3),
                Phase = storm["phase"]?.ToString() ?? "calm",
                DirX = Number(storm, "dirX", 1d),
                DirY = Number(storm, "dirY", 0d),
                HeadingDeg = Number(storm, "headingDeg", 0d),
                WidthKm = Math.Max(1d, Number(storm, "widthKm", 60d)),
                WaveKm = Math.Max(0d, Number(storm, "waveKm", 10d)),
                Lead0Km = Number(storm, "lead0Km", 0d),
                SpeedKmPerSec = Math.Max(1e-6d, Number(storm, "speedKmPerSec", 0.25d)),
                WarningStartAt = storm["warningStartAt"]?.Value<long>() ?? 0L,
                ActiveStartAt = storm["activeStartAt"]?.Value<long>() ?? 0L,
                ActiveEndAt = storm["activeEndAt"]?.Value<long>() ?? 0L,
                AfterglowEndAt = storm["afterglowEndAt"]?.Value<long>() ?? 0L
            };
            // Направление берётся как есть (сервер округляет его до 6 знаков и считает
            // по округлённому): нормировка здесь разошлась бы с сервером на метры.
            if (Math.Abs(path.DirX) + Math.Abs(path.DirY) < 1e-6d) { path.DirX = 1d; path.DirY = 0d; }
            if (storm["waves"] is JArray waves)
            {
                path.Waves = new Wave[waves.Count];
                for (int i = 0; i < waves.Count; i++)
                {
                    var row = waves[i] as JObject;
                    path.Waves[i] = new Wave
                    {
                        Amp = Number(row, "amp", 0d),
                        K = Number(row, "k", 0d),
                        Lead = Number(row, "lead", 0d),
                        Trail = Number(row, "trail", 0d)
                    };
                }
            }
            if (storm["bounds"] is JObject bounds)
            {
                path.MinX = Number(bounds, "minX", 0d);
                path.MinY = Number(bounds, "minY", 0d);
                path.MaxX = Number(bounds, "maxX", 380d);
                path.MaxY = Number(bounds, "maxY", 300d);
            }
            return path;
        }

        /// <summary>Передняя линия (км вдоль направления) в момент серверного времени nowMs.</summary>
        public double LeadLineKm(double nowMs)
        {
            return Lead0Km + SpeedKmPerSec * (nowMs - ActiveStartAt) / 1000d;
        }

        public double WaveOffset(double q, bool trail)
        {
            double offset = 0d;
            for (int i = 0; i < Waves.Length; i++)
                offset += Waves[i].Amp * Math.Sin(Waves[i].K * q + (trail ? Waves[i].Trail : Waves[i].Lead));
            return offset;
        }

        public double Along(double x, double y) { return x * DirX + y * DirY; }
        public double Across(double x, double y) { return -x * DirY + y * DirX; }

        /// <summary>Точка карты по координатам бури p (вдоль) и q (поперёк).</summary>
        public Vector2 PointAt(double p, double q)
        {
            return new Vector2((float)(p * DirX - q * DirY), (float)(p * DirY + q * DirX));
        }

        /// <summary>Передняя кромка в точке q (км вдоль направления).</summary>
        public double LeadAt(double q, double nowMs) { return LeadLineKm(nowMs) + WaveOffset(q, false); }

        /// <summary>Задняя кромка в точке q (км вдоль направления).</summary>
        public double TrailAt(double q, double nowMs) { return LeadLineKm(nowMs) - WidthKm + WaveOffset(q, true); }

        public Sample SampleAt(double x, double y, double nowMs)
        {
            double p = Along(x, y);
            double q = Across(x, y);
            double lead = LeadAt(q, nowMs);
            double trail = TrailAt(q, nowMs);
            var sample = new Sample();
            if (p > lead)
            {
                sample.AheadKm = p - lead;
                sample.EtaMs = sample.AheadKm / SpeedKmPerSec * 1000d;
                return sample;
            }
            if (p < trail)
            {
                sample.BehindKm = trail - p;
                return sample;
            }
            sample.Inside = true;
            sample.DepthKm = lead - p;
            double wall = 0.45d + 0.55d * Smooth(0d, LeadWallKm, lead - p);
            double tail = 0.35d + 0.65d * Smooth(0d, TrailFadeKm, p - trail);
            sample.Intensity = (float)Math.Min(wall, tail);
            return sample;
        }

        /// <summary>Откуда идёт буря — азимут по часовой от севера карты, градусы.</summary>
        public float ComingFromBearingDeg
        {
            get
            {
                // Вектор «откуда» = −направление; север карты — −y.
                double bearing = Math.Atan2(-DirX, DirY) * 180d / Math.PI;
                return (float)((bearing % 360d + 360d) % 360d);
            }
        }

        /// <summary>«с запада», «с северо-востока» — откуда идёт буря.</summary>
        public string ComingFromText
        {
            get { return FromSideText(ComingFromBearingDeg); }
        }

        public static string FromSideText(float bearingDeg)
        {
            string[] names =
            {
                "с севера", "с северо-востока", "с востока", "с юго-востока",
                "с юга", "с юго-запада", "с запада", "с северо-запада"
            };
            int index = Mathf.RoundToInt(((bearingDeg % 360f) + 360f) % 360f / 45f) % 8;
            return names[index];
        }

        private static double Smooth(double edge0, double edge1, double value)
        {
            double t = Math.Max(0d, Math.Min(1d, (value - edge0) / (edge1 - edge0)));
            return t * t * (3d - 2d * t);
        }

        private static double Number(JObject row, string key, double fallback)
        {
            JToken token = row?[key];
            if (token == null || token.Type == JTokenType.Null) return fallback;
            try { return token.Value<double>(); }
            catch (FormatException) { return fallback; }
        }
    }

    /// <summary>
    /// Рамка сцены: как точка сцены (x, z) ложится на карту мира. gx = ox + x·kx,
    /// gy = oy + z·kz. Её присылает сервер вместе с бурей (shift.storm.frame): у
    /// сектора север — −Z (малые tz, там северные ворота), поэтому kz &gt; 0; у места
    /// со своей Unity-сценой север — +Z, kz &lt; 0.
    /// </summary>
    public struct RoaRadiationStormFrame
    {
        public bool Valid;
        public double Ox;
        public double Oy;
        public double Kx;
        public double Kz;

        public static RoaRadiationStormFrame Parse(JObject frame)
        {
            if (frame == null) return default;
            double kx = frame["kx"]?.Value<double>() ?? 0d;
            double kz = frame["kz"]?.Value<double>() ?? 0d;
            if (Math.Abs(kx) < 1e-9d || Math.Abs(kz) < 1e-9d) return default;
            return new RoaRadiationStormFrame
            {
                Valid = true,
                Ox = frame["ox"]?.Value<double>() ?? 0d,
                Oy = frame["oy"]?.Value<double>() ?? 0d,
                Kx = kx,
                Kz = kz
            };
        }

        public Vector2 LocalToGlobal(float x, float z)
        {
            return new Vector2((float)(Ox + x * Kx), (float)(Oy + z * Kz));
        }

        public Vector3 GlobalToLocal(double gx, double gy, float y = 0f)
        {
            return new Vector3((float)((gx - Ox) / Kx), y, (float)((gy - Oy) / Kz));
        }

        /// <summary>Метров сцены на километр карты вдоль x.</summary>
        public float MetresPerKm { get { return (float)(1d / Math.Abs(Kx)); } }

        public bool SameAs(RoaRadiationStormFrame other)
        {
            return Valid == other.Valid && Math.Abs(Ox - other.Ox) < 1e-6d && Math.Abs(Oy - other.Oy) < 1e-6d
                && Math.Abs(Kx - other.Kx) < 1e-9d && Math.Abs(Kz - other.Kz) < 1e-9d;
        }
    }
}
