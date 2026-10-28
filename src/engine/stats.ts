// Agrégation des stats d'un stuff : base du personnage + caractéristiques investies + parchemins + items + panoplies.

import type { ClassData, Item, ItemSet, Slot } from "./types";
import { BASE_CARACS, N_STATS, S, type BaseCarac } from "./statIds";
import { evalCond } from "./conditions";
import { BASE_INVO, BASE_PM, BASE_PODS, BASE_PROSPE, basePA, baseHP, type Rules } from "./rules";

/** Emplacements d'un stuff, dans l'ordre (16 cases). */
export const SLOTS: readonly Slot[] = [
  "amulette", "anneau", "anneau", "coiffe", "cape", "ceinture", "bottes", "arme", "bouclier", "familier",
  "dofus", "dofus", "dofus", "dofus", "dofus", "dofus",
];
export const N_SLOTS = SLOTS.length;
export const WEAPON_SLOT = SLOTS.indexOf("arme");

export type Roll = "max" | "avg";
export type Allocation = Record<BaseCarac, number>;

export interface Character {
  cls: ClassData;
  level: number;
  /** Valeur de base achetée avec les points de caractéristique (hors parchemins). */
  alloc: Allocation;
  /** +100 dans chacune des 6 caractéristiques. */
  scrolls: boolean;
  /** Exos de forgemagie (un seul de chaque compte sur le stuff). */
  exo?: Exo;
}

export interface Exo {
  pa?: boolean;
  pm?: boolean;
  po?: boolean;
}

export const newVec = () => new Float64Array(N_STATS);
export const emptyAlloc = (): Allocation => ({ vita: 0, sagesse: 0, force: 0, intel: 0, chance: 0, agi: 0 });

export function itemVec(item: Item, roll: Roll = "max"): Float64Array {
  const v = newVec();
  for (const [s, min, max] of item.stats) v[s] += roll === "max" ? max : Math.floor((min + max) / 2);
  return v;
}

/** Points de caractéristique nécessaires pour porter une caractéristique de base à `value`. */
export function pointsFor(tiers: [number, number][], value: number): number {
  let pts = 0;
  for (let i = 0; i < tiers.length; i++) {
    const [from, cost] = tiers[i];
    const to = i + 1 < tiers.length ? tiers[i + 1][0] : Infinity;
    if (value <= from) break;
    pts += (Math.min(value, to) - from) * cost;
  }
  return pts;
}

/** Coût du point suivant quand la caractéristique de base vaut `value`. */
export function nextPointCost(tiers: [number, number][], value: number): number {
  let cost = tiers[0]?.[1] ?? 1;
  for (const [from, c] of tiers) if (value >= from) cost = c;
  return cost;
}

export const allocPoints = (cls: ClassData, alloc: Allocation) =>
  BASE_CARACS.reduce((n, k) => n + pointsFor(cls.statCosts[k], alloc[k]), 0);

/** Stats du personnage nu : base de classe, caractéristiques investies et parchemins. */
export function baseVec(ch: Character): Float64Array {
  const v = newVec();
  v[S.pa] = basePA(ch.level) + (ch.exo?.pa ? 1 : 0);
  v[S.pm] = BASE_PM + (ch.exo?.pm ? 1 : 0);
  v[S.po] = ch.exo?.po ? 1 : 0;
  v[S.invo] = BASE_INVO;
  v[S.prospe] = BASE_PROSPE;
  v[S.pods] = BASE_PODS;
  for (const k of BASE_CARACS) v[S[k]] = ch.alloc[k] + (ch.scrolls ? 100 : 0);
  return v;
}

/** Bonus de panoplie pour `n` pièces équipées (le palier défini le plus proche en dessous). */
export function setBonusFor(set: ItemSet, n: number): [number, number][] {
  for (let k = n; k >= 2; k--) if (set.bonus[k]) return set.bonus[k];
  return [];
}

/** Valeur du critère « Bonus de panoplies » utilisé par les conditions des trophées. */
export function setBonusCount(pieces: Iterable<number>, rules: Rules): number {
  let n = 0;
  for (const p of pieces) if (p >= 2) n += rules.setBonusCount === "piecesMinusOne" ? p - 1 : 1;
  return n;
}

export interface Aggregate {
  /** Totaux non plafonnés. */
  totals: Float64Array;
  /** Pièces équipées par panoplie. */
  setPieces: Map<number, number>;
  setBonuses: number;
}

export function aggregate(
  ch: Character,
  items: readonly (Item | null)[],
  sets: ReadonlyMap<number, ItemSet>,
  rules: Rules,
  roll: Roll = "max",
): Aggregate {
  const totals = baseVec(ch);
  const setPieces = new Map<number, number>();
  for (const it of items) {
    if (!it) continue;
    for (const [s, min, max] of it.stats) totals[s] += roll === "max" ? max : Math.floor((min + max) / 2);
    if (it.set !== undefined && sets.has(it.set)) setPieces.set(it.set, (setPieces.get(it.set) ?? 0) + 1);
  }
  for (const [id, n] of setPieces) for (const [s, v] of setBonusFor(sets.get(id)!, n)) totals[s] += v;
  return { totals, setPieces, setBonuses: setBonusCount(setPieces.values(), rules) };
}

/** Totaux effectifs : PA / PM / PO plafonnés. */
export function capped(totals: Float64Array, rules: Rules): Float64Array {
  const v = totals.slice();
  v[S.pa] = Math.min(v[S.pa], rules.capPA);
  v[S.pm] = Math.min(v[S.pm], rules.capPM);
  v[S.po] = Math.min(v[S.po], rules.capPO);
  return v;
}

export const hitPoints = (totals: ArrayLike<number>, level: number) => Math.max(1, baseHP(level) + totals[S.vita]);

/**
 * Problèmes d'équipabilité d'un stuff : niveau, conditions, doublons (anneaux, Dofus/trophées).
 * Renvoie une liste vide si le stuff est valide. `levelMargin` : niveaux d'avance tolérés (stuff préparé à l'avance).
 */
export function buildProblems(ch: Character, items: readonly (Item | null)[], agg: Aggregate, levelMargin = 0): string[] {
  const out: string[] = [];
  const seen = new Map<number, number>();
  items.forEach((it, i) => {
    if (!it) return;
    if (it.level > ch.level + levelMargin) out.push(`${it.name} : niveau ${it.level} requis`);
    if (it.cond && !evalCond(it.cond, { totals: agg.totals, level: ch.level, setBonuses: agg.setBonuses }))
      out.push(`${it.name} : condition non remplie`);
    const prev = seen.get(it.id);
    if (prev !== undefined && SLOTS[prev] === SLOTS[i]) out.push(`${it.name} : équipé deux fois`);
    seen.set(it.id, i);
  });
  return out;
}
