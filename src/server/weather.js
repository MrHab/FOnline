'use strict';

// Погода Кромки: детерминированное поле облачности и дождя над картой мира.
//
// Сервер ничего не хранит. Дождь в точке карты в любой момент выводится из зерна
// мира и часов: облачные фронты — это трёхмерный шум (x, z, время), который ветер
// сносит через карту. Поэтому соседние зоны видят один и тот же фронт, а перезапуск
// сервера погоду не сбивает. Влажность, грязь и лужи накапливаются по истории
// дождя в этой точке за последние часы, её пересчёт — пара сотен выборок шума.
//
// Геймплей берёт из снимка только effects: множители скорости пешком, слуха и
// зрения врагов и меткости стрельбы. Клиент рисует дождь и мокрую землю по тем
// же числам и тем же множителем предсказывает свою скорость.

const WEATHER_SCHEMA = 'kromka.weather.v1';

const DEFAULT_WEATHER_CONFIG = Object.freeze({
  // Размер облачного фронта в точках карты (1 точка = 1 км, клетка карты — 10 точек).
  frontPoints: 64,
  // Как быстро ветер сносит фронты, точек карты в час реального времени.
  windPointsPerHour: 38,
  // За сколько минут фронт заметно меняет форму на месте.
  evolveMinutes: 70,
  // Порог шума, выше которого начинается дождь, и ширина перехода к ливню.
  rainThreshold: 0.6,
  rainBand: 0.2,
  // Облака приходят раньше дождя: пасмурно уже на столько ниже порога.
  cloudLead: 0.17,
  // Намокание и высыхание земли, доля в минуту при полном дожде / без дождя.
  wetGainPerMinute: 0.11,
  dryPerMinute: 0.028,
  // Грязь набирается медленнее намокания и держится дольше.
  mudGainPerMinute: 0.045,
  mudDryPerMinute: 0.011,
  historyMinutes: 180,
  stepMinutes: 1
});

// Предельные штрафы при полном дожде / полной грязи. Тот же набор чисел знает
// клиент (RoaWeather.cs): он предсказывает свою скорость по effects снимка.
const WEATHER_EFFECT_LIMITS = Object.freeze({
  mudMovePenalty: 0.14,
  rainHearingPenalty: 0.45,
  rainVisionPenalty: 0.22,
  rainRangedPenalty: 0.1
});

const WEATHER_STATES = Object.freeze(['clear', 'overcast', 'rain', 'storm']);

// Как раскисает грунт зоны (zone-graph: ground). Речной суглинок и мел — худшая
// грязь, осыпь и спёкшееся стекло почти не держат воду, бетон и города мощёные.
const GROUND_MUD_FACTORS = Object.freeze({
  river_loam: 1,
  chalk: 0.9,
  zero_soil: 0.8,
  tract_dust: 0.75,
  silent_ring: 0.6,
  iron_scree: 0.4,
  wet_concrete: 0.3,
  fused_soil: 0.25,
  city: 0.3
});
const DEFAULT_GROUND_MUD_FACTOR = 0.7;

// Места под крышей и под землёй: лаборатории, бункеры, туннели. Там не льёт.
const SHELTERED_AMBIENT_PROFILE = /^sealed-[a-z]+-laboratory$|^automated-command-bunker$|^buried-installation$|^scratching-cable-tunnels$|^chalk-underground-water$/;

function groundMudFactor(ground) {
  const factor = GROUND_MUD_FACTORS[String(ground || '')];
  return Number.isFinite(factor) ? factor : DEFAULT_GROUND_MUD_FACTOR;
}

function weatherShelteredLocation(location) {
  if (!location || typeof location !== 'object') return false;
  if (location.lab === true || location.indoor === true || location.underground === true) return true;
  return SHELTERED_AMBIENT_PROFILE.test(String(location.ambientProfile || ''));
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function seedHash(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function latticeValue(seed, x, y, z) {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise3(seed, x, y, z) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);
  const lerp = (a, b, t) => a + (b - a) * t;
  const corner = (dx, dy, dz) => latticeValue(seed, x0 + dx, y0 + dy, z0 + dz);
  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), tx);
  const x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), tx);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), tx);
  const x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

function normalizeOverride(override) {
  if (!override) return null;
  const presets = {
    clear: { rain: 0, cloud: 0, wetness: 0, mud: 0 },
    overcast: { rain: 0, cloud: 0.8, wetness: 0, mud: 0 },
    wet: { rain: 0, cloud: 0.55, wetness: 0.85, mud: 0.7 },
    rain: { rain: 0.55, cloud: 1, wetness: 0.7, mud: 0.45 },
    storm: { rain: 1, cloud: 1, wetness: 1, mud: 1 }
  };
  if (typeof override === 'string') return presets[override.trim().toLowerCase()] || null;
  if (typeof override !== 'object') return null;
  return {
    rain: clamp01(override.rain),
    cloud: clamp01(override.cloud ?? override.rain),
    wetness: clamp01(override.wetness ?? override.rain),
    mud: clamp01(override.mud ?? override.wetness ?? override.rain)
  };
}

function weatherStateName(cloud, rain) {
  if (rain >= 0.72) return 'storm';
  if (rain >= 0.08) return 'rain';
  if (cloud >= 0.45) return 'overcast';
  return 'clear';
}

// Лужи стоят там, где земля уже напиталась: мокрая поверхность плюс грязь.
function puddleLevel(wetness, mud) {
  return round3(smoothstep(0.5, 0.95, wetness) * smoothstep(0.2, 0.7, mud));
}

/**
 * Множители геймплея из снимка погоды: грязь (уже с поправкой на грунт) замедляет
 * шаг, дождь глушит шаги для врагов, сокращает их обзор и сбивает прицел. В укрытии
 * погода не действует.
 */
function weatherEffects(sample) {
  const limits = WEATHER_EFFECT_LIMITS;
  if (!sample || sample.sheltered) {
    return { moveSpeedMultiplier: 1, hearingMultiplier: 1, visionMultiplier: 1, rangedAccuracyMultiplier: 1 };
  }
  const mud = clamp01(sample.mud);
  const rain = clamp01(sample.rain);
  return {
    moveSpeedMultiplier: round3(1 - limits.mudMovePenalty * mud),
    hearingMultiplier: round3(1 - limits.rainHearingPenalty * rain),
    visionMultiplier: round3(1 - limits.rainVisionPenalty * rain),
    rangedAccuracyMultiplier: round3(1 - limits.rainRangedPenalty * rain)
  };
}

function createWeather(options = {}) {
  const config = { ...DEFAULT_WEATHER_CONFIG, ...(options.config || {}) };
  const seed = seedHash(options.seed ?? 'kromka-weather');
  const windSeed = seedHash(`${options.seed ?? 'kromka-weather'}:wind`);
  const windAngle = latticeValue(windSeed, 1, 2, 3) * Math.PI * 2;
  const windDir = { x: Math.cos(windAngle), z: Math.sin(windAngle) };
  let override = normalizeOverride(options.override);

  // Сдвиг фронтов ветром: основной снос плюс медленное покачивание поперёк,
  // чтобы фронты не шли по линейке.
  function windOffset(minutes) {
    const hours = minutes / 60;
    const along = config.windPointsPerHour * hours;
    const sway = config.frontPoints * 0.35 * Math.sin(hours * 0.37);
    return {
      x: windDir.x * along - windDir.z * sway,
      z: windDir.z * along + windDir.x * sway
    };
  }

  function rainPotential(x, z, minutes) {
    const offset = windOffset(minutes);
    const u = (Number(x) - offset.x) / config.frontPoints;
    const v = (Number(z) - offset.z) / config.frontPoints;
    const w = minutes / config.evolveMinutes;
    return valueNoise3(seed, u, v, w) * 0.68
      + valueNoise3(seed ^ 0x9e3779b9, u * 2.07 + 17.3, v * 2.07 - 5.1, w * 1.6) * 0.32;
  }

  function rainAt(x, z, minutes) {
    const potential = rainPotential(x, z, minutes);
    return {
      rain: smoothstep(config.rainThreshold, config.rainThreshold + config.rainBand, potential),
      cloud: smoothstep(config.rainThreshold - config.cloudLead, config.rainThreshold, potential)
    };
  }

  // Влажность и грязь — интеграл истории дождя в точке. Шаг — минута, начало —
  // сухая земля за historyMinutes до момента: этого хватает, чтобы забыть любой
  // дождь (полное высыхание грязи — около полутора часов).
  function groundAt(x, z, minutes) {
    const steps = Math.ceil(config.historyMinutes / config.stepMinutes);
    const dt = config.stepMinutes;
    let wetness = 0;
    let mud = 0;
    for (let i = steps; i >= 1; i--) {
      const { rain } = rainAt(x, z, minutes - i * dt);
      wetness += rain * config.wetGainPerMinute * dt * (1 - wetness)
        - (1 - rain) * config.dryPerMinute * dt * wetness;
      wetness = clamp01(wetness);
      const mudTarget = Math.pow(wetness, 1.3);
      mud += mudTarget > mud
        ? (mudTarget - mud) * Math.min(1, config.mudGainPerMinute * dt * (0.4 + rain))
        : (mudTarget - mud) * Math.min(1, config.mudDryPerMinute * dt);
      mud = clamp01(mud);
    }
    return { wetness, mud };
  }

  /**
   * Снимок погоды в точке карты мира (x, z — точки карты, как у узлов
   * data/global-map.json). `sheltered` — зона под крышей или под землёй: там не
   * льёт и погода не действует, но клиент знает, что снаружи. `mudFactor` — как
   * раскисает грунт зоны (groundMudFactor); лужи от него не зависят.
   */
  function sampleAt(x, z, now = Date.now(), sampleOptions = {}) {
    const nowMs = Number(now);
    const minutes = nowMs / 60000;
    let rain;
    let cloud;
    let wetness;
    let mud;
    if (override) {
      ({ rain, cloud, wetness, mud } = override);
    } else {
      ({ rain, cloud } = rainAt(x, z, minutes));
      ({ wetness, mud } = groundAt(x, z, minutes));
      cloud = Math.max(cloud, rain);
    }
    const trendRain = override ? rain : rainAt(x, z, minutes + 5).rain;
    const sheltered = Boolean(sampleOptions.sheltered);
    const mudFactor = clamp01(sampleOptions.mudFactor ?? 1);
    const sample = {
      schema: WEATHER_SCHEMA,
      state: weatherStateName(cloud, rain),
      rain: round3(rain),
      cloud: round3(cloud),
      wetness: round3(wetness),
      mud: round3(mud * mudFactor),
      puddles: puddleLevel(wetness, mud),
      trend: trendRain > rain + 0.02 ? 'rising' : (trendRain < rain - 0.02 ? 'falling' : 'steady'),
      wind: {
        x: round3(windDir.x),
        z: round3(windDir.z),
        speed: round3(0.35 + 0.65 * Math.max(rain, cloud * 0.6))
      },
      sheltered,
      forced: Boolean(override),
      sampledAt: nowMs
    };
    sample.effects = weatherEffects(sample);
    return sample;
  }

  function setOverride(value) {
    override = normalizeOverride(value);
    return override;
  }

  return {
    sampleAt,
    rainAt: (x, z, now = Date.now()) => rainAt(x, z, Number(now) / 60000),
    setOverride,
    get override() { return override; },
    config
  };
}

// Снимок изменился настолько, что его стоит разослать: сменилось состояние или
// какое-то число ушло дальше порога. Мелкая дрожь влажности клиенту не нужна.
function weatherChanged(previous, next, threshold = 0.04) {
  if (!previous) return true;
  if (!next) return false;
  if (previous.state !== next.state || previous.sheltered !== next.sheltered) return true;
  if (previous.forced !== next.forced) return true;
  for (const key of ['rain', 'cloud', 'wetness', 'mud', 'puddles']) {
    if (Math.abs(Number(previous[key] || 0) - Number(next[key] || 0)) >= threshold) return true;
  }
  return false;
}

module.exports = {
  WEATHER_SCHEMA,
  WEATHER_STATES,
  WEATHER_EFFECT_LIMITS,
  GROUND_MUD_FACTORS,
  DEFAULT_WEATHER_CONFIG,
  createWeather,
  normalizeWeatherOverride: normalizeOverride,
  groundMudFactor,
  weatherShelteredLocation,
  weatherEffects,
  weatherChanged,
  puddleLevel
};
