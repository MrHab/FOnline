using UnityEngine;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaCombatPresentationFx
    {
        private void UpdateTracers(float now)
        {
            for (int i = 0; i < _tracers.Count; i++)
            {
                TracerFx fx = _tracers[i];
                if (!fx.Active) continue;
                float t = Mathf.Clamp01((now - fx.Started) / Mathf.Max(0.01f, fx.Life));
                if (t >= 1f)
                {
                    fx.Active = false;
                    fx.Root.SetActive(false);
                }
                else UpdateTracer(fx, t);
            }
        }

        private void UpdateFlashes(float now)
        {
            for (int i = 0; i < _flashes.Count; i++)
            {
                FlashFx fx = _flashes[i];
                if (!fx.Active) continue;
                float t = Mathf.Clamp01((now - fx.Started) / Mathf.Max(0.01f, fx.Life));
                if (t >= 1f)
                {
                    fx.Active = false;
                    fx.Root.SetActive(false);
                    continue;
                }

                float flash = 1f - t;
                float stretch = Mathf.Lerp(1f, 1.35f, Mathf.Sin(t * Mathf.PI));
                fx.Root.transform.localScale = new Vector3(
                    fx.BaseScale.x * Mathf.Lerp(1f, 0.18f, t),
                    fx.BaseScale.y * Mathf.Lerp(1f, 0.18f, t),
                    fx.BaseScale.z * flash * stretch);
                fx.Root.transform.Rotate(0f, 0f, 460f * Time.unscaledDeltaTime, Space.Self);
                SetMaterialColor(fx.Material, fx.Color, 0.98f * flash * flash, 3.5f);
                fx.Light.intensity = 3.6f * flash * flash;
            }
        }

        private void UpdateImpacts(float now)
        {
            for (int i = 0; i < _impacts.Count; i++)
            {
                ImpactFx fx = _impacts[i];
                if (!fx.Active || now < fx.Started) continue;
                if (!fx.Visible)
                {
                    fx.Visible = true;
                    fx.Root.SetActive(true);
                }

                float t = Mathf.Clamp01((now - fx.Started) / Mathf.Max(0.01f, fx.Life));
                if (t >= 1f)
                {
                    fx.Active = false;
                    fx.Visible = false;
                    fx.Root.SetActive(false);
                }
                else UpdateImpact(fx, t);
            }
        }

        private void UpdateTracer(TracerFx fx, float t)
        {
            float distance = Vector3.Distance(fx.Start, fx.End);
            float head = Mathf.Clamp01(0.08f + t * 1.34f);
            float visibleFraction = Mathf.Clamp(2.4f / Mathf.Max(0.2f, distance), 0.08f, 0.38f);
            float tail = Mathf.Max(0f, head - visibleFraction);
            fx.Line.SetPosition(0, Vector3.LerpUnclamped(fx.Start, fx.End, tail));
            fx.Line.SetPosition(1, Vector3.LerpUnclamped(fx.Start, fx.End, head));
            float fade = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.66f, 1f, t));
            SetMaterialAlpha(fx.Material, 0.96f * fade);
        }

        private void ConfigureImpact(ImpactFx fx, Vector3 shotDirection, string weaponId)
        {
            SetMaterialColor(fx.CoreMaterial, fx.Color, 0.96f, 2.8f);
            SetMaterialColor(fx.SparkMaterial, Color.Lerp(fx.Color, Color.white, 0.32f), 0.94f, 3.2f);
            SetMaterialColor(fx.DustMaterial,
                Color.Lerp(new Color(0.48f, 0.37f, 0.25f), fx.Color, 0.16f), 0.46f, 0.35f);
            float strength = weaponId == "rocketLauncher" ? 1.45f
                : weaponId == "shotgun" ? 1.2f : 1f;
            Vector3 side = Vector3.Cross(Vector3.up, shotDirection);
            if (side.sqrMagnitude < 0.001f) side = Vector3.right;
            side.Normalize();
            for (int i = 0; i < fx.Sparks.Length; i++)
            {
                float angle = (i + Next01() * 0.45f) / fx.Sparks.Length * Mathf.PI * 2f;
                Vector3 spread = side * Mathf.Cos(angle) + Vector3.up * Mathf.Sin(angle);
                Vector3 velocity = (spread * 0.86f - shotDirection * 0.24f + Vector3.up * 0.38f).normalized;
                fx.Velocities[i] = velocity * Mathf.Lerp(1.1f, 2.4f, Next01()) * strength * Mathf.Max(0.5f, fx.Scale);
                fx.Sparks[i].SetPosition(0, Vector3.zero);
                fx.Sparks[i].SetPosition(1, velocity * 0.035f);
            }
            fx.Core.transform.localScale = Vector3.one * 0.08f;
            if (fx.Dust != null)
                fx.Dust.transform.localScale = new Vector3(0.10f, 0.018f, 0.10f);
        }

        private void UpdateImpact(ImpactFx fx, float t)
        {
            float fade = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.35f, 1f, t));
            float burst = Mathf.Sin(Mathf.Clamp01(t / 0.32f) * Mathf.PI * 0.5f);
            fx.Core.transform.localScale = Vector3.one * Mathf.Lerp(0.055f, 0.24f, burst) * fade * Mathf.Max(0.5f, fx.Scale);
            SetMaterialColor(fx.CoreMaterial, fx.Color, 0.94f * fade, 2.8f);
            SetMaterialAlpha(fx.SparkMaterial, 0.92f * fade);
            if (fx.Dust != null)
            {
                float dustFade = (1f - Mathf.SmoothStep(0f, 1f, t)) * 0.48f;
                float dustRadius = Mathf.Lerp(0.10f, 0.46f, Mathf.Sqrt(t))
                    * Mathf.Max(0.55f, fx.Scale);
                fx.Dust.transform.localScale = new Vector3(dustRadius, 0.018f, dustRadius);
                SetMaterialAlpha(fx.DustMaterial, dustFade);
            }
            for (int i = 0; i < fx.Sparks.Length; i++)
            {
                Vector3 head = fx.Velocities[i] * (t * 0.24f) + Vector3.down * (t * t * 0.18f);
                Vector3 tail = head - fx.Velocities[i].normalized * Mathf.Lerp(0.14f, 0.025f, t);
                fx.Sparks[i].SetPosition(0, tail);
                fx.Sparks[i].SetPosition(1, head);
            }
        }

        private int CountTracers()
        {
            int count = 0;
            for (int i = 0; i < _tracers.Count; i++) if (_tracers[i].Active) count++;
            return count;
        }

        private int CountFlashes()
        {
            int count = 0;
            for (int i = 0; i < _flashes.Count; i++) if (_flashes[i].Active) count++;
            return count;
        }

        private int CountImpacts()
        {
            int count = 0;
            for (int i = 0; i < _impacts.Count; i++) if (_impacts[i].Active) count++;
            return count;
        }
    }
}
