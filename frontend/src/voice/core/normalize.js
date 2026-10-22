/**
 * Transcript normalisation for rule-based English command matching.
 *
 * "Open the Add Vendor page, please." -> "add vendor"
 *
 * Steps: lowercase, drop apostrophes, strip punctuation, remove filler words,
 * then strip leading command verbs ("open", "go", "show", ...).
 */
const FILLER = new Set([
  'please', 'kindly', 'the', 'a', 'an', 'to', 'me', 'my', 'now', 'can', 'could',
  'would', 'will', 'you', 'i', 'want', 'like', 'lets', 'hey', 'ok', 'okay',
  'page', 'screen', 'tab', 'section', 'form', 'modal', 'dialog', 'window',
  'popup', 'again', 'for', 'up',
]);

const LEADING_VERBS = new Set([
  'open', 'go', 'show', 'view', 'take', 'navigate', 'launch', 'display',
  'bring', 'switch', 'see',
]);

export function normalizeTranscript(text) {
  if (typeof text !== 'string') return '';
  const tokens = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !FILLER.has(t));
  while (tokens.length > 1 && LEADING_VERBS.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}
