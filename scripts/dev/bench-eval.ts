// Temps d'une évaluation exacte de stuff.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameData } from "../../src/engine/types";
import { ROLES } from "../../src/engine/score";
import { Solver } from "../../src/engine/solver";

const dir = join(import.meta.dirname, "..", "..", "public", "data");
const load = (n: string) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
const data: GameData = { meta: load("meta"), items: load("items"), sets: load("sets"), classes: load("classes"), monsters: load("monsters") };
const [clsName = "Iop", lvl = "200"] = process.argv.slice(2);
const cls = data.classes.find((c) => c.name === clsName)!;
const solver = new Solver(data, { classId: cls.id, level: Number(lvl), weights: ROLES.equilibre.w });
const res = solver.solve();
const b = res.builds[0];
const s = solver as any;
const ev = s.run({ items: b.items, alloc: b.alloc }, b.weights).ev;
let n = 0;
const t0 = performance.now();
while (performance.now() - t0 < 1000) { s.score(b.items, b.alloc, ev); n++; }
console.log(`${clsName} ${lvl} : ${(1000 / n * 1000).toFixed(1)} µs par évaluation, deck ${ev.deck.length} sorts, solve ${res.elapsedMs.toFixed(0)} ms`);
const byType = new Map<string, number>();
for (const it of data.items) if (it.level <= Number(lvl)) byType.set(it.slot, (byType.get(it.slot) ?? 0) + 1);
console.log([...byType].map(([k, v]) => `${k} ${v}`).join(", "));
