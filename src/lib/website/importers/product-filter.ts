/**
 * WooCommerce stores often mix camps, programmes and services with club
 * merchandise. Only merchandise belongs in the app shop (camps and programmes
 * have their own modules), so the import preview pre-selects products by a
 * generic, language-neutral rule:
 *
 *  - deselected: price 0, or any category whose words look like a camp /
 *    programme / service / training / class / course (en, fr, de, it, es);
 *  - products without any category: the same rule applied to the product name
 *    (e.g. "Las Vegas Summer Camp");
 *  - everything else selected.
 *
 * The admin can change every choice; deselections are remembered.
 */

// Word prefixes (a word starting with one of these) …
const PREFIXES = ["camp", "program", "servic", "training", "class", "cours", "kurs", "stage", "lager", "corso", "corsi", "curso", "clinic", "lesson", "lecon"];
// … and parts of compound words (German "Sommercamp", "Trainingslager").
const PARTS = ["camp", "lager", "training", "kurs"];

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isNonMerchCategory(name: string): boolean {
  return words(name).some((w) => PREFIXES.some((p) => w.startsWith(p)) || PARTS.some((p) => w.length > p.length && w.includes(p)));
}

export function isMerchandiseByDefault(p: { price: number; categories: readonly string[]; name?: string }): boolean {
  if (!(p.price > 0)) return false;
  if (p.categories.length === 0) return !(p.name && isNonMerchCategory(p.name));
  return !p.categories.some(isNonMerchCategory);
}
