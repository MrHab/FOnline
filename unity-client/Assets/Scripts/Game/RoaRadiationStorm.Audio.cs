using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Звук бури синтезируется в коде, как писк детектора и гул аномалий: вой
    /// ветра (громче и выше с приближением стены), раскаты грома (треск рядом,
    /// глухой гул вдали) и треск дозиметра под бурей вне укрытия. Клипы живут
    /// здесь, а не в RoaAudio: его набор сгенерированных клипов сверяют пробы.
    /// </summary>
    public sealed partial class RoaRadiationStorm
    {
        private const int SampleRate = 22050;

        private struct PendingThunder
        {
            public float At;
            public float Volume;
            public bool Close;
        }

        private AudioSource _windSource;
        private AudioSource _thunderSource;
        private AudioSource _geigerSource;
        private AudioClip _windClip;
        private AudioClip _clickClip;
        private AudioClip[] _thunderClips;
        private readonly List<PendingThunder> _thunder = new List<PendingThunder>();
        private float _geigerDebt;

        private void UpdateAudio(bool inWorld)
        {
            float presence = inWorld ? Presence : 0f;
            if (presence <= 0.001f && _thunder.Count == 0 && (_windSource == null || !_windSource.isPlaying)) return;
            EnsureAudio();
            float target = presence * (Sheltered ? 0.34f : 0.5f);
            _windSource.volume = Mathf.MoveTowards(_windSource.volume, target, Time.deltaTime * 0.35f);
            _windSource.pitch = 0.82f + presence * 0.4f;
            if (_windSource.volume > 0.001f && !_windSource.isPlaying) _windSource.Play();
            else if (_windSource.volume <= 0.001f && _windSource.isPlaying) _windSource.Stop();

            for (int i = _thunder.Count - 1; i >= 0; i--)
            {
                if (Time.time < _thunder[i].At) continue;
                PendingThunder row = _thunder[i];
                _thunder.RemoveAt(i);
                if (!inWorld) continue;
                AudioClip clip = _thunderClips[Random.Range(row.Close ? 0 : 1, _thunderClips.Length)];
                _thunderSource.pitch = row.Close ? Random.Range(0.92f, 1.08f) : Random.Range(0.62f, 0.82f);
                _thunderSource.PlayOneShot(clip, row.Volume * (Sheltered ? 0.7f : 1f));
            }

            // Дозиметр трещит только под бурей и вне укрытия: там, где идёт урон.
            if (inWorld && HasHere && Here.Inside && !Sheltered)
            {
                _geigerDebt += Time.deltaTime * Mathf.Lerp(6f, 26f, Here.Intensity);
                while (_geigerDebt >= 1f)
                {
                    _geigerDebt -= Random.Range(0.4f, 1.6f);
                    _geigerSource.pitch = Random.Range(0.85f, 1.25f);
                    _geigerSource.PlayOneShot(_clickClip, Random.Range(0.18f, 0.38f));
                }
            }
            else _geigerDebt = 0f;
        }

        private void QueueThunder(float delaySeconds, float volume, bool close)
        {
            _thunder.Add(new PendingThunder { At = Time.time + delaySeconds, Volume = Mathf.Clamp01(volume), Close = close });
        }

        private void EnsureAudio()
        {
            if (_windSource != null) return;
            _windSource = gameObject.AddComponent<AudioSource>();
            _windSource.playOnAwake = false;
            _windSource.loop = true;
            _windSource.spatialBlend = 0f;
            _windSource.volume = 0f;
            _windClip = BuildWind();
            _windSource.clip = _windClip;
            _thunderSource = gameObject.AddComponent<AudioSource>();
            _thunderSource.playOnAwake = false;
            _thunderSource.spatialBlend = 0f;
            _geigerSource = gameObject.AddComponent<AudioSource>();
            _geigerSource.playOnAwake = false;
            _geigerSource.spatialBlend = 0f;
            // Первый раскат — с треском (близкая молния), остальные — глухие дальние.
            _thunderClips = new[] { BuildThunder(11, true), BuildThunder(23, false), BuildThunder(37, false) };
            _clickClip = BuildClick();
        }

        private void ReleaseAudio()
        {
            if (_windClip != null) Destroy(_windClip);
            if (_clickClip != null) Destroy(_clickClip);
            if (_thunderClips != null) foreach (AudioClip clip in _thunderClips) if (clip != null) Destroy(clip);
            _thunderClips = null;
        }

        /// <summary>
        /// Вой ветра, 8 с по кругу: низкий гул, «свист» полосового шума с плавающей
        /// частотой и шипение песка. Концы сведены перекрёстным затуханием.
        /// </summary>
        private static AudioClip BuildWind()
        {
            const float seconds = 8f;
            int count = Mathf.RoundToInt(SampleRate * seconds);
            int fade = SampleRate / 2;
            int total = count + fade;
            var random = new System.Random(4127);
            // Слои считаются по отдельности и смешиваются по громкости (RMS), а не
            // по сырому размаху фильтров — иначе резонанс заглушил бы всё остальное.
            var rumble = new float[total * 2];
            var whistle = new float[total * 2];
            var hiss = new float[total * 2];
            var swell = new float[total];
            for (int channel = 0; channel < 2; channel++)
            {
                float low = 0f, low2 = 0f, svfLow = 0f, svfBand = 0f, previous = 0f;
                for (int i = 0; i < total; i++)
                {
                    float t = i / (float)SampleRate;
                    float white = (float)(random.NextDouble() * 2d - 1d);
                    low += (white - low) * 0.02f;
                    low2 += (low - low2) * 0.02f;
                    // Частота «свиста» гуляет с периодом, кратным длине петли.
                    float gust = 0.5f + 0.5f * Mathf.Sin(t / seconds * Mathf.PI * 4f) * Mathf.Sin(t / seconds * Mathf.PI * 6f + 1.3f + channel * 0.7f);
                    float f = 2f * Mathf.Sin(Mathf.PI * Mathf.Lerp(250f, 540f, gust) / SampleRate);
                    svfLow += f * svfBand;
                    float high = white - svfLow - 0.22f * svfBand;
                    svfBand += f * high;
                    rumble[i * 2 + channel] = low2;
                    whistle[i * 2 + channel] = svfBand;
                    hiss[i * 2 + channel] = white - previous;
                    previous = white;
                    if (channel == 0) swell[i] = 0.5f + 0.5f * gust;
                }
            }
            Normalize(rumble, 0.42f);
            Normalize(whistle, 0.12f);
            Normalize(hiss, 0.05f);
            var left = new float[total];
            var right = new float[total];
            for (int i = 0; i < total; i++)
            {
                float gain = 0.6f + 0.4f * swell[i];
                left[i] = rumble[i * 2] + (whistle[i * 2] + hiss[i * 2]) * gain;
                right[i] = rumble[i * 2 + 1] + (whistle[i * 2 + 1] + hiss[i * 2 + 1]) * gain;
            }
            var data = new float[count * 2];
            float peak = 0.0001f;
            for (int i = 0; i < count; i++)
            {
                float l = left[i], r = right[i];
                if (i < fade)
                {
                    float w = i / (float)fade;
                    l = left[i] * w + left[count + i] * (1f - w);
                    r = right[i] * w + right[count + i] * (1f - w);
                }
                data[i * 2] = l;
                data[i * 2 + 1] = r;
                peak = Mathf.Max(peak, Mathf.Abs(l), Mathf.Abs(r));
            }
            for (int i = 0; i < data.Length; i++) data[i] = data[i] / peak * 0.85f;
            AudioClip clip = AudioClip.Create("StormWind", count, 2, SampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }

        /// <summary>Привести слой к заданной громкости (среднеквадратичной).</summary>
        private static void Normalize(float[] data, float rms)
        {
            double sum = 0d;
            for (int i = 0; i < data.Length; i++) sum += data[i] * data[i];
            float current = (float)System.Math.Sqrt(sum / System.Math.Max(1, data.Length));
            if (current < 1e-7f) return;
            float scale = rms / current;
            for (int i = 0; i < data.Length; i++) data[i] *= scale;
        }

        /// <summary>Раскат: треск (близко) и перекатывающийся низкий гул с затуханием.</summary>
        private static AudioClip BuildThunder(int seed, bool crack)
        {
            const float seconds = 4.6f;
            int count = Mathf.RoundToInt(SampleRate * seconds);
            var data = new float[count];
            var random = new System.Random(seed);
            var rolls = new float[6];
            for (int i = 0; i < rolls.Length; i++) rolls[i] = (float)(0.05d + random.NextDouble() * 2.2d);
            float brown = 0f, low = 0f, peak = 0.0001f;
            for (int i = 0; i < count; i++)
            {
                float t = i / (float)SampleRate;
                float white = (float)(random.NextDouble() * 2d - 1d);
                brown = Mathf.Clamp(brown * 0.995f + white * 0.06f, -1f, 1f);
                low += (brown - low) * 0.12f;
                float envelope = 0f;
                foreach (float at in rolls)
                {
                    float d = t - at;
                    if (d >= 0f) envelope += Mathf.Exp(-d * 2.2f) * (1f - Mathf.Exp(-d * 30f));
                }
                envelope *= Mathf.Exp(-t / 1.6f);
                float value = low * envelope * 2.2f;
                if (crack && t < 0.22f) value += white * Mathf.Exp(-t * 26f) * 0.9f + brown * Mathf.Exp(-t * 9f) * 0.8f;
                data[i] = value;
                peak = Mathf.Max(peak, Mathf.Abs(value));
            }
            for (int i = 0; i < count; i++) data[i] = data[i] / peak * 0.92f;
            AudioClip clip = AudioClip.Create(crack ? "StormThunderClose" : "StormThunderFar", count, 1, SampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }

        /// <summary>Щелчок дозиметра: короткий затухающий импульс.</summary>
        private static AudioClip BuildClick()
        {
            int count = SampleRate / 180;
            var data = new float[count];
            var random = new System.Random(71);
            for (int i = 0; i < count; i++)
            {
                float t = i / (float)SampleRate;
                data[i] = ((float)(random.NextDouble() * 2d - 1d) * 0.5f + Mathf.Sin(t * Mathf.PI * 2f * 3100f)) * Mathf.Exp(-t * 1400f) * 0.8f;
            }
            AudioClip clip = AudioClip.Create("StormGeigerClick", count, 1, SampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }
    }
}
