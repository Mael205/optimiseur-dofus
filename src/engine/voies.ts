// Voies élémentaires : une voie est une caractéristique d'élément (Force = Terre et Neutre, Intelligence = Feu,
// Chance = Eau, Agilité = Air). Restreindre un stuff à une voie, c'est ne jouer que les sorts de ces éléments.

import type { Attack, LineSum } from "./damage";
import { ELEMENTS } from "./statIds";

export const VOIES = ["force", "intel", "chance", "agi"] as const;
export type Voie = (typeof VOIES)[number];
export const VOIE_LABEL: Record<Voie, string> = { force: "Terre", intel: "Feu", chance: "Eau", agi: "Air" };
/** Voie de chaque élément (Neutre..Air). */
export const VOIE_OF_ELEM: readonly Voie[] = ["force", "force", "intel", "chance", "agi"];

export const voieName = (voie: readonly Voie[]) => (voie.length ? voie.map((v) => VOIE_LABEL[v]).join(" / ") : "Multi");

/**
 * Une attaque convient à une voie si au moins la moitié de ses jets à élément fixe sont dans les éléments de la
 * voie. Les lignes « meilleur / pire élément » s'adaptent à toutes les voies.
 */
export function fitsVoie(a: Attack, voie: readonly Voie[] | undefined, heal = false): boolean {
  if (!voie?.length) return true;
  const sum: LineSum = heal ? a.heal : a.normal;
  let total = 0;
  let inside = 0;
  for (let e = 0; e < 5; e++) {
    total += sum.roll[e];
    if (voie.includes(VOIE_OF_ELEM[e])) inside += sum.roll[e];
  }
  return total === 0 || inside >= 0.5 * total;
}

/** Répartition des dégâts par élément en texte, ex. « Terre 70 % · Feu 30 % » (éléments ≥ 5 %). */
export function elementsLabel(shares: readonly number[]): string {
  return shares
    .map((x, e) => [x, e] as const)
    .filter(([x]) => x >= 0.05)
    .sort((a, b) => b[0] - a[0])
    .map(([x, e]) => `${ELEMENTS[e]} ${Math.round(x * 100)} %`)
    .join(" · ");
}
