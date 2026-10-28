// Comparateur : stuffs saisis à la main (ou envoyés par l'optimiseur), évalués tels quels dans un même contexte.

import type { Role } from "../engine/score";
import { ROLES } from "../engine/score";
import { type Allocation, type Exo, N_SLOTS, SLOTS } from "../engine/stats";
import type { Voie } from "../engine/voies";
import type { SolveRequest, StuffInput } from "../engine/solver";
import type { ItemIndex } from "../engine/worker";
import { type Calibration, read, write } from "./config";
import { norm } from "./format";

/** Trois stuffs au plus : au-delà, aucune palette ne reste lisible pour les daltoniens. */
export const MAX_STUFFS = 3;
export const STUFF_COLOR = ["#c98500", "#3987e5", "#d55181"];
export const STUFF_LETTER = ["A", "B", "C"];

export interface CompareStuff {
  /** Emplacement de couleur et de lettre (A, B, C), fixe pour la vie du stuff. */
  slot: number;
  name: string;
  items: (number | null)[];
  /** Répartition imposée ; null : optimisée pour le rôle. */
  alloc: Allocation | null;
  exo: Exo;
}

export interface CompareState {
  classId: number | null;
  level: number;
  role: Role;
  voie: Voie[];
  scrolls: boolean;
  stuffs: CompareStuff[];
  /** Emplacement du stuff de référence. */
  ref: number;
}

export const emptyStuff = (slot: number, name = ""): CompareStuff => ({ slot, name, items: Array(N_SLOTS).fill(null), alloc: null, exo: {} });

const DEFAULT_COMPARE: CompareState = {
  classId: null, level: 200, role: "equilibre", voie: [], scrolls: true, stuffs: [emptyStuff(0), emptyStuff(1)], ref: 0,
};

export const loadCompare = (): CompareState => {
  const c = read("optimiseur.comparateur", DEFAULT_COMPARE);
  const stuffs = (c.stuffs ?? []).filter((s) => s.items?.length === N_SLOTS).slice(0, MAX_STUFFS);
  return stuffs.length ? { ...c, stuffs, ref: stuffs.some((s) => s.slot === c.ref) ? c.ref : stuffs[0].slot } : DEFAULT_COMPARE;
};
export const saveCompare = (c: CompareState) => write("optimiseur.comparateur", c);

/** Premier emplacement de couleur libre. */
export const freeSlot = (stuffs: CompareStuff[]) => [0, 1, 2].find((i) => !stuffs.some((s) => s.slot === i)) ?? 0;

export function compareRequest(c: CompareState, stuff: CompareStuff, cal: Calibration): SolveRequest {
  return {
    classId: c.classId!,
    level: c.level,
    weights: ROLES[c.role].w,
    voie: c.voie.length ? c.voie : undefined,
    exo: stuff.exo,
    scrolls: c.scrolls,
    rules: cal.rules,
  };
}

export const stuffInput = (s: CompareStuff): StuffInput => ({ items: s.items, alloc: s.alloc });

/** Titres de section des exports (DofusBook, Discord…) : ignorés à l'import. */
const SKIP = /^(panoplies?|caracteristiques|stats|resistances|tour|a noter|degats|forgemagie)\b/;

/**
 * Liste d'items collée (un par ligne, avec ou sans libellé d'emplacement) → stuff. Nom exact d'abord, sinon le plus
 * long nom d'item contenu dans la ligne ; à nom égal, la version la plus haute jouable au niveau.
 */
export function parseItemList(text: string, items: ItemIndex[], maxLevel: number): { items: (number | null)[]; unknown: string[] } {
  const byName = new Map<string, ItemIndex[]>();
  for (const it of items) {
    const n = norm(it.name);
    byName.set(n, [...(byName.get(n) ?? []), it]);
  }
  const names = [...byName.keys()].filter((n) => n.length >= 4).sort((a, b) => b.length - a.length);
  const pickOf = (list: ItemIndex[]) =>
    [...list].sort((a, b) => Number(b.level <= maxLevel) - Number(a.level <= maxLevel) || b.level - a.level)[0];

  const out: (number | null)[] = Array(N_SLOTS).fill(null);
  const unknown: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s\-•*·>]+/, "").trim();
    const n = norm(line).replace(/\s+/g, " ");
    if (n.length < 3 || SKIP.test(n)) continue;
    const after = n.replace(/^[^:]*:\s*/, "");
    const exact = byName.get(n) ?? byName.get(after) ?? byName.get(after.replace(/\s*\(.*\)\s*$/, ""));
    const found = exact ?? (() => {
      const hit = names.find((x) => n.includes(x));
      return hit ? byName.get(hit) : undefined;
    })();
    if (!found) {
      unknown.push(line);
      continue;
    }
    const it = pickOf(found);
    const p = SLOTS.findIndex((s, i) => s === it.slot && out[i] == null);
    if (p >= 0 && !out.includes(it.id)) out[p] = it.id;
  }
  return { items: out, unknown };
}
