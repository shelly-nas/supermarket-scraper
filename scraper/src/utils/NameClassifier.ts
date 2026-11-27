/**
 * Naive Bayes over the words of a product name and their 4-letter pieces,
 * learned from labelled names (e.g. another supermarket's catalog with its
 * categories). The pieces let it read Dutch compounds it never saw whole:
 * "bergkaas" shares "kaas" with every cheese. Counts are smoothed in
 * proportion to class size, as in clients/aldi/AldiFood.ts.
 */

// Webshop articles in checkjebon carry their number in the name ("Stellingkast-0452484").
const ARTICLE_SUFFIX = /-\d{6,7}$/;

const normalize = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Name words (3+ letters, without accents) and their 4-letter pieces, with word boundaries. */
export function nameFeatures(name: string): Set<string> {
  const features = new Set<string>();
  for (const word of normalize(name.replace(ARTICLE_SUFFIX, "")).match(/[a-z]{3,}/g) ?? []) {
    features.add(`w:${word}`);
    const bounded = `^${word}$`;
    for (let i = 0; i + 4 <= bounded.length; i++) features.add(bounded.slice(i, i + 4));
  }
  return features;
}

export class NameClassifier<L extends string> {
  private counts = new Map<L, Map<string, number>>();
  private totals = new Map<L, number>();
  private total = 0;

  constructor(labelled: { name: string; label: L }[]) {
    for (const { name, label } of labelled) {
      this.total++;
      this.totals.set(label, (this.totals.get(label) ?? 0) + 1);
      const counts = this.counts.get(label) ?? new Map<string, number>();
      for (const feature of nameFeatures(name)) counts.set(feature, (counts.get(feature) ?? 0) + 1);
      this.counts.set(label, counts);
    }
  }

  get labels(): L[] {
    return [...this.totals.keys()];
  }

  /**
   * The probability of each label, or null when the name has no word or piece
   * the model saw. Without the prior an unknown-leaning name stays near even
   * instead of following the largest class.
   */
  probabilities(name: string, withPrior: boolean): Map<L, number> | null {
    const features = [...nameFeatures(name)].filter((f) =>
      this.labels.some((label) => this.counts.get(label)!.has(f))
    );
    if (features.length === 0 || this.total === 0) return null;

    const logs = new Map<L, number>();
    for (const label of this.labels) {
      const n = this.totals.get(label)!;
      const counts = this.counts.get(label)!;
      let log = withPrior ? Math.log(n / this.total) : 0;
      for (const feature of features) log += Math.log(((counts.get(feature) ?? 0) + n / this.total) / (n + 1));
      logs.set(label, log);
    }
    const max = Math.max(...logs.values());
    let sum = 0;
    for (const log of logs.values()) sum += Math.exp(log - max);
    return new Map([...logs].map(([label, log]) => [label, Math.exp(log - max) / sum]));
  }

  /** The most likely label, or null when the model knows nothing of the name. */
  best(name: string, withPrior = true): L | null {
    const probabilities = this.probabilities(name, withPrior);
    if (!probabilities) return null;
    return [...probabilities].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }
}

export { ARTICLE_SUFFIX };
