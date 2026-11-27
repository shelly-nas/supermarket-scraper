import { CategorizedName } from "../../clients/lidl/LidlCheckjebon";

/** A small AH-like catalog: enough food and non-food names to learn from. */
export function training(): CategorizedName[] {
  const rows: CategorizedName[] = [];
  const add = (category: string, names: string[], times: number) => {
    for (let i = 0; i < times; i++) for (const name of names) rows.push({ name, category });
  };
  add("Kaas", ["Jonge kaas plakken", "Belegen kaas blok", "Geraspte kaas"], 15);
  add("Zuivel, eieren", ["Halfvolle melk", "Volle yoghurt", "Scharreleieren"], 15);
  add("Bier, wijn, aperitieven", ["Pils krat", "Rode wijn", "Witte wijn droog"], 15);
  add("Huishouden", ["Wasmiddel color", "Vaatwastabletten", "Toiletpapier"], 25);
  add("Drogisterij", ["Shampoo", "Tandpasta", "Deodorant spray"], 25);
  add("Huisdier", ["Kattenbrokken kip"], 30); // mixed: left out of the model
  return rows;
}
