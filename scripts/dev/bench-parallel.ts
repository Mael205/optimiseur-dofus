// Calcul parallèle (worker_threads, comme les Web Workers de l'interface) : temps et score du stuff du rôle et du
// front, à comparer au calcul séquentiel du banc (scores de référence de npm run bench).
//   N=8 npx tsx scripts/dev/bench-parallel.ts [classes…]
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameData } from "../../src/engine/types";
import { ROLES, type Role } from "../../src/engine/score";
import { SLOTS } from "../../src/engine/stats";
import { type Exec, type Task, runTask, solveParallel } from "../../src/engine/parallel";
import type { Voie } from "../../src/engine/voies";

const dir = join(import.meta.dirname, "..", "..", "public", "data");
const load = (n: string) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
const data: GameData = { meta: load("meta"), items: load("items"), sets: load("sets"), classes: load("classes"), monsters: load("monsters") };

if (!isMainThread) {
  parentPort!.on("message", (task: Task) => parentPort!.postMessage(runTask(data, task)));
} else {
  const N = Number(process.env.N ?? 8);
  // [classe, niveau, rôle, voie, score de référence du stuff du rôle (bench séquentiel), familier imposé]
  const CASES: [string, number, Role, Voie[] | undefined, number, string?][] = [
    ["Iop", 200, "equilibre", ["force"], 8.5699], ["Crâ", 150, "dps", ["agi"], 7.8403], ["Sadida", 120, "equilibre", ["force"], 7.924],
    ["Osamodas", 200, "tank", ["chance"], 9.1366], ["Enutrof", 150, "equilibre", ["chance"], 8.0256], ["Eniripsa", 100, "equilibre", ["intel"], 11.5297],
    ["Sram", 60, "dps", ["agi"], 6.6212], ["Xélor", 200, "equilibre", ["intel"], 8.7304], ["Steamer", 180, "equilibre", ["chance"], 8.2975],
    ["Pandawa", 150, "equilibre", ["force", "chance"], 8.0065], ["Ecaflip", 90, "dps", undefined, 7.3135],
    ["Eliotrope", 150, "equilibre", ["intel"], 7.9508, "Dragodinde Ivoire et Orchidée"],
  ];

  // Pool de workers persistants (les données sont chargées une fois par worker, comme dans l'interface).
  // Le chargeur tsx n'est pas hérité par les threads : chaque worker recharge ce fichier à travers lui.
  const self = JSON.stringify(import.meta.url);
  const boot = `import("tsx/esm/api").then(({ tsImport }) => tsImport(${self}, ${self}))`;
  const idle = Array.from({ length: N }, () => new Worker(boot, { eval: true }));
  const queue: (() => void)[] = [];
  const exec: Exec = (task) =>
    new Promise((resolve) => {
      const go = () => {
        const w = idle.pop()!;
        w.once("message", (r) => {
          idle.push(w);
          queue.shift()?.();
          resolve(r);
        });
        w.postMessage(task);
      };
      if (idle.length) go();
      else queue.push(go);
    });

  const only = process.argv.slice(2);
  for (const [cls, level, role, voie, ref, fam] of CASES.filter((c) => !only.length || only.includes(c[0]))) {
    const famId = fam && data.items.find((i) => i.name === fam)!.id;
    const req = {
      classId: data.classes.find((c) => c.name === cls)!.id, level, weights: ROLES[role].w, voie,
      locked: famId ? SLOTS.map((s) => (s === "familier" ? famId : null)) : undefined,
    };
    const r = await solveParallel(req, N, exec);
    const b = r.builds[r.highlighted];
    const d = b.evaluation.score - ref;
    const front = r.builds.map((x) => `${Math.round(x.evaluation.dpt)}/${Math.round(x.evaluation.ehp)}`).join(" ");
    console.log(`${(cls + " " + level).padEnd(14)} ${(r.elapsedMs / 1000).toFixed(1).padStart(5)} s  score ${b.evaluation.score.toFixed(4)}  réf ${ref.toFixed(4)}  ${d >= 0 ? "+" : ""}${d.toFixed(4)}   front ${front}`);
  }
  await Promise.all(idle.map((w) => w.terminate()));
}
