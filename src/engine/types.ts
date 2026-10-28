// Format des données normalisées (public/data/*.json), produit par scripts/build-data.ts.

/** [id de stat (statIds.ts), valeur min, valeur max]. Le jet parfait est `max`. */
export type StatLine = [stat: number, min: number, max: number];

export type Slot =
  | "amulette" | "anneau" | "coiffe" | "cape" | "ceinture" | "bottes"
  | "arme" | "bouclier" | "familier" | "dofus";

export type Cmp = "<" | ">" | "=";
export type Cond =
  | { op: "and" | "or"; c: Cond[] }
  | { stat: number; cmp: Cmp; v: number }
  /** Nombre de bonus de panoplie actifs (conditions des trophées). */
  | { sets: true; cmp: Cmp; v: number }
  | { level: true; cmp: Cmp; v: number };

/** Élément d'une ligne de dégâts : 0..4 (Neutre, Terre, Feu, Eau, Air), -1 meilleur élément, -2 pire élément. */
export type LineElem = -2 | -1 | 0 | 1 | 2 | 3 | 4;

export interface DmgLine {
  elem: LineElem;
  min: number;
  max: number;
  kind: "dmg" | "steal" | "heal";
}

export interface WeaponData {
  ap: number;
  minRange: number;
  range: number;
  critRate: number;
  /** Bonus ajouté à chaque ligne de dégâts en cas de coup critique. */
  critBonus: number;
  perTurn: number;
  lines: DmgLine[];
}

export interface Item {
  id: number;
  name: string;
  typeId: number;
  type: string;
  slot: Slot;
  level: number;
  set?: number;
  icon?: string;
  stats: StatLine[];
  cond?: Cond;
  weapon?: WeaponData;
  /** Effets non chiffrés (passifs de Dofus, modificateurs de sorts de classe…), affichés à titre informatif. */
  notes?: string[];
}

export interface ItemSet {
  id: number;
  name: string;
  items: number[];
  /** Bonus par nombre de pièces équipées : bonus[n] = [stat, valeur][]. */
  bonus: Record<number, [stat: number, value: number][]>;
}

export interface SpellLine extends DmgLine {
  /** "I" immédiat, "T" début/fin de tour (poison). */
  trig: "I" | "T";
  /** Condition d'état sur la cible ou le lanceur (ligne qui demande une mise en place). */
  state?: string;
  /** Probabilité que la ligne s'applique (effets aléatoires), 1 si absente. */
  p?: number;
}

export interface SpellGrade {
  level: number;
  ap: number;
  minRange: number;
  range: number;
  boostable: boolean;
  crit: number;
  perTurn: number;
  perTarget: number;
  /** Nombre de tours entre deux lancers (minCastInterval). */
  interval: number;
  initialCooldown: number;
  lines: SpellLine[];
  critLines: SpellLine[];
  summons?: { monster: number; cost: number }[];
  /** Bonus de dégâts de base que le sort se donne à chaque lancer. */
  boosts?: SpellBoost[];
  /** Cumuls maximum des effets du sort (≤ 0 : sans limite). */
  maxStack?: number;
}

/** « +value dégâts de base » au sort, actif `duration` tours à partir de `delay` tours après le lancer. */
export interface SpellBoost {
  value: number;
  duration: number;
  delay: number;
}

export interface Spell {
  id: number;
  name: string;
  /** Les deux sorts d'une paire de variantes sont exclusifs : `pair` est commun aux deux. */
  pair: number;
  grades: SpellGrade[];
}

export interface ClassData {
  id: number;
  name: string;
  /** Paliers de coût : [à partir de N points investis, coût d'un point]. */
  statCosts: Record<"vita" | "sagesse" | "force" | "intel" | "chance" | "agi", [from: number, cost: number][]>;
  spells: Spell[];
}

export interface MonsterRef {
  level: number;
  /** % de résistance médian par élément (Neutre, Terre, Feu, Eau, Air). */
  res: number[];
  /** Résistance fixe médiane par élément. */
  resFlat: number[];
  /** PV médians. */
  hp: number;
}

export interface DataMeta {
  version: string;
  update_stamp: string;
  built_at: string;
}

export interface GameData {
  meta: DataMeta;
  items: Item[];
  sets: ItemSet[];
  classes: ClassData[];
  monsters: MonsterRef[];
}
