/**
 * Simple device fingerprint generator.
 * Combines user agent and screen dimensions to produce a deterministic
 * hash string for bid event correlation. Does NOT include userId so that
 * multiple users on the same device produce the same fingerprint.
 *
 * NOT cryptographically secure — sufficient for heuristic grouping.
 *
 * @returns {string}
 */
export function generateFingerprint() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'node';
  const sw = typeof screen !== 'undefined' ? screen.width : 0;
  const sh = typeof screen !== 'undefined' ? screen.height : 0;
  const lang = typeof navigator !== 'undefined' ? (navigator.language ?? '') : '';
  const tz = new Date().getTimezoneOffset();
  const raw = `${ua}|${sw}x${sh}|${lang}|${tz}`;

  // Simple DJB2 hash — deterministic, fast, no dependencies.
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }
  return `fp_${hash.toString(16)}`;
}
