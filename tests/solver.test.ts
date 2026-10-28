// Propriétés des stuffs produits par le solveur, sur les vraies données (public/data).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GameData } from "../src/engine/types";
import { DEFAULT_RULES, statPointsAt } from "../src/engine/rules";
import { ROLES, classProfile, defaultTargets } from "../src/engine/score";
import { SLOTS, aggregate, allocPoints, buildProblems } from "../src/engine/stats";
import { type SolveRequest, Solver, nearestMonster, solve } from "../src/engine/solver";
import { runTask, solveParallel } from "../src/engine/parallel";
import { MAIN_VOIE, analyzeVoies } from "../src/engine/analysis";
import { boostPerCast } from "../src/engine/damage";
import { VOIE_OF_ELEM } from "../src/engine/voies";

const dir = join(import.meta.dirname, "..", "public", "data");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const data: GameData = { meta: load("meta"), items: load("items"), sets: load("sets"), classes: load("classes"), monsters: load("monsters") };
const sets = new Map(data.sets.map((s) => [s.id, s]));
const classId = (name: string) => data.classes.find((c) => c.name === name)!.id;

function check(req: SolveRequest) {
  const res = solve(data, req);
  const cls = data.classes.find((c) => c.id === req.classId)!;
  expect(res.builds.length).toBeGreaterThan(0);
  expect(res.builds[res.highlighted].weights).toEqual(req.weights);
  for (const b of res.builds) {
    const ch = { cls, level: req.level, alloc: b.alloc, scrolls: req.scrolls ?? true, exo: req.exo };
    // niveau, conditions des items, doublons
    expect(buildProblems(ch, b.items, aggregate(ch, b.items, sets, DEFAULT_RULES))).toEqual([]);
    b.items.forEach((it, p) => {
      if (it) expect(it.slot).toBe(SLOTS[p]);
    });
    const ids = b.items.flatMap((it) => (it ? [it.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(allocPoints(cls, b.alloc)).toBeLessThanOrEqual(statPointsAt(req.level, DEFAULT_RULES));
    expect(b.evaluation.dpt).toBeGreaterThan(0);
  }
  // front de Pareto : du plus offensif au plus défensif, aucun stuff dominé
  for (let i = 1; i < res.builds.length; i++) expect(res.builds[i].evaluation.dpt).toBeLessThanOrEqual(res.builds[i - 1].evaluation.dpt);
  return res;
}

describe("solveur", () => {
  it("Iop 200 équilibré", () => {
    check({ classId: classId("Iop"), level: 200, weights: ROLES.equilibre.w });
  });

  it("Osamodas 150 : invocations visées", () => {
    const res = check({ classId: classId("Osamodas"), level: 150, weights: ROLES.dps.w });
    const b = res.builds[res.highlighted];
    expect(b.problems.filter((p) => p.startsWith("Invocations"))).toEqual([]);
  });

  it("Crâ 60 : items verrouillés et bannis respectés", () => {
    const first = check({ classId: classId("Crâ"), level: 60, weights: ROLES.equilibre.w });
    const b = first.builds[first.highlighted];
    const amulet = b.items[0]!;
    const cape = b.items[SLOTS.indexOf("cape")]!;
    const locked = SLOTS.map((_, p) => (p === SLOTS.indexOf("cape") ? cape.id : null));
    const res = check({ classId: classId("Crâ"), level: 60, weights: ROLES.equilibre.w, locked, banned: [amulet.id] });
    for (const x of res.builds) {
      expect(x.items[SLOTS.indexOf("cape")]?.id).toBe(cape.id);
      expect(x.items.some((it) => it?.id === amulet.id)).toBe(false);
    }
  });

  it("Sram 20 : petit niveau", () => {
    check({ classId: classId("Sram"), level: 20, weights: ROLES.tank.w });
  });
});

describe("objectifs et calcul parallèle", () => {
  it("dégâts minimum par tour : le stuff du rôle devient plus offensif", () => {
    const req: SolveRequest = { classId: classId("Crâ"), level: 60, weights: ROLES.tank.w };
    const free = check(req);
    const base = free.builds[free.highlighted].evaluation.dpt;
    const res = check({ ...req, targets: { dpt: Math.round(base * 1.15) } });
    expect(res.targets.dpt).toBe(Math.round(base * 1.15));
    expect(res.builds[res.highlighted].evaluation.dpt).toBeGreaterThan(base);
  });

  it("calcul en plusieurs parties : stuffs valides, front ordonné", async () => {
    const req: SolveRequest = { classId: classId("Sram"), level: 40, weights: ROLES.equilibre.w };
    const cls = data.classes.find((c) => c.id === req.classId)!;
    const exec = async (task: Parameters<typeof runTask>[1]) => runTask(data, task);
    const res = await solveParallel(req, 3, exec);
    expect(res.builds[res.highlighted].weights).toEqual(req.weights);
    for (const b of res.builds) {
      const ch = { cls, level: req.level, alloc: b.alloc, scrolls: true, exo: req.exo };
      expect(buildProblems(ch, b.items, aggregate(ch, b.items, sets, DEFAULT_RULES))).toEqual([]);
    }
    for (let i = 1; i < res.builds.length; i++) expect(res.builds[i].evaluation.dpt).toBeLessThanOrEqual(res.builds[i - 1].evaluation.dpt);
  });
});

describe("voies et soins", () => {
  const voies = (name: string, level = 200) => {
    const cls = data.classes.find((c) => c.name === name)!;
    const p = classProfile(cls.name);
    return analyzeVoies(cls, level, p, defaultTargets(level, p), nearestMonster(data.monsters, level), DEFAULT_RULES);
  };
  const main = (name: string) => voies(name).filter((v) => v.rel >= MAIN_VOIE).map((v) => v.label);

  it("éléments principaux connus des classes", () => {
    expect(main("Iop")).toContain("Terre");
    expect(main("Crâ")).toContain("Feu");
    expect(main("Sadida")).toEqual(["Feu"]);
  });

  it("Eniripsa : soins comptés dans chaque voie", () => {
    for (const v of voies("Eniripsa")) expect(v.heal).toBeGreaterThan(0);
    const res = solve(data, { classId: classId("Eniripsa"), level: 100, weights: ROLES.equilibre.w, voie: ["intel"] });
    expect(res.builds[res.highlighted].evaluation.hpt).toBeGreaterThan(0);
  });

  it("stuff restreint à une voie : dégâts dans ses éléments", () => {
    const res = solve(data, { classId: classId("Crâ"), level: 150, weights: ROLES.dps.w, voie: ["agi"] });
    for (const b of res.builds) {
      const inside = b.rotation.elements.reduce((s, x, e) => s + (VOIE_OF_ELEM[e] === "agi" ? x : 0), 0);
      expect(inside).toBeGreaterThan(0.8);
    }
  });

  it("sorts qui se renforcent : bonus moyen sur le combat de référence", () => {
    const grade = (name: string) => data.classes.flatMap((c) => c.spells).find((s) => s.name === name)!.grades.at(-1)!;
    // Colère de Iop : +110 à la récupération (tous les 3 tours) → lancers aux tours 0 et 3, bonus au second
    expect(boostPerCast(grade("Colère de Iop"))).toBeCloseTo(55);
    // Accumulation : +24 pendant 3 tours, cumul 1, 2 lancers par tour → tous les lancers sauf le premier
    expect(boostPerCast(grade("Accumulation"))).toBeCloseTo((24 * 11) / 12);
    // conditionnel (cible Téléfrag) : ignoré
    expect(boostPerCast(grade("Horloge"))).toBe(0);
  });
});

describe("évaluation d'un stuff donné (comparateur)", () => {
  const req: SolveRequest = { classId: classId("Iop"), level: 120, weights: ROLES.equilibre.w };
  const res = solve(data, req);
  const b = res.builds[res.highlighted];
  const ids = b.items.map((it) => it?.id ?? null);

  it("avec sa répartition : mêmes dégâts, survie et score que le solveur", () => {
    const e = new Solver(data, req).evaluateStuff({ items: ids, alloc: b.alloc });
    expect(e.evaluation.dpt).toBeCloseTo(b.evaluation.dpt, 3);
    expect(e.evaluation.ehp).toBeCloseTo(b.evaluation.ehp, 3);
    expect(e.evaluation.score).toBeCloseTo(b.evaluation.score, 6);
  });

  it("sans répartition : caractéristiques optimisées, au moins aussi bien", () => {
    const e = new Solver(data, req).evaluateStuff({ items: ids });
    expect(e.items.map((it) => it?.id ?? null)).toEqual(ids);
    expect(allocPoints(data.classes.find((c) => c.id === req.classId)!, e.alloc)).toBeLessThanOrEqual(statPointsAt(req.level, DEFAULT_RULES));
    expect(e.evaluation.score).toBeGreaterThan(b.evaluation.score - 0.02);
  });

  it("points de caractéristique en trop : signalés", () => {
    const e = new Solver(data, req).evaluateStuff({ items: ids, alloc: { ...b.alloc, vita: b.alloc.vita + 5000 } });
    expect(e.problems.some((p) => p.startsWith("Caractéristiques"))).toBe(true);
  });
});
