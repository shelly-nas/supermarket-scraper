import type { CheckjebonProduct } from "../catalog/LidlCatalogClient";
import { ICatalogProduct } from "../../interfaces/ICatalogProduct";
import { ARTICLE_SUFFIX, NameClassifier } from "../../utils/NameClassifier";

// lidl.nl shows only part of Lidl's store assortment online (November 2026:
// about 580 food products; "Kaas, zuivel & eieren" has 11). The checkjebon
// dataset holds the whole store assortment, with only a name, article number,
// price and pack size per row, and food mixed with non-food. Its rows add the
// food lidl.nl does not show, as add-only products: they never change a row
// that exists (PostgresCatalogController, ICatalogProduct.addOnly).
//
// Which rows are food, and their category, is learned from another
// supermarket's catalog with categories (Albert Heijn, from the database):
// names in AH's food categories against names in its non-food ones plus
// checkjebon's own webshop articles ("Stellingkast-0452484"). Checked in
// November 2026: 2.6% of held-out webshop articles pass as food; the category
// is right for about 2 in 3 lidl.nl products.

/** AH's non-food main categories; mixed ones (baby, health, pets, seasonal) are left out of the model. */
const AH_NON_FOOD = new Set(["Drogisterij", "Huishouden", "Koken, tafelen, vrije tijd", "AH Bloemenshop"]);
const AH_MIXED = new Set(["Baby en kind", "Gezondheid en sport", "Kerst", "AH Voordeelshop", "Huisdier"]);

/** AH food categories as the Lidl category names lidl.nl uses (lidlCategory). */
const AH_TO_LIDL: Record<string, string> = {
  "Groente, aardappelen": "Groenten & fruit",
  "Fruit, verse sappen": "Groenten & fruit",
  "Maaltijden, salades": "Kant-en-klaarmaaltijden",
  "Vegetarisch, vegan en plantaardig": "Kant-en-klaarmaaltijden",
  Vlees: "Vlees & gevogelte",
  Vleeswaren: "Vlees & gevogelte",
  Vis: "Vis & zeevruchten",
  Kaas: "Kaas, zuivelproducten & eieren",
  "Zuivel, eieren": "Kaas, zuivelproducten & eieren",
  Bakkerij: "Bakkerij",
  Glutenvrij: "Voorraadkast",
  "Pasta, rijst, wereldkeuken": "Voorraadkast",
  "Ontbijtgranen, beleg": "Voorraadkast",
  "Soepen, sauzen, kruiden, olie": "Oliën, kruiden & sauzen",
  "Borrel, chips, snacks": "Snoep & snacks",
  "Koek, snoep, chocolade": "Snoep & snacks",
  Tussendoortjes: "Snoep & snacks",
  Diepvries: "Diepvries",
  "Koffie, thee": "Dranken",
  "Frisdrank, sappen, water": "Dranken",
  "Bier, wijn, aperitieven": "Wijn",
};
const BEER = /bier|pils|radler|cider|\bipa\b|weizen|bock|tripel|dubbel|blond|lager|stout/i;

// Pet food reads like food ("Kattenmousse vis", "Purina one zalm").
const PET =
  /(^|[^a-z])(kat|kitten|hond|puppy|vogel)|katten|honden|dierenvoer|knaagdier|purina|whiskas|sheba|felix|kitekat|friskies|pedigree|cesar|gourmet gold|brekkies/i;
// Below this the dataset's price is bogus (e.g. 0.01 for a refill pack).
const MIN_PRICE = 0.05;
// Food probability a name needs (tuned on held-out webshop articles and lidl.nl food).
const FOOD_THRESHOLD = 0.6;

/** Lidl names compared without case, accents' neighbours or punctuation. */
export const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A name with a known category from another supermarket's catalog. */
export interface CategorizedName {
  name: string;
  category: string;
}

export interface LidlFoodModel {
  isFood(name: string): boolean;
  category(name: string): string;
}

/**
 * The food check and category for checkjebon names, learned from
 * `training` (AH's catalog) and the dataset's own webshop articles. Null
 * when the training has too little food or non-food to tell them apart.
 */
export function learnLidlFood(training: CategorizedName[], rows: CheckjebonProduct[]): LidlFoodModel | null {
  const food: { name: string; label: "food" | "nonfood" }[] = [];
  const categories: { name: string; label: string }[] = [];
  for (const { name, category } of training) {
    if (AH_MIXED.has(category)) continue;
    if (AH_NON_FOOD.has(category)) {
      food.push({ name, label: "nonfood" });
    } else if (AH_TO_LIDL[category]) {
      food.push({ name, label: "food" });
      categories.push({ name, label: category });
    }
  }
  const foodCount = categories.length;
  if (foodCount < 100 || food.length - foodCount < 100) return null;
  for (const row of rows) if (row?.n && ARTICLE_SUFFIX.test(row.n)) food.push({ name: row.n, label: "nonfood" });

  const foodModel = new NameClassifier(food);
  const categoryModel = new NameClassifier(categories);
  return {
    isFood(name) {
      if (PET.test(name)) return false;
      const p = foodModel.probabilities(name, false);
      return p !== null && (p.get("food") ?? 0) >= FOOD_THRESHOLD;
    },
    category(name) {
      const ah = categoryModel.best(name);
      const lidl = ah ? AH_TO_LIDL[ah] : undefined;
      if (!lidl) return "Overig";
      return lidl === "Wijn" && BEER.test(name) ? "Bier & Cider" : lidl;
    },
  };
}

/**
 * The checkjebon rows to add: food, with a plausible price, not a webshop
 * article, and not a product lidl.nl already showed in this run (by article
 * number or name); one per article number and per name. Each is add-only.
 */
export function checkjebonAdditions(
  rows: CheckjebonProduct[],
  seen: { articleNumbers: Set<string>; names: Set<string> },
  model: LidlFoodModel
): ICatalogProduct[] {
  const numbers = new Set([...seen.articleNumbers].map((n) => n.replace(/^0+/, "")));
  const names = new Set(seen.names);
  const additions: ICatalogProduct[] = [];
  for (const row of rows) {
    const name = row?.n?.trim();
    const number = String(row?.l ?? "").trim().replace(/^0+/, "");
    if (!name || !number || typeof row.p !== "number" || row.p < MIN_PRICE) continue;
    if (ARTICLE_SUFFIX.test(name)) continue;
    const key = normalizeName(name);
    if (numbers.has(number) || names.has(key)) continue;
    if (!model.isFood(name)) continue;
    numbers.add(number);
    names.add(key);
    additions.push({
      externalId: number,
      name,
      brand: null,
      category: model.category(name),
      unitSize: row.s?.trim() || null,
      price: row.p,
      priceSource: "checkjebon",
      unitPrice: null,
      imageUrl: null,
      productUrl: null,
      articleNumber: number,
      addOnly: true,
    });
  }
  return additions;
}
