// Formule de dégâts (espérance, coups critiques compris) contre un monstre de référence.
//
//   ligne    = jet × (100 + carac_élément + Puissance)/100 + Dommages + Dommages_élément [+ Dommages critiques]
//   attaque  = Σ lignes × (1 + %dommages sorts | armes) × (1 + %mêlée | %distance)
//   subi     = (attaque − résistance fixe) × (1 − %résistance)
//
// La formule est linéaire par élément : chaque attaque est résumée par la somme des jets et le nombre de lignes
// de chaque élément, ce qui rend l'évaluation d'un stuff très rapide.

import type { DmgLine, Item, MonsterRef, Spell, SpellGrade, SpellLine } from "./types";
import { ELEM_CARAC, ELEM_DO, S } from "./statIds";
import type { Rules } from "./rules";

export interface LineSum {
  /** Σ jets moyens des lignes de chaque élément (Neutre..Air). */
  roll: Float64Array;
  /** Nombre (pondéré par la probabilité) de lignes de chaque élément. */
  count: Float64Array;
  /** Jets moyens des lignes « meilleur élément » et « pire élément ». */
  best: number[];
  worst: number[];
}

export interface Attack {
  key: string;
  name: string;
  spellId?: number;
  pair?: number;
  weapon: boolean;
  ap: number;
  minRange: number;
  range: number;
  boostable: boolean;
  /** Lancers max par tour sur une même cible (0 = illimité). */
  perTurn: number;
  /** Tours entre deux lancers (0 ou 1 = chaque tour). */
  interval: number;
  /** Taux critique de base en %, ou -1 si l'attaque n'a pas d'effet critique. */
  crit: number;
  /** Part des lancers faits au corps à corps (0..1). */
  melee: number;
  /** Bonus moyen de dégâts de base par ligne, pour les sorts qui se renforcent à chaque lancer. */
  boost?: number;
  normal: LineSum;
  critical: LineSum;
  heal: LineSum;
  healCrit: LineSum;
}

export interface DmgContext {
  /** Multiplicateur de jet par élément : (100 + carac + Puissance)/100. */
  A: Float64Array;
  /** Dommages fixes par élément. */
  F: Float64Array;
  /** Multiplicateur de jet des soins par élément. */
  H: Float64Array;
  soin: number;
  doCrit: number;
  crit: number;
  spellMult: number;
  weaponMult: number;
  meleeMult: number;
  distMult: number;
  /** 1 − %résistance du monstre, par élément. */
  k: Float64Array;
  /** Résistance fixe du monstre, par élément. */
  flat: Float64Array;
}

const emptySum = (): LineSum => ({ roll: new Float64Array(5), count: new Float64Array(5), best: [], worst: [] });

function addLine(sum: LineSum, l: DmgLine & { p?: number }, bonus = 0) {
  const p = l.p ?? 1;
  const r = ((l.min + l.max) / 2 + bonus) * p;
  if (l.elem >= 0) {
    sum.roll[l.elem] += r;
    sum.count[l.elem] += p;
  } else (l.elem === -1 ? sum.best : sum.worst).push(r);
}

const sumOf = (lines: readonly (DmgLine & { p?: number })[], bonus = 0) => {
  const s = emptySum();
  for (const l of lines) addLine(s, l, bonus);
  return s;
};

const avgTotal = (lines: readonly SpellLine[]) => lines.reduce((n, l) => n + ((l.min + l.max) / 2) * (l.p ?? 1), 0);

/**
 * Lignes retenues pour un sort : celles sans condition d'état. Si toutes les lignes d'un type demandent un état
 * (sort à mise en place), on prend le groupe d'état le plus fort. Renvoie aussi l'état retenu.
 */
function pickLines(lines: readonly SpellLine[], heal: boolean): [SpellLine[], string | undefined] {
  const own = lines.filter((l) => (l.kind === "heal") === heal);
  const plain = own.filter((l) => !l.state);
  if (plain.length || !own.length) return [plain, undefined];
  const groups = new Map<string, SpellLine[]>();
  for (const l of own) groups.set(l.state!, [...(groups.get(l.state!) ?? []), l]);
  let best: [SpellLine[], string | undefined] = [[], undefined];
  for (const [state, g] of groups) if (avgTotal(g) > avgTotal(best[0])) best = [g, state];
  return best;
}

/** Lignes critiques correspondant au même choix d'état que les lignes normales. */
function pickCritLines(crit: readonly SpellLine[], heal: boolean, state: string | undefined): SpellLine[] {
  const own = crit.filter((l) => (l.kind === "heal") === heal && l.state === state);
  return own.length ? own : pickLines(crit, heal)[0];
}

/** Grade d'un sort disponible au niveau donné (le plus haut débloqué). */
export function gradeAt(spell: Spell, level: number): SpellGrade | undefined {
  let g: SpellGrade | undefined;
  for (const x of spell.grades) if (x.level <= level) g = x;
  return g;
}

/** Durée (tours) du combat de référence sur lequel on moyenne les bonus qui montent au fil des lancers. */
export const BOOST_FIGHT_TURNS = 6;

/**
 * Bonus moyen de dégâts de base par lancer d'un sort qui se renforce lui-même, lancé dès qu'il est disponible et
 * autant de fois que permis par tour, sur un combat de référence (montée en puissance comprise). Un bonus posé au
 * tour t avec un délai d est actif des tours t+d à t+d+durée−1 ; sans délai, il profite aussi aux lancers
 * suivants du même tour. Au-delà du cumul maximum, on garde les plus gros bonus.
 */
export function boostPerCast(g: SpellGrade): number {
  if (!g.boosts?.length) return 0;
  const n = g.interval >= 1 ? 1 : Math.min(minNonZero(g.perTurn, g.perTarget) || 3, 3);
  const cap = g.maxStack && g.maxStack > 0 ? g.maxStack : Infinity;
  const buffs: { value: number; from: number; to: number; order: number }[] = [];
  let total = 0;
  let casts = 0;
  for (let t = 0; t < BOOST_FIGHT_TURNS; t += Math.max(1, g.interval)) {
    for (let c = 0; c < n; c++) {
      const on = buffs.filter((b) => b.from <= t && t <= b.to && (b.from < t || b.order < c)).map((b) => b.value);
      total += on.sort((a, b) => b - a).slice(0, cap).reduce((s, v) => s + v, 0);
      casts++;
      for (const b of g.boosts) buffs.push({ value: b.value, from: t + b.delay, to: t + b.delay + b.duration - 1, order: b.delay ? -1 : c });
    }
  }
  return total / casts;
}

/** Ajoute le bonus de dégâts de base aux lignes directes (immédiates) du sort. */
const boosted = (lines: SpellLine[], bonus: number) =>
  bonus ? lines.map((l) => (l.kind !== "heal" && l.trig === "I" ? { ...l, min: l.min + bonus, max: l.max + bonus } : l)) : lines;

/** Part de corps à corps : forcée par la portée du sort, sinon le style de jeu de la classe. */
const meleeShare = (minRange: number, range: number, style: number) => (range <= 1 ? 1 : minRange >= 2 ? 0 : style);

export function spellAttack(spell: Spell, grade: SpellGrade, style: number): Attack {
  const [dmg, dmgState] = pickLines(grade.lines, false);
  const [heal, healState] = pickLines(grade.lines, true);
  const boost = boostPerCast(grade);
  return {
    key: `s${spell.id}`,
    name: spell.name,
    spellId: spell.id,
    pair: spell.pair,
    weapon: false,
    ap: grade.ap,
    minRange: grade.minRange,
    range: grade.range,
    boostable: grade.boostable,
    perTurn: minNonZero(grade.perTurn, grade.perTarget),
    interval: grade.interval,
    crit: grade.critLines.length && grade.crit > 0 ? grade.crit : -1,
    melee: meleeShare(grade.minRange, grade.range, style),
    boost: boost || undefined,
    normal: sumOf(boosted(dmg, boost)),
    critical: sumOf(boosted(pickCritLines(grade.critLines, false, dmgState), boost)),
    heal: sumOf(heal),
    healCrit: sumOf(pickCritLines(grade.critLines, true, healState)),
  };
}

export function weaponAttack(item: Item, style: number): Attack | undefined {
  const w = item.weapon;
  if (!w) return undefined;
  const dmg = w.lines.filter((l) => l.kind !== "heal");
  const heal = w.lines.filter((l) => l.kind === "heal");
  return {
    key: "w",
    name: item.name,
    weapon: true,
    ap: w.ap,
    minRange: w.minRange,
    range: w.range,
    boostable: false,
    perTurn: w.perTurn,
    interval: 0,
    crit: w.critRate > 0 ? w.critRate : -1,
    melee: meleeShare(w.minRange, w.range, style),
    normal: sumOf(dmg),
    critical: sumOf(dmg, w.critBonus),
    heal: sumOf(heal),
    healCrit: sumOf(heal, w.critBonus),
  };
}

const minNonZero = (a: number, b: number) => (a > 0 && b > 0 ? Math.min(a, b) : a > 0 ? a : b);

export const hasDamage = (a: Attack) => a.normal.count.some((n) => n > 0) || a.normal.best.length + a.normal.worst.length > 0;
export const hasHeal = (a: Attack) => a.heal.count.some((n) => n > 0) || a.heal.best.length > 0;

export function dmgContext(totals: ArrayLike<number>, monster: MonsterRef, rules: Rules): DmgContext {
  const A = new Float64Array(5);
  const F = new Float64Array(5);
  const H = new Float64Array(5);
  const k = new Float64Array(5);
  const flat = new Float64Array(5);
  const pui = totals[S.puissance];
  for (let e = 0; e < 5; e++) {
    const carac = totals[ELEM_CARAC[e]];
    A[e] = Math.max(0, 100 + carac + pui) / 100;
    H[e] = Math.max(0, 100 + carac + (rules.healUsesPower ? pui : 0)) / 100;
    F[e] = totals[S.do] + totals[ELEM_DO[e]];
    k[e] = 1 - monster.res[e] / 100;
    flat[e] = monster.resFlat[e];
  }
  return {
    A, F, H, k, flat,
    soin: totals[S.soin],
    doCrit: totals[S.doCrit],
    crit: totals[S.crit],
    spellMult: Math.max(0, 1 + totals[S.pctSorts] / 100),
    weaponMult: Math.max(0, 1 + totals[S.pctArmes] / 100),
    meleeMult: Math.max(0, 1 + totals[S.pctMelee] / 100),
    distMult: Math.max(0, 1 + totals[S.pctDist] / 100),
  };
}

function lineSumDamage(s: LineSum, c: DmgContext, mult: number, extraF: number): number {
  let d = 0;
  for (let e = 0; e < 5; e++) {
    const n = s.count[e];
    if (n === 0) continue;
    d += Math.max(0, (mult * (s.roll[e] * c.A[e] + n * (c.F[e] + extraF)) - n * c.flat[e]) * c.k[e]);
  }
  for (const r of s.best) {
    let b = 0;
    for (let e = 0; e < 5; e++) b = Math.max(b, (mult * (r * c.A[e] + c.F[e] + extraF) - c.flat[e]) * c.k[e]);
    d += b;
  }
  for (const r of s.worst) {
    let w = Infinity;
    for (let e = 0; e < 5; e++) w = Math.min(w, (mult * (r * c.A[e] + c.F[e] + extraF) - c.flat[e]) * c.k[e]);
    d += Math.max(0, w);
  }
  return d;
}

export const critChance = (a: Attack, c: DmgContext) => (a.crit < 0 ? 0 : Math.min(1, Math.max(0, (a.crit + c.crit) / 100)));

const attackMult = (a: Attack, c: DmgContext) =>
  (a.weapon ? c.weaponMult : c.spellMult) * (a.melee * c.meleeMult + (1 - a.melee) * c.distMult);

/** Dégâts moyens d'un lancer (coups critiques compris). */
export function expectedDamage(a: Attack, c: DmgContext): number {
  const m = attackMult(a, c);
  const p = critChance(a, c);
  const normal = lineSumDamage(a.normal, c, m, 0);
  return p === 0 ? normal : (1 - p) * normal + p * lineSumDamage(a.critical, c, m, c.doCrit);
}

/** Dégâts d'un lancer, normal et critique, sans espérance (affichage et calibration). */
export function damageRange(a: Attack, c: DmgContext) {
  const m = attackMult(a, c);
  return { normal: lineSumDamage(a.normal, c, m, 0), critical: lineSumDamage(a.critical, c, m, c.doCrit), critChance: critChance(a, c) };
}

/** Même calcul que lineSumDamage, ventilé par élément (les lignes meilleur / pire élément vont à l'élément retenu). */
function lineSumByElement(s: LineSum, c: DmgContext, mult: number, extraF: number, out: Float64Array, w: number) {
  const hit = (r: number, n: number, e: number) => (mult * (r * c.A[e] + n * (c.F[e] + extraF)) - n * c.flat[e]) * c.k[e];
  for (let e = 0; e < 5; e++) if (s.count[e]) out[e] += w * Math.max(0, hit(s.roll[e], s.count[e], e));
  for (const r of s.best) {
    let be = 0;
    for (let e = 1; e < 5; e++) if (hit(r, 1, e) > hit(r, 1, be)) be = e;
    out[be] += w * Math.max(0, hit(r, 1, be));
  }
  for (const r of s.worst) {
    let we = 0;
    for (let e = 1; e < 5; e++) if (hit(r, 1, e) < hit(r, 1, we)) we = e;
    out[we] += w * Math.max(0, hit(r, 1, we));
  }
}

/** Dégâts moyens d'un lancer par élément (Neutre..Air). */
export function damageByElement(a: Attack, c: DmgContext): Float64Array {
  const out = new Float64Array(5);
  const m = attackMult(a, c);
  const p = critChance(a, c);
  lineSumByElement(a.normal, c, m, 0, out, 1 - p);
  if (p > 0) lineSumByElement(a.critical, c, m, c.doCrit, out, p);
  return out;
}

function lineSumHeal(s: LineSum, c: DmgContext): number {
  let h = 0;
  for (let e = 0; e < 5; e++) if (s.count[e]) h += s.roll[e] * c.H[e] + s.count[e] * c.soin;
  for (const r of s.best) h += r * Math.max(...c.H) + c.soin;
  return h;
}

/** Soins moyens d'un lancer. */
export function expectedHeal(a: Attack, c: DmgContext): number {
  const p = critChance(a, c);
  const normal = lineSumHeal(a.heal, c);
  return p === 0 ? normal : (1 - p) * normal + p * lineSumHeal(a.healCrit, c);
}
