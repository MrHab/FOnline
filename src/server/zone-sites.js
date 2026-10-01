'use strict';

/**
 * Места внутри зон. Аванпост, точка добычи или кланбаза, перенесённые в сектор,
 * больше не отдельная локация за порталом: их площадка стоит прямо в зоне.
 * Площадка — повёрнутый прямоугольник в метрах сектора (строка `sites` определения
 * зоны, её пишет экспорт сцены Unity из KromkaSiteAuthoring). Id площадки — прежний
 * id места: по нему квесты, дом именного НПС и карта мира узнают место.
 *
 * Правила зоны действуют и на площадке. Исключение — безопасный островок
 * (`safe: true`): там не стреляют ни игроки, ни по игрокам, враждебные существа
 * внутрь не заходят. Так устроены квестовые места и будущие убежища.
 */

const MAX_SITES = 8;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round3(value) {
  return Math.round(finite(value) * 1000) / 1000;
}

/** Строка площадки в том виде, в каком её читает сервер; негодная — null. */
function normalizeSite(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  const halfX = finite(raw.halfX ?? finite(raw.size?.x) / 2);
  const halfZ = finite(raw.halfZ ?? finite(raw.size?.z) / 2);
  if (!id || !(halfX > 0) || !(halfZ > 0)) return null;
  return {
    id,
    name: String(raw.name || id).slice(0, 64),
    kind: String(raw.kind || '').slice(0, 32),
    safe: raw.safe === true,
    x: round3(raw.x ?? raw.position?.x),
    z: round3(raw.z ?? raw.position?.z),
    halfX: round3(halfX),
    halfZ: round3(halfZ),
    // Поворот — как у объектов определения: радианы вокруг Y, как eulerAngles.y в Unity.
    rotationY: round3(raw.rotationY ?? raw.rotation?.y)
  };
}

/** Площадки определения зоны, без дублей id. */
function normalizeSites(rows = []) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const sites = [];
  for (const row of rows) {
    const site = normalizeSite(row);
    if (!site || seen.has(site.id)) continue;
    seen.add(site.id);
    sites.push(site);
    if (sites.length >= MAX_SITES) break;
  }
  return sites;
}

/** Точка в осях площадки: x — вдоль её ширины, z — вдоль глубины. */
function siteLocalPoint(site, x, z) {
  const dx = finite(x) - site.x;
  const dz = finite(z) - site.z;
  const cos = Math.cos(site.rotationY);
  const sin = Math.sin(site.rotationY);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
}

/** Внутри ли точка площадки; margin расширяет (плюс) или сужает (минус) её со всех сторон. */
function siteContains(site, x, z, margin = 0) {
  if (!site) return false;
  const local = siteLocalPoint(site, x, z);
  return Math.abs(local.x) <= site.halfX + margin && Math.abs(local.z) <= site.halfZ + margin;
}

/** Площадка под точкой. Островок важнее обычной площадки, если они перекрылись. */
function siteAt(sites = [], x = 0, z = 0) {
  let found = null;
  for (const site of sites) {
    if (!siteContains(site, x, z)) continue;
    if (site.safe) return site;
    if (!found) found = site;
  }
  return found;
}

function safeSiteAt(sites = [], x = 0, z = 0) {
  for (const site of sites) if (site.safe && siteContains(site, x, z)) return site;
  return null;
}

/** Четыре угла площадки в метрах сектора (для проверок и отрисовки границы). */
function siteCorners(site) {
  const cos = Math.cos(site.rotationY);
  const sin = Math.sin(site.rotationY);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const lx = sx * site.halfX;
    const lz = sz * site.halfZ;
    // Обратный поворот к siteLocalPoint.
    return { x: round3(site.x + lx * cos + lz * sin), z: round3(site.z - lx * sin + lz * cos) };
  });
}

/** Что видит клиент: где площадка, как называется и безопасна ли. */
function publicSite(site) {
  return {
    id: site.id, name: site.name, kind: site.kind, safe: site.safe,
    x: site.x, z: site.z, halfX: site.halfX, halfZ: site.halfZ, rotationY: site.rotationY
  };
}

module.exports = {
  MAX_SITES,
  normalizeSite,
  normalizeSites,
  siteLocalPoint,
  siteContains,
  siteAt,
  safeSiteAt,
  siteCorners,
  publicSite
};
