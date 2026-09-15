'use strict';

// Доставка Unity WebGL-сборки. Файлы сборки уже сжаты, поэтому отдаются как
// есть, а браузеру объявляется кодек: тогда распаковкой занимается он сам, а не
// загрузчик Unity на JavaScript (на 280-мегабайтном .data это минуты разницы на
// первом заходе).
//
// Сложность в имени: при включённом decompressionFallback Unity называет файлы
// `.unityweb` и не сообщает, brotli внутри или gzip. Кодек определяется по
// первым байтам файла, а `Content-Encoding` ставится только тому клиенту,
// который такой кодек принимает — остальным достаётся прежний путь с
// распаковкой в загрузчике.

const ENCODING_HEAD_BYTES = 4;

/**
 * gzip начинается с 1f 8b 08 и нулевых зарезервированных битов флага. Своей
 * сигнатуры у brotli нет, поэтому всё остальное внутри .unityweb — brotli:
 * несжатую сборку Unity называет без .unityweb вовсе.
 */
function sniffUnityWebEncoding(head = null) {
  if (!head || head.length < ENCODING_HEAD_BYTES) return '';
  if (head[0] === 0x1f && head[1] === 0x8b && head[2] === 0x08 && (head[3] & 0xe0) === 0) return 'gzip';
  return 'br';
}

/** Кодек предсжатого файла сборки по имени запроса; для .unityweb нужны первые байты. */
function encodingForRequest(requestPath = '', head = null) {
  const lower = String(requestPath || '').toLowerCase();
  if (lower.endsWith('.br')) return 'br';
  if (lower.endsWith('.gz')) return 'gzip';
  if (lower.endsWith('.unityweb')) return sniffUnityWebEncoding(head);
  return '';
}

/**
 * Разбор Accept-Encoding по RFC 9110: явная запись сильнее звёздочки, q=0
 * означает запрет. Клиент без заголовка считается принимающим только identity.
 */
function clientAcceptsEncoding(header = '', encoding = '') {
  const wanted = String(encoding || '').trim().toLowerCase();
  if (!wanted) return false;
  let wildcard = null;
  for (const part of String(header || '').split(',')) {
    const [nameRaw, ...params] = part.split(';');
    const name = String(nameRaw || '').trim().toLowerCase();
    if (!name) continue;
    const quality = params
      .map(row => String(row || '').trim().toLowerCase())
      .filter(row => row.startsWith('q='))
      .map(row => Number(row.slice(2)))
      .find(value => Number.isFinite(value));
    const weight = quality === undefined ? 1 : quality;
    if (name === wanted) return weight > 0;
    if (name === '*' && wildcard === null) wildcard = weight > 0;
  }
  return wildcard === true;
}

/** Тип содержимого сборки не зависит от того, сжат файл и каким кодеком. */
function unityContentType(requestPath = '') {
  const lower = String(requestPath || '').toLowerCase();
  if (/\.wasm(\.br|\.gz|\.unityweb)?$/.test(lower)) return 'application/wasm';
  if (/\.js(\.br|\.gz|\.unityweb)?$/.test(lower)) return 'application/javascript';
  if (/\.data(\.br|\.gz|\.unityweb)?$/.test(lower)) return 'application/octet-stream';
  if (/\.symbols\.json(\.br|\.gz|\.unityweb)?$/.test(lower)) return 'application/json';
  return '';
}

/**
 * Итог для одного ответа: какой кодек объявить и нужен ли Vary. Частичный
 * запрос к сжатому телу распаковать нельзя, поэтому на Range кодек не
 * объявляется — такой ответ развернёт загрузчик Unity.
 */
function unityDeliveryHeaders(requestPath = '', head = null, requestHeaders = {}) {
  const encoding = encodingForRequest(requestPath, head);
  const contentType = unityContentType(requestPath);
  if (!encoding) return { contentType, encoding: '', vary: false };
  const ranged = !!(requestHeaders && requestHeaders.range);
  const accepted = clientAcceptsEncoding(requestHeaders ? requestHeaders['accept-encoding'] : '', encoding);
  return { contentType, encoding: !ranged && accepted ? encoding : '', vary: true };
}

module.exports = {
  ENCODING_HEAD_BYTES,
  clientAcceptsEncoding,
  encodingForRequest,
  sniffUnityWebEncoding,
  unityContentType,
  unityDeliveryHeaders
};
