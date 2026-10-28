// Vérifie la qualité du solveur : à partir de chaque stuff trouvé, recherche locale exhaustive
// (tous les items de chaque emplacement, puis répartition des caractéristiques). Un gain signale un optimum manqué.
//   npx tsx scripts/dev/check-optimality.ts Iop 200 equilibre
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameData, Item } from "../../src/engine/types";
import { ROLES } from "../../src/engine/score";
import { N_SLOTS, SLOTS } from "../../src/engine/stats";
import { Solver } from "../../src/engine/solver";

const dir = join(import.meta.dirname, "..", "..", "public", "data");
const load = (n: string) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
const data: GameData = { meta: load("meta"), items: load("items"), sets: load("sets"), classes: load("classes"), monsters: load("monsters") };
const [clsName = "Iop", lvl = "200", roleName = "equilibre"] = process.argv.slice(2);
const cls = data.classes.find((c) => c.name === clsName)!;
const level = Number(lvl);
const role = ROLES[roleName as keyof typeof ROLES].w;

const solver = new Solver(data, { classId: cls.id, level, weights: role });
const res = solver.solve();
const s = solver as any;
for (const b of res.builds) {
  const items: (Item | null)[] = b.items.slice();
  const ev = s.run({ items, alloc: b.alloc }, b.weights).ev; // évaluateur au même point
  let best = s.score(items, b.alloc, ev);
  const start = best;
  const pool: Item[] = data.items.filter((it) => it.level <= level);
  for (let sweep = 0; sweep < 10; sweep++) {
    let improved = false;
    for (let p = 0; p < N_SLOTS; p++) {
      for (const c of pool) {
        if (c.slot !== SLOTS[p] || items.some((x) => x?.id === c.id)) continue;
        const old = items[p];
        items[p] = c;
        const v = s.score(items, b.alloc, ev);
        if (v > best + 1e-7) { best = v; improved = true; console.log(`   +${(v - start).toFixed(4)} ${SLOTS[p]} : ${old?.name ?? "—"} → ${c.name}`); }
        else items[p] = old;
      }
    }
    if (!improved) break;
  }
  console.log(`dégâts ${b.weights.dmg} : score ${start.toFixed(4)} → ${best.toFixed(4)} (écart ${(best - start).toFixed(4)})`);
}
