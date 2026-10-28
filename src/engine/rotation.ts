// Meilleur enchaînement de sorts : sac à dos borné sur les PA, tour par tour, sur un cycle qui respecte
// les intervalles de relance. Les dégâts par tour (DPT) sont la moyenne du cycle.

import type { ClassData } from "./types";
import { type Attack, type DmgContext, expectedDamage, gradeAt, hasDamage, spellAttack } from "./damage";
import { type Voie, fitsVoie } from "./voies";

const MAX_CYCLE = 12;

/** Lancers possibles par tour sur une même cible. */
export const castsPerTurn = (a: Attack) => (a.interval >= 1 ? 1 : a.perTurn > 0 ? a.perTurn : Infinity);

export interface Cycle {
  length: number;
  /** Types de tours distincts : attaques disponibles et part du cycle. */
  turns: { avail: number[]; weight: number }[];
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Un sort à intervalle k est disponible aux tours t ≡ 0 (mod k) d'un cycle de longueur ppcm(k). */
export function makeCycle(attacks: readonly Attack[]): Cycle {
  let length = 1;
  for (const a of attacks) if (a.interval >= 2) length = Math.min(MAX_CYCLE, (length * a.interval) / gcd(length, a.interval));
  const byKey = new Map<string, { avail: number[]; weight: number }>();
  for (let t = 0; t < length; t++) {
    const avail = attacks.flatMap((a, i) => (a.interval < 2 || t % a.interval === 0 ? [i] : []));
    const key = avail.join(",");
    const turn = byKey.get(key) ?? { avail, weight: 0 };
    turn.weight += 1 / length;
    byKey.set(key, turn);
  }
  return { length, turns: [...byKey.values()] };
}

/** Valeur maximale d'un tour (sac à dos borné). `dp` est un tampon d'au moins pa + 1 cases. */
export function bestTurn(attacks: readonly Attack[], values: ArrayLike<number>, avail: readonly number[], pa: number, dp: Float64Array): number {
  dp.fill(0, 0, pa + 1);
  let free = 0;
  for (const i of avail) {
    const v = values[i];
    if (!(v > 0)) continue;
    const a = attacks[i];
    if (a.ap <= 0) {
      free += v * Math.min(castsPerTurn(a), 10);
      continue;
    }
    if (a.ap > pa) continue;
    const n = Math.min(castsPerTurn(a), Math.floor(pa / a.ap));
    for (let c = 0; c < n; c++) {
      for (let x = pa; x >= a.ap; x--) {
        const y = dp[x - a.ap] + v;
        if (y > dp[x]) dp[x] = y;
      }
    }
  }
  return dp[pa] + free;
}

/** Détail d'un tour : lancers retenus (même calcul que bestTurn, avec reconstruction). */
export function explainTurn(attacks: readonly Attack[], values: ArrayLike<number>, avail: readonly number[], pa: number) {
  const copies: number[] = [];
  for (const i of avail) {
    const a = attacks[i];
    if (!(values[i] > 0) || a.ap > pa) continue;
    const n = a.ap <= 0 ? Math.min(castsPerTurn(a), 10) : Math.min(castsPerTurn(a), Math.floor(pa / a.ap));
    for (let c = 0; c < n; c++) copies.push(i);
  }
  const rows = [new Float64Array(pa + 1)];
  for (const i of copies) {
    const prev = rows[rows.length - 1];
    const row = prev.slice();
    const ap = attacks[i].ap;
    for (let x = pa; x >= ap; x--) row[x] = Math.max(prev[x], prev[x - ap] + values[i]);
    rows.push(row);
  }
  const casts: number[] = [];
  let x = pa;
  for (let k = copies.length; k > 0; k--) {
    if (rows[k][x] !== rows[k - 1][x]) {
      casts.push(copies[k - 1]);
      x -= attacks[copies[k - 1]].ap;
    }
  }
  return { casts: casts.reverse(), damage: rows[copies.length][pa], apUsed: pa - x };
}

/** Dégâts moyens par tour sur le cycle. */
export function cycleValue(attacks: readonly Attack[], values: ArrayLike<number>, cycle: Cycle, pa: number, dp: Float64Array): number {
  let v = 0;
  for (const t of cycle.turns) v += t.weight * bestTurn(attacks, values, t.avail, pa, dp);
  return v;
}

/** Sorts offensifs d'une classe disponibles au niveau (de la voie donnée), regroupés par paire de variantes. */
export function spellPairs(cls: ClassData, level: number, style: number, voie?: readonly Voie[]): Attack[][] {
  const pairs = new Map<number, Attack[]>();
  for (const s of cls.spells) {
    const g = gradeAt(s, level);
    if (!g) continue;
    const a = spellAttack(s, g, style);
    if (!hasDamage(a) || !fitsVoie(a, voie)) continue;
    pairs.set(s.pair, [...(pairs.get(s.pair) ?? []), a]);
  }
  return [...pairs.values()];
}

/**
 * Choix des variantes (un sort par paire) qui maximise les DPT avec les stats données : on part du sort le plus
 * rentable par PA de chaque paire, puis on essaie de basculer chaque paire tant que ça améliore.
 */
export function chooseDeck(pairs: readonly Attack[][], ctx: DmgContext, pa: number, extra: readonly Attack[] = []): Attack[] {
  const dp = new Float64Array(pa + 1);
  const rate = (a: Attack) => (expectedDamage(a, ctx) / Math.max(1, a.ap)) / Math.max(1, a.interval);
  const choice = pairs.map((p) => p.reduce((best, a, i) => (rate(a) > rate(p[best]) ? i : best), 0));
  const evalChoice = () => {
    const attacks = [...pairs.map((p, i) => p[choice[i]]), ...extra];
    return cycleValue(attacks, attacks.map((a) => expectedDamage(a, ctx)), makeCycle(attacks), pa, dp);
  };
  let best = evalChoice();
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    pairs.forEach((p, i) => {
      if (p.length < 2) return;
      const keep = choice[i];
      for (let j = 0; j < p.length; j++) {
        if (j === keep) continue;
        choice[i] = j;
        const v = evalChoice();
        if (v > best + 1e-9) {
          best = v;
          improved = true;
          return;
        }
      }
      choice[i] = keep;
    });
    if (!improved) break;
  }
  return pairs.map((p, i) => p[choice[i]]);
}
