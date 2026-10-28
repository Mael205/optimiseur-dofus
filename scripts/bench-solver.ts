// Banc d'essai du solveur : pour une série de demandes variées (classes, éléments, niveaux, rôles), on compare le
// stuff du rôle à une vérification poussée, indépendante de la recherche du solveur :
//   - répartition : transferts de 1 à 50 points entre deux caractéristiques jusqu'à stabilité ;
//   - échange simple sur tout le pool (puis ré-réglage des 40 meilleurs) ;
//   - échange double parmi les 25 meilleurs candidats de chaque emplacement ;
//   - recherche itérée (autres graines que le solveur) : CHAINS chaînes de STALL redémarrages sans progrès, dans
//     chacun des deux régimes du solveur (avec / sans les items à condition de panoplie), en repartant de zéro dans
//     l'autre régime.
// Écart affiché en score (log) : 0,01 ≈ 1 % sur la moyenne géométrique dégâts / survie.
//
//   npm run bench                 toutes les demandes
//   npm run bench -- Iop Crâ      seulement ces classes
//   STALL=150 CHAINS=8 npm run bench   vérification plus longue

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameData, Item } from "../src/engine/types";
import { ROLES, type Role } from "../src/engine/score";
import { Solver } from "../src/engine/solver";
import { BASE_CARACS, type BaseCarac } from "../src/engine/statIds";
import { N_SLOTS, SLOTS, allocPoints } from "../src/engine/stats";
import { VOIE_LABEL, type Voie } from "../src/engine/voies";

const dir = join(import.meta.dirname, "..", "public", "data");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const data: GameData = { meta: load("meta"), items: load("items"), sets: load("sets"), classes: load("classes"), monsters: load("monsters") };
const STALL = Number(process.env.STALL ?? 60);
const CHAINS = Number(process.env.CHAINS ?? 4);

interface Case {
  cls: string;
  level: number;
  role: Role;
  voie?: Voie[];
  /** Familier / monture imposé (nom). */
  familier?: string;
}

const CASES: Case[] = [
  { cls: "Iop", level: 200, role: "equilibre", voie: ["force"] },
  { cls: "Crâ", level: 150, role: "dps", voie: ["agi"] },
  { cls: "Sadida", level: 120, role: "equilibre", voie: ["force"] },
  { cls: "Osamodas", level: 200, role: "tank", voie: ["chance"] },
  { cls: "Enutrof", level: 150, role: "equilibre", voie: ["chance"] },
  { cls: "Eniripsa", level: 100, role: "equilibre", voie: ["intel"] },
  { cls: "Sram", level: 60, role: "dps", voie: ["agi"] },
  { cls: "Xélor", level: 200, role: "equilibre", voie: ["intel"] },
  { cls: "Steamer", level: 180, role: "equilibre", voie: ["chance"] },
  { cls: "Pandawa", level: 150, role: "equilibre", voie: ["force", "chance"] },
  { cls: "Ecaflip", level: 90, role: "dps" },
  { cls: "Eliotrope", level: 150, role: "equilibre", voie: ["intel"], familier: "Dragodinde Ivoire et Orchidée" },
];

let seed = 0;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const only = process.argv.slice(2);
for (const c of CASES.filter((c) => !only.length || only.includes(c.cls))) {
  const cls = data.classes.find((x) => x.name === c.cls)!;
  const weights = ROLES[c.role].w;
  const fam = c.familier ? data.items.find((it) => it.name === c.familier)!.id : null;
  const locked = SLOTS.map((s) => (s === "familier" ? fam : null));
  const sv: any = new Solver(data, { classId: cls.id, level: c.level, weights, voie: c.voie, locked });
  const name = `${c.cls} ${c.level} ${c.voie ? c.voie.map((v) => VOIE_LABEL[v]).join("/") : "Multi"} ${ROLES[c.role].label}`;
  const t0 = performance.now();
  const res = sv.solve();
  const solveS = (performance.now() - t0) / 1000;
  const b = res.builds[res.highlighted];
  const isLocked = (p: number) => locked[p] != null;
  const pool: Item[] = sv.pool;

  // État de référence, réglé de la même façon que dans le solveur.
  const ref = sv.run({ items: b.items, alloc: b.alloc }, weights, c.voie);
  let best = ref;
  const t1 = performance.now();
  const log: string[] = [];
  const improve = (s: any, why: string) => {
    if (s.score > best.score + 1e-6) {
      log.push(`${why} +${(s.score - best.score).toFixed(4)}`);
      best = s;
      return true;
    }
    return false;
  };

  // 1. Répartition : transferts entre deux caractéristiques.
  {
    let alloc = { ...best.alloc };
    let cur = sv.score(best.items, alloc, best.ev);
    for (let changed = true; changed;) {
      changed = false;
      for (const step of [50, 20, 10, 5, 1])
        for (const from of BASE_CARACS)
          for (const to of BASE_CARACS) {
            if (from === to || alloc[from] < step) continue;
            const a = { ...alloc, [from]: alloc[from] - step };
            // Points libérés réinvestis au mieux dans `to`.
            while (allocPoints(cls, { ...a, [to]: a[to] + 1 }) <= sv.points) a[to]++;
            const s = sv.score(best.items, a, best.ev);
            if (s > cur + 1e-7) {
              alloc = a;
              cur = s;
              changed = true;
            }
          }
    }
    improve(sv.run({ items: best.items, alloc }, weights, c.voie), "caracs");
  }

  // 2. Échanges simples sur tout le pool.
  const singles: { p: number; it: Item | null; s: number }[] = [];
  {
    const items = best.items.slice();
    for (let p = 0; p < N_SLOTS; p++) {
      if (isLocked(p)) continue;
      const old = items[p];
      for (const it of [null, ...pool.filter((x) => x.slot === SLOTS[p])]) {
        if (it && items.some((y: Item | null) => y?.id === it.id)) continue;
        items[p] = it;
        singles.push({ p, it, s: sv.score(items, best.alloc, best.ev) });
      }
      items[p] = old;
    }
    singles.sort((x, y) => y.s - x.s);
    for (const m of singles.slice(0, 40)) {
      const tr = best.items.slice();
      tr[m.p] = m.it;
      improve(sv.run({ items: tr, alloc: best.alloc }, weights, c.voie), `échange ${m.it?.name ?? "∅"}`);
    }
  }

  // 3. Échanges doubles parmi les meilleurs candidats.
  const top = Array.from({ length: N_SLOTS }, (_, p) =>
    singles
      .filter((m) => m.p === p && m.it !== best.items[p])
      .slice(0, 25)
      .map((m) => m.it),
  );
  {
    let bp: { s: number; tr: (Item | null)[] } | undefined;
    for (let p = 0; p < N_SLOTS; p++)
      for (let q = p + 1; q < N_SLOTS; q++)
        for (const a of top[p])
          for (const d of top[q]) {
            if (a && d && a.id === d.id) continue;
            const tr = best.items.slice();
            tr[p] = a;
            tr[q] = d;
            if (a && tr.some((y: Item | null, i: number) => i !== p && y?.id === a.id)) continue;
            if (d && tr.some((y: Item | null, i: number) => i !== q && y?.id === d.id)) continue;
            const s = sv.score(tr, best.alloc, best.ev);
            if (!bp || s > bp.s) bp = { s, tr };
          }
    if (bp && bp.s > best.score) improve(sv.run({ items: bp.tr, alloc: best.alloc }, weights, c.voie), "échange double");
  }

  // 4. Recherche itérée dans chaque régime.
  let restarts = 0;
  const main = (c.voie?.[0] ?? BASE_CARACS.reduce((x, y) => (best.alloc[y] > best.alloc[x] ? y : x))) as BaseCarac;
  for (const free of sv.setCondItems.size ? [false, true] : [false]) {
    sv.free = free;
    const fits = best.items.every((it: Item | null) => !free || !it || !sv.setCondItems.has(it));
    const start0 = fits
      ? best
      : sv.run({ items: locked.map((id) => (id == null ? null : data.items.find((x) => x.id === id)!)), alloc: sv.allIn(main) }, weights, c.voie);
    for (let chain = 0; chain < CHAINS; chain++) {
      seed = 987654321 + chain;
      let cur = start0;
      let tops: (Item | null)[][] = fits && !free ? top : sv.topSwaps(cur);
      for (let stall = 0; stall < STALL; stall++, restarts++) {
        const start = cur.items.slice();
        const n = 2 + Math.floor(rnd() * 6);
        for (let j = 0; j < n; j++) {
          const p = Math.floor(rnd() * N_SLOTS);
          if (isLocked(p)) continue;
          const ch = tops[p].filter(Boolean);
          start[p] = rnd() < 0.15 || !ch.length ? null : ch[Math.floor(rnd() * ch.length)];
        }
        const seen = new Set<number>();
        start.forEach((it: Item | null, p: number) => {
          if (it && seen.has(it.id) && !isLocked(p)) start[p] = null;
          else if (it) seen.add(it.id);
        });
        const s = sv.run({ items: start, alloc: cur.alloc }, weights, c.voie);
        if (s.score > cur.score + 1e-6) {
          cur = s;
          tops = sv.topSwaps(cur);
          stall = -1;
        }
      }
      improve(cur, free ? "régime panoplies libres" : "redémarrage");
    }
  }
  sv.free = false;

  const gap = best.score - ref.score;
  const verifS = (performance.now() - t1) / 1000;
  const e = b.evaluation;
  const row = `${name.padEnd(36)} solveur ${solveS.toFixed(1).padStart(5)} s  score ${ref.score.toFixed(4)}  DPT ${Math.round(e.dpt).toString().padStart(5)} EHP ${Math.round(e.ehp).toString().padStart(5)}  écart ${gap.toFixed(4)}  (vérif ${verifS.toFixed(0)} s, ${restarts} redémarrages)${gap > 1e-4 ? "  ⚠ " + log.join(", ") : ""}`;
  console.log(row);
  if (gap > 1e-4) console.log(`    meilleur : ${best.items.map((it: Item | null) => it?.name ?? "—").join(", ")} ; ${JSON.stringify(best.alloc)}`);
}
