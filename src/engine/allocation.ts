// Répartition des points de caractéristique : glouton par paquets, en suivant le meilleur gain de score
// par point dépensé (les paliers de coût rendent le rendement décroissant).

import type { ClassData } from "./types";
import { type Allocation, emptyAlloc, pointsFor } from "./stats";
import { type BaseCarac } from "./statIds";

/** La Sagesse n'apporte rien au score PvM : elle n'est jamais choisie. */
const USEFUL: BaseCarac[] = ["vita", "force", "intel", "chance", "agi"];

export function optimizeAllocation(cls: ClassData, points: number, score: (a: Allocation) => number, chunk = 10): Allocation {
  const alloc = emptyAlloc();
  let left = points;
  let current = score(alloc);
  for (const step of [chunk, 1]) {
    for (;;) {
      let best: { k: BaseCarac; cost: number; value: number; ratio: number } | undefined;
      for (const k of USEFUL) {
        const tiers = cls.statCosts[k];
        const cost = pointsFor(tiers, alloc[k] + step) - pointsFor(tiers, alloc[k]);
        if (cost > left) continue;
        alloc[k] += step;
        const value = score(alloc);
        alloc[k] -= step;
        const ratio = (value - current) / cost;
        if (ratio > 0 && (!best || ratio > best.ratio)) best = { k, cost, value, ratio };
      }
      if (!best) break;
      alloc[best.k] += step;
      left -= best.cost;
      current = best.value;
    }
  }
  return alloc;
}
