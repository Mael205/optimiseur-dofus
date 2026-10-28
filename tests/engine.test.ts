// Tests unitaires des formules du moteur (valeurs calculées à la main).

import { describe, expect, it } from "vitest";
import type { ClassData, Cond, Item, ItemSet, MonsterRef } from "../src/engine/types";
import { N_STATS, S } from "../src/engine/statIds";
import { DEFAULT_RULES } from "../src/engine/rules";
import { aggregate, allocPoints, capped, emptyAlloc, hitPoints, pointsFor, setBonusCount, setBonusFor } from "../src/engine/stats";
import { evalCond } from "../src/engine/conditions";
import { type Attack, dmgContext, expectedDamage, weaponAttack } from "../src/engine/damage";
import { bestTurn, cycleValue, explainTurn, makeCycle } from "../src/engine/rotation";
import { effectiveHP } from "../src/engine/survival";
import { optimizeAllocation } from "../src/engine/allocation";

const TIERS: [number, number][] = [[0, 1], [100, 2], [200, 3], [300, 4]];
const CLS: ClassData = {
  id: 1,
  name: "Test",
  statCosts: { vita: [[0, 1]], sagesse: [[0, 3]], force: TIERS, intel: TIERS, chance: TIERS, agi: TIERS },
  spells: [],
};
const NO_RES: MonsterRef = { level: 100, res: [0, 0, 0, 0, 0], resFlat: [0, 0, 0, 0, 0], hp: 1000 };

const vec = (stats: Partial<Record<keyof typeof S, number>>) => {
  const v = new Float64Array(N_STATS);
  for (const [k, x] of Object.entries(stats)) v[S[k as keyof typeof S]] = x;
  return v;
};

const item = (id: number, stats: [number, number][], extra: Partial<Item> = {}): Item => ({
  id, name: `item ${id}`, typeId: 1, type: "Anneau", slot: "anneau", level: 1,
  stats: stats.map(([s, v]) => [s, v, v]), ...extra,
});

const attack = (ap: number, perTurn: number, interval = 0): Attack => {
  const sum = () => ({ roll: new Float64Array(5), count: new Float64Array(5), best: [], worst: [] });
  return {
    key: `a${ap}-${perTurn}-${interval}`, name: "", weapon: false, ap, minRange: 1, range: 5, boostable: true,
    perTurn, interval, crit: -1, melee: 0, normal: sum(), critical: sum(), heal: sum(), healCrit: sum(),
  };
};

describe("caractéristiques", () => {
  it("coût des paliers", () => {
    expect(pointsFor(TIERS, 0)).toBe(0);
    expect(pointsFor(TIERS, 100)).toBe(100);
    expect(pointsFor(TIERS, 150)).toBe(200);
    expect(pointsFor(TIERS, 250)).toBe(450);
    expect(pointsFor(TIERS, 310)).toBe(640);
    expect(allocPoints(CLS, { ...emptyAlloc(), vita: 50, sagesse: 10, force: 150 })).toBe(50 + 30 + 200);
  });

  it("répartition dans le budget, sans Sagesse", () => {
    const score = (a: ReturnType<typeof emptyAlloc>) => Math.log(100 + a.force) + 0.5 * Math.log(1000 + a.vita) + a.sagesse;
    const a = optimizeAllocation(CLS, 995, score);
    expect(allocPoints(CLS, a)).toBeLessThanOrEqual(995);
    expect(a.sagesse).toBe(0);
    expect(a.force).toBeGreaterThan(0);
    expect(a.vita).toBeGreaterThan(0);
  });
});

describe("panoplies", () => {
  const set: ItemSet = { id: 9, name: "Pano", items: [1, 2, 3, 4], bonus: { 2: [[S.vita, 50]], 4: [[S.vita, 200], [S.pa, 1]] } };

  it("palier le plus proche en dessous", () => {
    expect(setBonusFor(set, 1)).toEqual([]);
    expect(setBonusFor(set, 3)).toEqual([[S.vita, 50]]);
    expect(setBonusFor(set, 4)).toEqual([[S.vita, 200], [S.pa, 1]]);
  });

  it("nombre de bonus de panoplie (trophées)", () => {
    expect(setBonusCount([1, 2, 4], DEFAULT_RULES)).toBe(1 + 3);
    expect(setBonusCount([1, 2, 4], { ...DEFAULT_RULES, setBonusCount: "sets" })).toBe(2);
  });

  it("agrégation : base, parchemins, items et bonus", () => {
    const items = [1, 2, 3, 4].map((id) => item(id, [[S.force, 10]], { set: 9 }));
    const agg = aggregate({ cls: CLS, level: 100, alloc: { ...emptyAlloc(), force: 50 }, scrolls: true }, items, new Map([[9, set]]), DEFAULT_RULES);
    expect(agg.totals[S.pa]).toBe(7 + 1);
    expect(agg.totals[S.pm]).toBe(3);
    expect(agg.totals[S.force]).toBe(50 + 100 + 40);
    expect(agg.totals[S.vita]).toBe(100 + 200);
    expect(agg.setBonuses).toBe(3);
    expect(hitPoints(agg.totals, 100)).toBe(550 + 300);
  });

  it("exos de forgemagie : +1 PA / PM / PO", () => {
    const ch = { cls: CLS, level: 150, alloc: emptyAlloc(), scrolls: false, exo: { pa: true, po: true } };
    const agg = aggregate(ch, [], new Map(), DEFAULT_RULES);
    expect([agg.totals[S.pa], agg.totals[S.pm], agg.totals[S.po]]).toEqual([8, 3, 1]);
  });

  it("plafonds PA / PM / PO", () => {
    const t = capped(vec({ pa: 14, pm: 8, po: 9 }), DEFAULT_RULES);
    expect([t[S.pa], t[S.pm], t[S.po]]).toEqual([12, 6, 6]);
  });
});

describe("conditions", () => {
  const ctx = { totals: vec({ pa: 11, pm: 6 }), level: 150, setBonuses: 2 };
  it("feuilles et arbre et / ou", () => {
    const paLow: Cond = { stat: S.pa, cmp: "<", v: 12 };
    const pmLow: Cond = { stat: S.pm, cmp: "<", v: 6 };
    expect(evalCond(paLow, ctx)).toBe(true);
    expect(evalCond(pmLow, ctx)).toBe(false);
    expect(evalCond({ op: "and", c: [paLow, pmLow] }, ctx)).toBe(false);
    expect(evalCond({ op: "or", c: [paLow, pmLow] }, ctx)).toBe(true);
    expect(evalCond({ sets: true, cmp: "<", v: 2 }, ctx)).toBe(false);
    expect(evalCond({ level: true, cmp: ">", v: 149 }, ctx)).toBe(true);
  });
});

describe("dégâts", () => {
  const sword = (critRate: number) =>
    weaponAttack(
      item(1, [], {
        slot: "arme",
        weapon: { ap: 4, minRange: 1, range: 1, critRate, critBonus: 5, perTurn: 2, lines: [{ elem: 1, min: 10, max: 20, kind: "dmg" }] },
      }),
      0.5,
    )!;
  const totals = vec({ force: 100, puissance: 50, do: 10, doTerre: 5, doCrit: 10 });

  it("ligne : jet × (100 + carac + Puissance)/100 + dommages fixes", () => {
    const c = dmgContext(totals, NO_RES, DEFAULT_RULES);
    expect(expectedDamage(sword(0), c)).toBeCloseTo(15 * 2.5 + 15);
  });

  it("multiplicateurs % armes et % mêlée (arme au contact)", () => {
    const c = dmgContext(vec({ force: 100, puissance: 50, do: 10, doTerre: 5, pctArmes: 20, pctMelee: 10, pctDist: 50 }), NO_RES, DEFAULT_RULES);
    expect(expectedDamage(sword(0), c)).toBeCloseTo(52.5 * 1.2 * 1.1);
  });

  it("résistances fixes puis % du monstre", () => {
    const c = dmgContext(totals, { ...NO_RES, res: [0, 20, 0, 0, 0], resFlat: [0, 2, 0, 0, 0] }, DEFAULT_RULES);
    expect(expectedDamage(sword(0), c)).toBeCloseTo((52.5 - 2) * 0.8);
  });

  it("espérance avec coups critiques (bonus de jet + dommages critiques)", () => {
    const c = dmgContext(vec({ force: 100, puissance: 50, do: 10, doTerre: 5, doCrit: 10, crit: 20 }), NO_RES, DEFAULT_RULES);
    const normal = 52.5;
    const crit = 20 * 2.5 + 15 + 10;
    expect(expectedDamage(sword(30), c)).toBeCloseTo(0.5 * normal + 0.5 * crit);
  });
});

describe("rotation", () => {
  it("sac à dos borné sur les PA", () => {
    const attacks = [attack(4, 2), attack(3, 3)];
    const dp = new Float64Array(64);
    expect(bestTurn(attacks, [10, 7], [0, 1], 10, dp)).toBe(24);
    expect(bestTurn(attacks, [10, 7], [0, 1], 8, dp)).toBe(20);
    const t = explainTurn(attacks, [10, 7], [0, 1], 10);
    expect(t.damage).toBe(24);
    expect(t.apUsed).toBe(10);
    expect([...t.casts].sort()).toEqual([0, 1, 1]);
  });

  it("cycle des intervalles de relance", () => {
    const attacks = [attack(3, 1, 2), attack(3, 1, 3)];
    const cycle = makeCycle(attacks);
    expect(cycle.length).toBe(6);
    const weight = (avail: number[]) => cycle.turns.find((t) => t.avail.join() === avail.join())?.weight ?? 0;
    expect(weight([0, 1])).toBeCloseTo(1 / 6);
    expect(weight([0])).toBeCloseTo(2 / 6);
    expect(weight([1])).toBeCloseTo(1 / 6);
    expect(weight([])).toBeCloseTo(2 / 6);
    expect(cycleValue(attacks, [10, 30], cycle, 6, new Float64Array(64))).toBeCloseTo((40 + 2 * 10 + 30) / 6);
  });
});

describe("survie", () => {
  it("PV effectifs et plafond de résistance", () => {
    const inc = { elems: [0.2, 0.2, 0.2, 0.2, 0.2], melee: 0.5 };
    expect(effectiveHP(vec({}), 1, inc, DEFAULT_RULES)).toBeCloseTo(55);
    const res = (x: number) => vec({ rpNeutre: x, rpTerre: x, rpFeu: x, rpEau: x, rpAir: x });
    expect(effectiveHP(res(50), 1, inc, DEFAULT_RULES)).toBeCloseTo(110);
    expect(effectiveHP(res(80), 1, inc, DEFAULT_RULES)).toBeCloseTo(110);
  });

  it("résistances fixes rapportées au coup de référence (20 + 3 × niveau)", () => {
    const inc = { elems: [0, 1, 0, 0, 0], melee: 0.5 };
    expect(effectiveHP(vec({ rfTerre: 115 }), 100, inc, DEFAULT_RULES)).toBeCloseTo(550 / (205 / 320));
  });
});
