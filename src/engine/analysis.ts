// Éléments d'une classe : potentiel de chaque voie (dégâts et soins par tour d'un personnage de référence tout
// investi dans la caractéristique de la voie, en ne jouant que les sorts de ses éléments).

import type { ClassData, MonsterRef } from "./types";
import { N_STATS, S } from "./statIds";
import type { Rules } from "./rules";
import { dmgContext, expectedDamage, expectedHeal } from "./damage";
import { chooseDeck, cycleValue, makeCycle, spellPairs } from "./rotation";
import { type ClassProfile, type Targets, healAttacks } from "./score";
import { VOIES, VOIE_LABEL, type Voie } from "./voies";

export interface VoieInfo {
  voie: Voie;
  label: string;
  dpt: number;
  heal: number;
  /** Rapport au meilleur élément de la classe (0..1). */
  rel: number;
  healRel: number;
  /** Sorts joués dans cette voie. */
  spells: string[];
}

/** Seuils de classement des voies : principale, jouable (en dessous : secondaire). */
export const MAIN_VOIE = 0.9;
export const PLAYABLE_VOIE = 0.7;

export function analyzeVoies(cls: ClassData, level: number, profile: ClassProfile, targets: Targets, monster: MonsterRef, rules: Rules): VoieInfo[] {
  const pa = Math.min(targets.pa, rules.capPA);
  const dp = new Float64Array(64);
  const raw = VOIES.map((voie) => {
    // Ordre de grandeur d'un personnage du niveau : parchemins + points + équipement dans la caractéristique.
    const t = new Float64Array(N_STATS);
    t[S.pa] = pa;
    t[S.pm] = targets.pm;
    t[S.po] = targets.po;
    t[S[voie]] = 100 + 6 * level;
    t[S.puissance] = level / 2;
    t[S.do] = level / 10;
    const ctx = dmgContext(t, monster, rules);
    const deck = chooseDeck(spellPairs(cls, level, profile.style, [voie]), ctx, pa);
    const dpt = deck.length ? cycleValue(deck, deck.map((a) => expectedDamage(a, ctx)), makeCycle(deck), pa, dp) : 0;
    const heals = profile.heal > 0 ? healAttacks(cls, level, profile.style, [voie]) : [];
    const heal = heals.length ? cycleValue(heals, heals.map((a) => expectedHeal(a, ctx)), makeCycle(heals), pa, dp) : 0;
    return { voie, label: VOIE_LABEL[voie], dpt, heal, spells: deck.map((a) => a.name) };
  });
  const bestDpt = Math.max(1, ...raw.map((r) => r.dpt));
  const bestHeal = Math.max(1, ...raw.map((r) => r.heal));
  return raw
    .map((r) => ({ ...r, rel: r.dpt / bestDpt, healRel: r.heal / bestHeal }))
    .sort((a, b) => b.rel + b.healRel * profile.heal - (a.rel + a.healRel * profile.heal));
}
