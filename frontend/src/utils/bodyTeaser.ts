// Teaser for feed cards: first sentences of a post body, cut before "see more".
//
// The sentence matcher also treats a newline as a terminator, so a post that
// opens with short greeting lines ("بەڕێزان\nسڵاو…") used to cut after a
// handful of words. MIN_TEASER_WORDS keeps extending the teaser sentence by
// sentence until at least that many words are visible. Mirrored in
// mobile/src/utils/bodyTeaser.ts — keep in lockstep.

const MIN_TEASER_WORDS = 10;
const CHAR_LIMIT = 180;

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function bodyTeaser(raw: string): { text: string; truncated: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: '', truncated: false };
  if (wordCount(trimmed) <= MIN_TEASER_WORDS) return { text: trimmed, truncated: false };

  const sentences = trimmed.match(/[^.!?\n]+[.!?\n]+/g);
  if (sentences && sentences.length >= 2) {
    let take = 2;
    let text = sentences.slice(0, take).join('').trim();
    while (wordCount(text) < MIN_TEASER_WORDS && take < sentences.length) {
      take += 1;
      text = sentences.slice(0, take).join('').trim();
    }
    if (text.length >= trimmed.length) return { text: trimmed, truncated: false };
    if (wordCount(text) >= MIN_TEASER_WORDS) return { text, truncated: true };
    // All terminated sentences consumed but still under the floor (the rest is
    // an unterminated tail) — fall through to the character cut on the full text.
  }

  if (trimmed.length > CHAR_LIMIT) {
    const cut = trimmed.slice(0, CHAR_LIMIT);
    const lastSpace = cut.lastIndexOf(' ');
    let text = (lastSpace > CHAR_LIMIT * 0.45 ? cut.slice(0, lastSpace) : cut).trim();
    if (wordCount(text) < MIN_TEASER_WORDS) {
      text = trimmed.split(/\s+/).filter(Boolean).slice(0, MIN_TEASER_WORDS).join(' ');
    }
    return { text, truncated: text.length < trimmed.length };
  }
  return { text: trimmed, truncated: false };
}
