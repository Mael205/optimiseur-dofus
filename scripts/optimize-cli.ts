// Lance le solveur en ligne de commande (tests du moteur sans l'interface).
//   npm run optimize -- <classe> <niveau> [dps|equilibre|tank] [voie : force,intel,chance,agi] [exo:pa,pm,po] [marge:N]
//   ex. npm run optimize -- Iop 200 equilibre        (voies comparées)
//       npm run optimize -- Crâ 150 dps agi           (Crâ Air)
//       npm run optimize -- Eliotrope 150 equilibre intel exo:pa

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameData } from "../src/engine/types";
import { BASE_CARACS, STAT_KEYS, STAT_LABELS } from "../src/engine/statIds";
import { ROLES } from "../src/engine/score";
import { SLOTS } from "../src/engine/stats";
import { type BuildResult, solve } from "../src/engine/solver";
import { VOIES, type Voie, elementsLabel, voieName } from "../src/engine/voies";

const dir = join(import.meta.dirname, "..", "public", "data");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const data: GameData = {
  meta: load("meta"),
  items: load("items"),
  sets: load("sets"),
  classes: load("classes"),
  monsters: load("monsters"),
};

const [clsArg = "Iop", levelArg = "200", roleArg = "equilibre", ...rest] = process.argv.slice(2);
const exoArg = rest.find((a) => a.startsWith("exo:"));
const margeArg = rest.find((a) => a.startsWith("marge:"));
const levelMargin = margeArg ? Number(margeArg.slice(6)) : 0;
const voieArg = rest.find((a) => a !== exoArg && a !== margeArg) ?? "";
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const cls = data.classes.find((c) => String(c.id) === clsArg || norm(c.name) === norm(clsArg));
if (!cls) throw new Error(`classe inconnue : ${clsArg} (${data.classes.map((c) => c.name).join(", ")})`);
const role = ROLES[roleArg as keyof typeof ROLES];
if (!role) throw new Error(`rôle inconnu : ${roleArg} (${Object.keys(ROLES).join(", ")})`);
const level = Number(levelArg);
const voie = voieArg ? (voieArg.split(",") as Voie[]) : undefined;
if (voie?.some((v) => !VOIES.includes(v))) throw new Error(`voie inconnue : ${voieArg} (${VOIES.join(", ")})`);
const exoList = exoArg ? exoArg.slice(4).split(",") : [];
if (exoList.some((e) => !["pa", "pm", "po"].includes(e))) throw new Error(`exo inconnu : ${exoArg} (exo:pa,pm,po)`);
const exo = Object.fromEntries(exoList.map((e) => [e, true]));

const fmt = (x: number) => Math.round(x).toLocaleString("fr-FR");
console.log(`Dofus ${data.meta.version} : ${cls.name} niveau ${level}, rôle ${role.label}, voie ${voie ? voieName(voie) : "auto"}${exoList.length ? `, exo ${exoList.join(" + ").toUpperCase()}` : ""}`);
let last = 0;
const res = solve(data, { classId: cls.id, level, weights: role.w, voie, exo, levelMargin }, (f, msg) => {
  const pct = Math.round(f * 100);
  if (pct >= last + 10 || f === 1) console.log(`  ${pct} % ${msg}`);
  last = pct;
});
console.log(`objectifs ${JSON.stringify(res.targets)}, ${res.builds.length} stuffs en ${(res.elapsedMs / 1000).toFixed(1)} s`);
const tag = (v: (typeof res.voies)[number]) => (v.rel >= 0.9 ? "principale" : v.rel >= 0.7 ? "jouable" : "faible");
console.log(`voies : ${res.voies.map((v) => `${v.label} ${Math.round(v.rel * 100)} % (${tag(v)})${v.heal ? `, soins ${Math.round(v.healRel * 100)} %` : ""}`).join(" | ")}`);
for (const { voie: v, build: b } of res.voieBuilds)
  console.log(`  meilleur stuff ${voieName([v])} : score ${b.evaluation.score.toFixed(3)}, DPT ${fmt(b.evaluation.dpt)}, EHP ${fmt(b.evaluation.ehp)}${b.evaluation.hpt ? `, soins ${fmt(b.evaluation.hpt)}` : ""}`);
console.log();

const SHOWN = ["pa", "pm", "po", "invo", "vita", "force", "intel", "chance", "agi", "puissance", "do", "doCrit", "crit", "pctSorts", "pctMelee", "pctDist", "soin"];

res.builds.forEach((b: BuildResult, i) => {
  const e = b.evaluation;
  const mark = i === res.highlighted ? " ★" : "";
  console.log(`— Stuff ${i + 1}${mark} (dégâts ${Math.round(b.weights.dmg * 100)} %, ${elementsLabel(b.rotation.elements)}) : DPT ${fmt(e.dpt)}, EHP ${fmt(e.ehp)}, PV ${fmt(b.hp)}${e.hpt ? `, soins ${fmt(e.hpt)}` : ""}, score ${e.score.toFixed(3)}`);
  b.items.forEach((it, p) => {
    if (it) console.log(`   ${SLOTS[p].padEnd(9)} ${it.name} (niv. ${it.level})  [${b.itemValue[p].toFixed(3)}]`);
  });
  console.log(`   panoplies : ${b.sets.map((s) => `${s.name} ${s.pieces}`).join(", ") || "aucune"}`);
  console.log(`   caracs : ${BASE_CARACS.filter((k) => b.alloc[k]).map((k) => `${STAT_LABELS[k]} ${b.alloc[k]}`).join(", ")}`);
  console.log(`   stats : ${SHOWN.map((k) => [k, b.totals[STAT_KEYS.indexOf(k as never)]] as const).filter(([, v]) => v).map(([k, v]) => `${STAT_LABELS[k as keyof typeof STAT_LABELS]} ${Math.round(v)}`).join(", ")}`);
  const rp = [0, 1, 2, 3, 4].map((e) => Math.round(b.totals[STAT_KEYS.indexOf(`rp${["Neutre", "Terre", "Feu", "Eau", "Air"][e]}` as never)]));
  console.log(`   rés % : ${rp.join(" / ")}`);
  for (const t of b.rotation.turns) console.log(`   tour (${Math.round(t.weight * 100)} %) : ${t.casts.join(" + ")} = ${fmt(t.damage)} (${t.apUsed} PA)`);
  for (const t of b.rotation.heals) console.log(`   soins (${Math.round(t.weight * 100)} %) : ${t.casts.join(" + ")} = ${fmt(t.damage)} (${t.apUsed} PA)`);
  if (b.problems.length) console.log(`   ⚠ ${b.problems.join(" ; ")}`);
  console.log();
});
