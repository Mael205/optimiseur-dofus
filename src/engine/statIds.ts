// Identifiants de stats unifiés, utilisés par les données normalisées et par le moteur.
// Un stuff est représenté par un Float64Array indexé par ces ids.

export const STAT_KEYS = [
  "pa", "pm", "po", "invo",
  "vita", "sagesse", "force", "intel", "chance", "agi",
  "puissance", "do", "doNeutre", "doTerre", "doFeu", "doEau", "doAir", "doCrit", "doPou", "crit", "soin",
  "pctSorts", "pctArmes", "pctMelee", "pctDist",
  "rfNeutre", "rfTerre", "rfFeu", "rfEau", "rfAir", "rfCrit", "rfPou",
  "rpNeutre", "rpTerre", "rpFeu", "rpEau", "rpAir", "rpMelee", "rpDist",
  "ini", "prospe", "tacle", "fuite", "esqPA", "esqPM", "retPA", "retPM",
  "pods", "doPieges", "puiPieges", "renvoi",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export const N_STATS = STAT_KEYS.length;
export const S = Object.fromEntries(STAT_KEYS.map((k, i) => [k, i])) as Record<StatKey, number>;

export const STAT_LABELS: Record<StatKey, string> = {
  pa: "PA", pm: "PM", po: "Portée", invo: "Invocations",
  vita: "Vitalité", sagesse: "Sagesse", force: "Force", intel: "Intelligence", chance: "Chance", agi: "Agilité",
  puissance: "Puissance", do: "Dommages", doNeutre: "Dommages Neutre", doTerre: "Dommages Terre",
  doFeu: "Dommages Feu", doEau: "Dommages Eau", doAir: "Dommages Air", doCrit: "Dommages Critiques",
  doPou: "Dommages Poussée", crit: "% Critique", soin: "Soins",
  pctSorts: "% Dommages aux sorts", pctArmes: "% Dommages d'armes", pctMelee: "% Dommages mêlée", pctDist: "% Dommages distance",
  rfNeutre: "Résistance Neutre", rfTerre: "Résistance Terre", rfFeu: "Résistance Feu", rfEau: "Résistance Eau",
  rfAir: "Résistance Air", rfCrit: "Résistance Critiques", rfPou: "Résistance Poussée",
  rpNeutre: "% Résistance Neutre", rpTerre: "% Résistance Terre", rpFeu: "% Résistance Feu", rpEau: "% Résistance Eau",
  rpAir: "% Résistance Air", rpMelee: "% Résistance mêlée", rpDist: "% Résistance distance",
  ini: "Initiative", prospe: "Prospection", tacle: "Tacle", fuite: "Fuite", esqPA: "Esquive PA", esqPM: "Esquive PM",
  retPA: "Retrait PA", retPM: "Retrait PM", pods: "Pods", doPieges: "Dommages Pièges", puiPieges: "Puissance Pièges",
  renvoi: "Dommages Renvoyés",
};

// Éléments, dans l'ordre des ids du jeu : 0 Neutre, 1 Terre, 2 Feu, 3 Eau, 4 Air.
export const ELEMENTS = ["Neutre", "Terre", "Feu", "Eau", "Air"] as const;
export type Element = 0 | 1 | 2 | 3 | 4;
/** Caractéristique qui augmente les dégâts de chaque élément (le Neutre utilise la Force). */
export const ELEM_CARAC = [S.force, S.force, S.intel, S.chance, S.agi] as const;
export const ELEM_DO = [S.doNeutre, S.doTerre, S.doFeu, S.doEau, S.doAir] as const;
export const ELEM_RF = [S.rfNeutre, S.rfTerre, S.rfFeu, S.rfEau, S.rfAir] as const;
export const ELEM_RP = [S.rpNeutre, S.rpTerre, S.rpFeu, S.rpEau, S.rpAir] as const;

/** Caractéristiques dans lesquelles on peut investir des points (et des parchemins). */
export const BASE_CARACS = ["vita", "sagesse", "force", "intel", "chance", "agi"] as const;
export type BaseCarac = (typeof BASE_CARACS)[number];
