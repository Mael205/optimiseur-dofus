// Mise en forme pour l'interface : nombres, libellés, couleurs d'éléments, export texte d'un stuff.

import type { Item, StatLine } from "../engine/types";
import { BASE_CARACS, ELEMENTS, STAT_KEYS, STAT_LABELS, S, type StatKey } from "../engine/statIds";
import { SLOTS } from "../engine/stats";
import type { BuildResult } from "../engine/solver";
import { type Voie, elementsLabel, voieName } from "../engine/voies";
import { condToText } from "../engine/conditions";

export const fmt = (x: number) => Math.round(x).toLocaleString("fr-FR");
export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits).replace(".", ",")} %`;
export const signed = (x: number) => (x > 0 ? `+${fmt(x)}` : fmt(x));

export const SLOT_LABEL: Record<string, string> = {
  amulette: "Amulette", anneau: "Anneau", coiffe: "Coiffe", cape: "Cape", ceinture: "Ceinture", bottes: "Bottes",
  arme: "Arme", bouclier: "Bouclier", familier: "Familier / monture", dofus: "Dofus / trophée",
};
export const slotLabel = (i: number) => {
  const s = SLOTS[i];
  if (s === "anneau") return `Anneau ${i === SLOTS.indexOf("anneau") ? 1 : 2}`;
  if (s === "dofus") return `Dofus ${i - SLOTS.indexOf("dofus") + 1}`;
  return SLOT_LABEL[s];
};

/** Couleur d'identité de chaque élément (Neutre..Air), toujours accompagnée de son nom. */
export const ELEM_COLOR = ["#9a948a", "#b07a3c", "#e0603e", "#3f8fd8", "#4fae5a"];
export const VOIE_ELEM = { force: 1, intel: 2, chance: 3, agi: 4 } as const;

export const statLabel = (s: number) => STAT_LABELS[STAT_KEYS[s]];
const PERCENT_STATS = new Set<number>([S.crit, S.pctSorts, S.pctArmes, S.pctMelee, S.pctDist, S.rpNeutre, S.rpTerre, S.rpFeu, S.rpEau, S.rpAir, S.rpMelee, S.rpDist]);

/** Ligne de stat d'un item, au jet parfait (et la plage si elle varie). */
export function statLineText([s, min, max]: StatLine): string {
  const label = STAT_LABELS[STAT_KEYS[s]].replace(/^% /, "");
  const unit = PERCENT_STATS.has(s) ? " %" : "";
  const range = min !== max && min !== 0 ? ` (${min} à ${max})` : "";
  return `${max > 0 ? "+" : ""}${max}${unit} ${label}${range}`;
}

export const condText = (item: Item) => (item.cond ? condToText(item.cond, statLabel) : "");

export const total = (b: BuildResult, k: StatKey) => b.totals[S[k]];

/** Libellé court d'un stuff : pondération et éléments joués. */
export const buildTitle = (b: BuildResult) => `${Math.round(b.weights.dmg * 100)} % dégâts · ${elementsLabel(b.rotation.elements)}`;

const SHOWN: StatKey[] = ["pa", "pm", "po", "invo", "vita", "force", "intel", "chance", "agi", "puissance", "do", "doCrit", "crit", "pctSorts", "pctMelee", "pctDist", "soin"];

/** Export texte d'un stuff (à coller sur Discord, dans un bloc-notes…). */
export function buildText(b: BuildResult, ctx: { cls: string; level: number; version: string; voie?: Voie[]; name?: string }): string {
  const e = b.evaluation;
  const lines = [
    `${ctx.cls} niveau ${ctx.level} — ${ctx.name ?? buildTitle(b)} (Dofus ${ctx.version}${ctx.voie?.length ? `, voie ${voieName(ctx.voie)}` : ""})`,
    `Dégâts/tour ${fmt(e.dpt)} · PV effectifs ${fmt(e.ehp)} · PV ${fmt(b.hp)}${e.hpt ? ` · soins/tour ${fmt(e.hpt)}` : ""}`,
    "",
  ];
  b.items.forEach((it, i) => it && lines.push(`${slotLabel(i).padEnd(20)} ${it.name} (niv. ${it.level})`));
  lines.push("", `Panoplies : ${b.sets.map((s) => `${s.name} (${s.pieces})`).join(", ") || "aucune"}`);
  lines.push(`Caractéristiques : ${BASE_CARACS.filter((k) => b.alloc[k]).map((k) => `${STAT_LABELS[k]} ${b.alloc[k]}`).join(", ") || "aucune"}`);
  lines.push(`Stats : ${SHOWN.filter((k) => total(b, k)).map((k) => `${STAT_LABELS[k]} ${fmt(total(b, k))}`).join(", ")}`);
  lines.push(`Résistances % : ${ELEMENTS.map((el, i) => `${el} ${fmt(b.totals[S.rpNeutre + i])}`).join(", ")}`);
  for (const t of b.rotation.turns) lines.push(`Tour (${pct(t.weight)}) : ${t.casts.join(" + ")} = ${fmt(t.damage)}`);
  if (b.problems.length) lines.push(`À noter : ${b.problems.join(" ; ")}`);
  return lines.join("\n");
}

/** Recherche sans accents ni casse. */
export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
