// Pure helpers for the card fields on the payment page. Kept out of the
// component so they can be unit tested on their own - see
// evaluation/unit/card.test.ts

export const BULLET = '\u2022';

// Amex (starts 34/37) is 15 digits with a 4-digit code; others are 16/3
export function isAmex(digits: string) {
  return /^3[47]/.test(digits);
}

export function cardMaxLen(digits: string) {
  return isAmex(digits) ? 15 : 16;
}

export function cvcLen(digits: string) {
  return isAmex(digits) ? 4 : 3;
}

// mask the middle 8 digits (positions 5-12), grouped in 4s
export function maskCardDisplay(digits: string) {
  const shown = digits
    .split('')
    .map((d, i) => (i >= 4 && i < 12 ? BULLET : d))
    .join('');
  return shown.match(/.{1,4}/g)?.join(' ') || shown;
}

// rebuild the real digits: keep visible digits, and where a bullet sits pull
// the original digit back from the previous value by position
export function unmaskCard(shown: string, prev: string) {
  const chars = shown.replace(/ /g, '').split('');
  let real = '';
  for (const c of chars) {
    if (real.length >= 16) break;
    if (c === BULLET) real += prev[real.length] ?? '';
    else if (/\d/.test(c)) real += c;
  }
  // cap to this card's length (15 for Amex, else 16)
  return real.slice(0, cardMaxLen(real));
}

export function formatExpiry(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}
