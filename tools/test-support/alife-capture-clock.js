'use strict';

if (process.env.NODE_ENV !== 'test' || !process.env.ALIFE_CAPTURE_CLOCK_FILE) {
  throw new Error('The A-Life capture clock is available only to its isolated test server');
}

const fs = require('node:fs');
const systemNow = Date.now.bind(Date);
let offsetMs = 0;

function refresh() {
  try {
    const text = fs.readFileSync(process.env.ALIFE_CAPTURE_CLOCK_FILE, 'utf8').trim();
    const value = Number(text);
    if (text && Number.isSafeInteger(value)) offsetMs = value;
  } catch (_) {
    // A concurrent fixture update may briefly hide the file; retain the last value.
  }
}

refresh();
Date.now = () => systemNow() + offsetMs;
setInterval(refresh, 40).unref();
