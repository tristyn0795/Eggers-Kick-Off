'use strict';
/*
 * Lightweight moderation for player names and room chat. Not perfect (no list is),
 * which is why players can also report and block each other, and admins can act on
 * reports — the combination app stores expect for user-generated content.
 */

// Stems are matched after normalising look-alike characters, so "sh1t" and "f.u.c.k" are caught.
const STEMS = [
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'bitch', 'whore', 'slut', 'nazi', 'hitler',
  'dickhead', 'cocksucker', 'pussy', 'penis', 'vagina', 'asshole', 'bastard', 'retard', 'killyourself',
  'porn', 'nude', 'boobs', 'twat', 'wanker', 'jizz', 'chink', 'kike', 'tranny',
];
// Short words that are only offensive on their own (so "grapefruit", "peacock", "swanky", "spice" are fine).
const WHOLE_WORDS = ['rape', 'rapist', 'dick', 'cock', 'cum', 'sex', 'kys', 'fag', 'fuk', 'tits', 'spic', 'wank', 'ass'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$!|]/g, (c) => LEET[c] || c);
}

/** True when a name/message contains something we don't allow. */
function isOffensive(text) {
  const norm = normalise(text);
  const squashed = norm.replace(/[^a-z]/g, '');
  const words = norm.split(/[^a-z]+/).filter(Boolean);
  return STEMS.some((s) => squashed.includes(s)) || WHOLE_WORDS.some((w) => words.includes(w));
}

/** Replace offensive words in chat with asterisks, keeping the rest of the message. */
function maskText(text) {
  return String(text || '').replace(/[^\s]+/g, (word) => (isOffensive(word) ? '*'.repeat(Math.min(word.length, 8)) : word));
}

module.exports = { isOffensive, maskText, normalise };
