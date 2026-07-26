'use strict';

if (process.env.NODE_ENV !== 'test') {
  throw new Error('The controlled clock preload is test-only');
}

const systemNow = Date.now.bind(Date);
let offsetMs = 0;

Date.now = () => systemNow() + offsetMs;

process.on('message', message => {
  if (!message || message.type !== 'realm-test-clock-offset') return;
  const nextOffset = Number(message.offsetMs);
  offsetMs = Number.isFinite(nextOffset) ? nextOffset : 0;
  if (typeof process.send === 'function') {
    process.send({ type: 'realm-test-clock-ready', offsetMs });
  }
});
