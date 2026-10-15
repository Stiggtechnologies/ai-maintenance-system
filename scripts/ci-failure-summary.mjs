// Bounded, redacted metadata for synthetic CI failures when full logs are too large.
import { readFileSync } from 'node:fs';
const text = readFileSync(process.argv[2], 'utf8')
  .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
  .replace(/%0A/gi, '\n').replace(/%0D/gi, '\r');
const useful = text.split(/\r?\n/).filter(line =>
  !line.includes('::error ') &&
  /(?:\bERROR:|\bError:|FAILED at line|expected HTTP|^expected |^\s*(?:Expected|Received|Locator)(?: [a-z]+)?:|\btests\/.*\.spec\.ts:\d+)/.test(line)
);
const summary = [...new Set(useful.map(line => line.trim()))].slice(0, 6).join(' | ')
  .replace(/\b(?:authorization|password|api[_-]?key|service_role_key|jwt_secret|access_token|refresh_token)\b[^|]*/gi, '[redacted auth detail]')
  .replace(/\b[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/g, '[redacted token]')
  .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted key]')
  .replace(/https?:\/\/[^\s|]+/g, '[url]')
  .replace(/[\w.+-]+@[\w.-]+/g, '[email]')
  .replace(/\s+/g, ' ')
  .slice(0, 400);
console.log(summary || 'Failure recorded; inspect retained synthetic test diagnostics.');
