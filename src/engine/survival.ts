// Points de vie effectifs (EHP) : PV divisés par la part des dégâts qui passe à travers les résistances,
// sur un coup de référence réparti entre les éléments et entre mêlée / distance.

import { ELEM_RF, ELEM_RP, S } from "./statIds";
import { hitPoints } from "./stats";
import type { Rules } from "./rules";

export interface IncomingProfile {
  /** Part des dégâts reçus dans chaque élément (Neutre..Air), somme 1. */
  elems: number[];
  /** Part des dégâts reçus au corps à corps. */
  melee: number;
}

export const BALANCED_INCOMING: IncomingProfile = { elems: [0.2, 0.2, 0.2, 0.2, 0.2], melee: 0.5 };

/** Coup de référence d'un monstre du niveau donné, pour peser les résistances fixes face aux %. */
export const referenceHit = (level: number) => 20 + 3 * level;

/** Part des dégâts qui passe à travers les résistances (0..1). */
export function damageTaken(totals: ArrayLike<number>, level: number, inc: IncomingProfile, rules: Rules): number {
  const hit = referenceHit(level);
  let through = 0;
  for (let e = 0; e < 5; e++) {
    if (!inc.elems[e]) continue;
    const afterFlat = Math.max(0, hit - totals[ELEM_RF[e]]) / hit;
    through += inc.elems[e] * afterFlat * (1 - Math.min(totals[ELEM_RP[e]], rules.resCap) / 100);
  }
  const range = inc.melee * (1 - totals[S.rpMelee] / 100) + (1 - inc.melee) * (1 - totals[S.rpDist] / 100);
  return Math.max(0.02, through * Math.max(0, range));
}

export function effectiveHP(totals: ArrayLike<number>, level: number, inc: IncomingProfile, rules: Rules): number {
  return hitPoints(totals, level) / damageTaken(totals, level, inc, rules);
}
