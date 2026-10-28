// Score d'un stuff : seuils de jouabilité (pénalité) + moyenne géométrique pondérée dégâts / survie
// + petits bonus d'utilité. Les poids dynamiques des stats (gradient) servent au solveur pour classer les items.

import type { ClassData, Item, MonsterRef } from "./types";
import { N_STATS, S } from "./statIds";
import {
  type Attack, type DmgContext, damageByElement, damageRange, dmgContext, expectedDamage, expectedHeal, gradeAt, hasHeal, spellAttack,
  weaponAttack,
} from "./damage";
import { type Cycle, chooseDeck, cycleValue, explainTurn, makeCycle, spellPairs } from "./rotation";
import { type IncomingProfile, effectiveHP } from "./survival";
import { capped } from "./stats";
import { type Voie, fitsVoie } from "./voies";
import type { Rules } from "./rules";
import profilesJson from "../data/classProfiles.json";
import targetsJson from "../data/levelTargets.json";

export interface ClassProfile {
  style: number;
  po: number;
  invo: number;
  summonK: number;
  heal: number;
}

export const classProfile = (name: string): ClassProfile =>
  (profilesJson as unknown as Record<string, ClassProfile>)[name] ?? { style: 0.5, po: 0, invo: 1, summonK: 0, heal: 0 };

export interface Targets {
  pa: number;
  pm: number;
  po: number;
  invo: number;
  /** Dégâts par tour minimum (0 : aucun). */
  dpt?: number;
  /** PV effectifs minimum : plancher interne du solveur pour combler les trous du front de Pareto. */
  ehp?: number;
}

export function defaultTargets(level: number, p: ClassProfile): Targets {
  let pa = 6;
  let pm = 3;
  for (const b of targetsJson.bands) if (level >= b.from) ({ pa, pm } = b);
  const scale = level >= 100 ? 1 : level >= 50 ? 0.5 : 0;
  return { pa, pm, po: Math.ceil(p.po * scale), invo: Math.max(1, Math.min(p.invo, level >= 100 ? 6 : level >= 50 ? 3 : 2)) };
}

export interface Weights {
  dmg: number;
  surv: number;
}

export const ROLES = {
  dps: { label: "DPS", w: { dmg: 0.8, surv: 0.2 } },
  equilibre: { label: "Équilibré", w: { dmg: 0.6, surv: 0.4 } },
  tank: { label: "Tank / soutien", w: { dmg: 0.35, surv: 0.65 } },
} as const;

export type Role = keyof typeof ROLES;

export interface Setup {
  cls: ClassData;
  level: number;
  profile: ClassProfile;
  targets: Targets;
  weights: Weights;
  monster: MonsterRef;
  incoming: IncomingProfile;
  rules: Rules;
  /** Voie imposée : seuls les sorts de ces éléments sont joués. */
  voie?: readonly Voie[];
}

export interface Evaluation {
  score: number;
  dpt: number;
  ehp: number;
  hpt: number;
  penalty: number;
}

/** Bonus d'utilité : [stat, coefficient, échelle], valeur coef × ln(1 + x / échelle). */
const UTILITY: [number, number, number][] = [
  [S.ini, 0.01, 1000], [S.tacle, 0.01, 30], [S.fuite, 0.01, 30], [S.esqPA, 0.008, 40], [S.esqPM, 0.008, 40],
  [S.retPA, 0.004, 30], [S.retPM, 0.004, 30], [S.prospe, 0.002, 100], [S.rfCrit, 0.004, 50], [S.rfPou, 0.002, 50],
];
const PM_BONUS = 0.03;
const PO_BONUS = 0.01;
/** Pénalité par point manquant sous un seuil, et par condition d'item non remplie (unités de ln). */
export const THRESHOLD_PENALTY = 1;
export const COND_PENALTY = 3;
/** Pénalité par unité de ln sous les dégâts par tour minimum : bien plus que ce que la survie peut rapporter. */
export const MIN_DPT_PENALTY = 3;

/** Pas de dérivation numérique par stat (stats discrètes : différence arrière, la valeur de ce qu'on perdrait). */
const DISCRETE = new Set([S.pa, S.pm, S.po, S.invo]);
const STEP: Partial<Record<number, number>> = { [S.vita]: 50, [S.ini]: 100, [S.pods]: 100, [S.prospe]: 20 };
for (const s of [S.force, S.intel, S.chance, S.agi, S.puissance, S.sagesse]) STEP[s] = 20;

export class Evaluator {
  readonly deck: Attack[];
  readonly heals: Attack[];
  private readonly cycle: Cycle;
  private readonly cycleW: Cycle;
  private readonly healCycle: Cycle;
  private readonly values: Float64Array;
  private readonly healValues: Float64Array;
  private readonly dp = new Float64Array(64);
  private readonly weapons = new Map<number, Attack | undefined>();
  private readonly attacks: Attack[];

  constructor(readonly setup: Setup, deck: Attack[]) {
    this.deck = deck;
    this.attacks = [...deck];
    this.cycle = makeCycle(deck);
    // L'arme (sans intervalle) est la dernière attaque, disponible à chaque tour.
    this.cycleW = { length: this.cycle.length, turns: this.cycle.turns.map((t) => ({ ...t, avail: [...t.avail, deck.length] })) };
    this.values = new Float64Array(deck.length + 1);
    this.heals = setup.profile.heal > 0 ? healAttacks(setup.cls, setup.level, setup.profile.style, setup.voie) : [];
    this.healCycle = makeCycle(this.heals);
    this.healValues = new Float64Array(this.heals.length);
  }

  /** Construit l'évaluateur en choisissant les variantes de sorts adaptées aux stats données. */
  static forStats(setup: Setup, totals: Float64Array): Evaluator {
    const t = capped(totals, setup.rules);
    const ctx = dmgContext(t, setup.monster, setup.rules);
    const deck = chooseDeck(spellPairs(setup.cls, setup.level, setup.profile.style, setup.voie), ctx, t[S.pa]);
    return new Evaluator(setup, deck);
  }

  weaponAttack(item: Item | null): Attack | undefined {
    if (!item?.weapon) return undefined;
    if (!this.weapons.has(item.id)) this.weapons.set(item.id, weaponAttack(item, this.setup.profile.style));
    return this.weapons.get(item.id);
  }

  /** Dégâts par tour (totaux plafonnés), invocations comprises. */
  dpt(t: Float64Array, ctx: DmgContext, weapon: Item | null): number {
    const w = this.weaponAttack(weapon);
    for (let i = 0; i < this.deck.length; i++) this.values[i] = expectedDamage(this.deck[i], ctx);
    let cycle = this.cycle;
    if (w) {
      this.attacks[this.deck.length] = w;
      this.values[this.deck.length] = expectedDamage(w, ctx);
      cycle = this.cycleW;
    }
    const pa = Math.max(0, Math.min(this.dp.length - 1, Math.floor(t[S.pa])));
    const base = cycleValue(this.attacks, this.values, cycle, pa, this.dp);
    const extraInvo = Math.min(6, Math.max(0, t[S.invo] - 1));
    return base * (1 + this.setup.profile.summonK * extraInvo);
  }

  hpt(t: Float64Array, ctx: DmgContext): number {
    if (!this.heals.length) return 0;
    for (let i = 0; i < this.heals.length; i++) this.healValues[i] = expectedHeal(this.heals[i], ctx);
    return cycleValue(this.heals, this.healValues, this.healCycle, Math.floor(t[S.pa]), this.dp);
  }

  /** Évalue un stuff à partir de ses totaux non plafonnés. */
  evaluate(totals: Float64Array, weapon: Item | null, condFailures = 0): Evaluation {
    const { rules, level, targets, weights, profile, monster, incoming } = this.setup;
    const t = capped(totals, rules);
    const ctx = dmgContext(t, monster, rules);
    const dpt = this.dpt(t, ctx, weapon);
    const hpt = this.hpt(t, ctx);
    const ehp = effectiveHP(t, level, incoming, rules);

    let penalty = condFailures * COND_PENALTY;
    penalty += THRESHOLD_PENALTY * (Math.max(0, targets.pa - t[S.pa]) + Math.max(0, targets.pm - t[S.pm]));
    penalty += THRESHOLD_PENALTY * (Math.max(0, targets.po - t[S.po]) + Math.max(0, targets.invo - t[S.invo]));
    if (targets.dpt && dpt < targets.dpt) penalty += MIN_DPT_PENALTY * Math.log(targets.dpt / Math.max(1, dpt));
    if (targets.ehp && ehp < targets.ehp) penalty += MIN_DPT_PENALTY * Math.log(targets.ehp / ehp);

    let utility = PM_BONUS * Math.max(0, t[S.pm] - targets.pm) + PO_BONUS * Math.max(0, t[S.po] - targets.po);
    for (const [s, coef, scale] of UTILITY) utility += coef * Math.log1p(Math.max(0, t[s]) / scale);

    const score =
      weights.dmg * Math.log(Math.max(1, dpt)) +
      weights.surv * Math.log(ehp) +
      profile.heal * Math.log1p(hpt) +
      utility -
      penalty;
    return { score, dpt, ehp, hpt, penalty };
  }

  /** Détail des attaques et des tours du cycle (affichage). */
  explain(totals: Float64Array, weapon: Item | null) {
    const { rules, monster } = this.setup;
    const t = capped(totals, rules);
    const ctx = dmgContext(t, monster, rules);
    const w = this.weaponAttack(weapon);
    const attacks = w ? [...this.deck, w] : this.deck;
    const values = attacks.map((a) => expectedDamage(a, ctx));
    const cycle = w ? this.cycleW : this.cycle;
    const pa = Math.max(0, Math.floor(t[S.pa]));
    const byElem = attacks.map((a) => damageByElement(a, ctx));
    const elements = new Float64Array(5);
    const turns = mergeTurns(
      cycle.turns.map((turn) => {
        const r = explainTurn(attacks, values, turn.avail, pa);
        for (const i of r.casts) for (let e = 0; e < 5; e++) elements[e] += turn.weight * byElem[i][e];
        return { weight: turn.weight, casts: r.casts.map((i) => attacks[i].name), damage: r.damage, apUsed: r.apUsed };
      }),
    );
    const total = elements.reduce((a, b) => a + b, 0);
    const hv = this.heals.map((a) => expectedHeal(a, ctx));
    const heals = mergeTurns(
      this.heals.length
        ? this.healCycle.turns.map((turn) => {
            const r = explainTurn(this.heals, hv, turn.avail, pa);
            return { weight: turn.weight, casts: r.casts.map((i) => this.heals[i].name), damage: r.damage, apUsed: r.apUsed };
          })
        : [],
    );
    return {
      attacks: attacks.map((a, i) => ({ name: a.name, ap: a.ap, weapon: a.weapon, expected: values[i], ...damageRange(a, ctx) })),
      turns,
      /** Tours de soin du cycle (`damage` = soins du tour). */
      heals,
      /** Part des dégâts du cycle par élément (Neutre..Air). */
      elements: [...elements].map((x) => (total > 0 ? x / total : 0)),
    };
  }

  /**
   * Valeur marginale de chaque stat (score par point) au stuff donné. Pour les stats discrètes (PA, PM, PO,
   * invocations), on prend la valeur du point qu'on perdrait, pour ne pas sous-estimer un seuil tout juste atteint.
   */
  gradient(totals: Float64Array, weapon: Item | null): Float64Array {
    const g = new Float64Array(N_STATS);
    const base = this.evaluate(totals, weapon).score;
    const t = totals.slice();
    for (let s = 0; s < N_STATS; s++) {
      if (s === S.sagesse || s === S.pods) continue;
      const h = STEP[s] ?? 1;
      t[s] = totals[s] + h;
      const up = (this.evaluate(t, weapon).score - base) / h;
      t[s] = totals[s] - h;
      const down = (base - this.evaluate(t, weapon).score) / h;
      t[s] = totals[s];
      g[s] = DISCRETE.has(s) ? Math.max(up, down) : (up + down) / 2;
    }
    return g;
  }
}

/** Sorts de soin (de la voie donnée) : le meilleur de chaque paire de variantes. */
export interface TurnDetail {
  weight: number;
  casts: string[];
  damage: number;
  apUsed: number;
}

/** Regroupe les tours identiques du cycle (mêmes lancers), en additionnant leurs parts. */
function mergeTurns(turns: TurnDetail[]): TurnDetail[] {
  const byKey = new Map<string, TurnDetail>();
  for (const t of turns) {
    const key = [...t.casts].sort().join("|");
    const prev = byKey.get(key);
    if (prev) prev.weight += t.weight;
    else byKey.set(key, { ...t });
  }
  return [...byKey.values()].sort((a, b) => b.weight - a.weight);
}

export function healAttacks(cls: ClassData, level: number, style: number, voie?: readonly Voie[]): Attack[] {
  const byPair = new Map<number, Attack>();
  for (const s of cls.spells) {
    const g = gradeAt(s, level);
    if (!g) continue;
    const a = spellAttack(s, g, style);
    if (!hasHeal(a) || !fitsVoie(a, voie, true)) continue;
    const cur = byPair.get(s.pair);
    const rate = (x: Attack) => (x.heal.roll.reduce((n, r) => n + r, 0) + x.heal.best.reduce((n, r) => n + r, 0)) / Math.max(1, x.ap);
    if (!cur || rate(a) > rate(cur)) byPair.set(s.pair, a);
  }
  return [...byPair.values()];
}
