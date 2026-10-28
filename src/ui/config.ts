// Réglages de l'interface, retenus d'une visite à l'autre (localStorage, facultatif).

import type { Role } from "../engine/score";
import type { Exo } from "../engine/stats";
import { N_SLOTS } from "../engine/stats";
import type { Voie } from "../engine/voies";
import type { Rules } from "../engine/rules";
import type { SolveRequest } from "../engine/solver";
import { ROLES } from "../engine/score";

export interface Config {
  classId: number | null;
  level: number;
  role: Role;
  /** Éléments imposés ; vide : comparaison automatique. */
  voie: Voie[];
  exo: Exo;
  scrolls: boolean;
  /** Objectifs modifiés (vide : objectifs par défaut du niveau et de la classe). */
  targets: { pa?: number; pm?: number; po?: number; invo?: number };
  dptMin: number;
  locked: (number | null)[];
  banned: number[];
  /** Recherche approfondie : plus de parts de calcul (voir pool.ts). */
  deep: boolean;
  /** Items jusqu'à ce nombre de niveaux au-dessus du personnage (0 à 5). */
  levelMargin: number;
}

export const DEFAULT_CONFIG: Config = {
  classId: null, level: 200, role: "equilibre", voie: [], exo: {}, scrolls: true, targets: {}, dptMin: 0,
  locked: Array(N_SLOTS).fill(null), banned: [], deep: false, levelMargin: 0,
};

/** Réponses de la fiche de calibration : règles appliquées au calcul, et notes des tests sans règle associée. */
export interface Calibration {
  rules: Partial<Rules>;
  notes: Record<string, string>;
}

export const DEFAULT_CALIBRATION: Calibration = { rules: {}, notes: {} };

export function read<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible (navigation privée…) : les réglages ne sont simplement pas retenus
  }
}

export const loadConfig = () => {
  const c = read("optimiseur.config", DEFAULT_CONFIG);
  return { ...c, locked: c.locked?.length === N_SLOTS ? c.locked : DEFAULT_CONFIG.locked };
};
export const saveConfig = (c: Config) => write("optimiseur.config", c);
export const loadCalibration = () => read("optimiseur.calibration", DEFAULT_CALIBRATION);
export const saveCalibration = (c: Calibration) => write("optimiseur.calibration", c);

export function toRequest(c: Config, cal: Calibration): SolveRequest {
  const targets = Object.fromEntries(Object.entries(c.targets).filter(([, v]) => v != null && !Number.isNaN(v)));
  return {
    classId: c.classId!,
    level: c.level,
    weights: ROLES[c.role].w,
    voie: c.voie.length ? c.voie : undefined,
    exo: c.exo,
    scrolls: c.scrolls,
    targets: { ...targets, ...(c.dptMin > 0 ? { dpt: c.dptMin } : {}) },
    locked: c.locked.some((x) => x != null) ? c.locked : undefined,
    banned: c.banned.length ? c.banned : undefined,
    rules: cal.rules,
    ...(c.levelMargin > 0 ? { levelMargin: c.levelMargin } : {}),
  };
}
