/**
 * House style: this product does not use em dashes.
 *
 * The rule is enforced twice, because the two halves fail differently. The
 * prompt rule (`STYLE_RULE`) is what a model reads; a model asked for prose
 * reaches for an em dash constantly and complies only most of the time. So
 * every string that comes back from a provider is also passed through
 * `stripEmDashes`, which is deterministic and cannot be argued with.
 *
 * Source text is cleaned at ingest for the same reason: a CRM note or a KB
 * chunk written with an em dash would otherwise carry one into the copy a rep
 * reads aloud, without any model involved.
 */

/**
 * The banned characters are written as escapes throughout this file, so that
 * the module enforcing the rule does not itself trip `npm run style`.
 */
const EM = '\u2014';        // em dash
const BAR = '\u2015';       // horizontal bar, the same mark under another name
const EN = '\u2013';        // en dash, banned as punctuation, allowed in ranges

/** Appended to the system prompt of every model call. */
export const STYLE_RULE =
  `Never use an em dash (${EM}), an en dash (${EN}) or a double hyphen as sentence punctuation. `
  + 'Use a comma, a semicolon, a colon or a full stop instead.';

const DASH = `[${EM}${BAR}]`;
const EM_DASH = new RegExp(DASH);

/**
 * Remove em dashes from text.
 *
 * A dash between two numbers is a range, so it becomes a hyphen and the numbers
 * are left untouched: the numeric guard compares generated figures against the
 * evidence verbatim, and rewriting a digit there would fail a claim that is
 * actually supported. Anywhere else the dash is punctuation and a comma carries
 * the same pause.
 */
export function stripEmDashes(text: string): string {
  if (!text || !EM_DASH.test(text)) return text;
  return text
    // opening a line, it is a bullet rather than punctuation
    .replace(new RegExp(`^[ \t]*${DASH}[ \t]*`, 'gm'), '')
    // between two numbers it is a range, and the digits must survive verbatim
    .replace(new RegExp(`(\\d)\\s*${DASH}\\s*(\\d)`, 'g'), '$1-$2')
    // anywhere else it is punctuation, and a comma carries the same pause
    .replace(new RegExp(`\\s*${DASH}\\s*`, 'g'), ', ')
    .replace(/,\s*([,.;:!?])/g, '$1')   // never a doubled mark
    .replace(/,\s*$/, '');              // nothing left dangling at the end
}

/** True when text still carries an em dash. Used by the repository guard. */
export const hasEmDash = (text: string) => EM_DASH.test(text);
