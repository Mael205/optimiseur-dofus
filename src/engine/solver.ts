// Solveur : pour chaque point de départ (élément principal) et chaque pondération dégâts / survie,
//   1. poids dynamiques des stats (gradient du score au stuff courant) → valeur linéaire de chaque item ;
//   2. programmation dynamique sur les panoplies (capacité des emplacements) → squelette de stuff ;
//   3. recherche locale en évaluation exacte (échange d'un item, ou de deux pièces d'une même panoplie) ;
//   4. répartition des caractéristiques et choix des variantes de sorts, puis on recommence tant que ça s'améliore ;
//   5. recherche itérée en plusieurs chaînes : perturbations aléatoires de plusieurs items (ou de quelques pièces
//      d'une panoplie), puis 1 à 4 depuis le stuff perturbé ;
//   6. le tout dans deux régimes : avec ou sans les items à condition de panoplie (Érudit, Miraculé…), qu'aucune
//      recherche locale ne sait échanger contre des panoplies.
// Les stuffs obtenus pour plusieurs pondérations forment le front de Pareto dégâts / survie. Une somme pondérée ne
// trouve que l'enveloppe convexe du front : là où deux stuffs voisins sautent à la fois en dégâts et en survie, on
// cherche en plus le meilleur stuff sous un plancher de PV effectifs pris au milieu du trou (ε-contrainte).

import type { Cond, GameData, Item, ItemSet, MonsterRef, Slot } from "./types";
import { BASE_CARACS, STAT_LABELS, S, type BaseCarac } from "./statIds";
import { DEFAULT_RULES, type Rules, statPointsAt } from "./rules";
import {
  type Allocation, type Character, type Exo, N_SLOTS, SLOTS, WEAPON_SLOT, baseVec, buildProblems, aggregate, emptyAlloc,
  allocPoints, hitPoints, pointsFor, setBonusFor,
} from "./stats";
import { evalCond } from "./conditions";
import { optimizeAllocation } from "./allocation";
import { BALANCED_INCOMING, type IncomingProfile } from "./survival";
import { type Evaluation, Evaluator, type Setup, type Targets, type Weights, classProfile, defaultTargets } from "./score";
import { type VoieInfo, analyzeVoies } from "./analysis";
import { VOIE_LABEL, type Voie } from "./voies";

// ---------------------------------------------------------------- emplacements

const TYPES: Slot[] = ["amulette", "anneau", "coiffe", "cape", "ceinture", "bottes", "arme", "bouclier", "familier", "dofus"];
const N_TYPES = TYPES.length;
const CAP = TYPES.map((t) => SLOTS.filter((s) => s === t).length);
const POSITIONS = TYPES.map((t) => SLOTS.flatMap((s, i) => (s === t ? [i] : [])));
const TYPE_OF_POS = SLOTS.map((s) => TYPES.indexOf(s));

// États de la programmation dynamique : nombre d'emplacements occupés par type, en base mixte.
const MUL: number[] = [];
let N_STATES = 1;
for (let t = 0; t < N_TYPES; t++) {
  MUL[t] = N_STATES;
  N_STATES *= CAP[t] + 1;
}
const USAGE = new Int8Array(N_STATES * N_TYPES);
for (let s = 0; s < N_STATES; s++) for (let t = 0; t < N_TYPES; t++) USAGE[s * N_TYPES + t] = Math.floor(s / MUL[t]) % (CAP[t] + 1);

// ---------------------------------------------------------------- requête / résultat

export interface SolveRequest {
  classId: number;
  level: number;
  /** Pondération du rôle choisi (stuff mis en avant). */
  weights: Weights;
  targets?: Partial<Targets>;
  /** Parchemins de caractéristiques (+100 partout). Oui par défaut. */
  scrolls?: boolean;
  /** Exos PA / PM / PO de forgemagie. Aucun par défaut. */
  exo?: Exo;
  /** Item imposé par emplacement (id), null = libre. */
  locked?: (number | null)[];
  banned?: number[];
  rules?: Partial<Rules>;
  incoming?: IncomingProfile;
  /** Voie imposée (éléments joués). Absente : on compare les voies et on garde le meilleur, mélanges compris. */
  voie?: Voie[];
  /**
   * Items jusqu'à ce nombre de niveaux au-dessus du personnage (0 par défaut) : stuff préparé à l'avance. Le
   * personnage (PV, points de caractéristique, objectifs) reste au niveau demandé.
   */
  levelMargin?: number;
  /**
   * Part du travail pour un calcul en parallèle : chaque part fait sa tranche des chaînes de recherche itérée
   * (graines différentes), et on garde le meilleur résultat des parts (voir parallel.ts).
   */
  part?: { index: number; count: number };
}

export interface BuildResult {
  weights: Weights;
  /** Niveau du personnage (des items peuvent le dépasser, voir `SolveRequest.levelMargin`). */
  level: number;
  items: (Item | null)[];
  alloc: Allocation;
  /** Totaux non plafonnés (indexés par statIds). */
  totals: number[];
  hp: number;
  evaluation: Evaluation;
  sets: { id: number; name: string; pieces: number }[];
  setBonuses: number;
  rotation: ReturnType<Evaluator["explain"]>;
  /** Perte de score si on retire l'item de chaque emplacement. */
  itemValue: number[];
  problems: string[];
}

export interface SolveResult {
  /** Front de Pareto, du plus offensif au plus défensif. */
  builds: BuildResult[];
  /** Index du stuff correspondant au rôle demandé. */
  highlighted: number;
  targets: Targets;
  rules: Rules;
  /** Potentiel de chaque voie élémentaire de la classe. */
  voies: VoieInfo[];
  /** Sans voie imposée : meilleur stuff de chaque voie mono-élément essayée, à la pondération du rôle. */
  voieBuilds: { voie: Voie; build: BuildResult }[];
  voie?: Voie[];
  elapsedMs: number;
}

/** Stuff sérialisable (ids d'items), pour passer d'un worker à l'autre. */
export interface StuffRef {
  items: (number | null)[];
  alloc: Allocation;
  score: number;
}

/** Stuff à évaluer tel quel (comparateur) : ids d'items par emplacement ; caractéristiques absentes = optimisées. */
export interface StuffInput {
  items: (number | null)[];
  alloc?: Allocation | null;
}

export interface RolePhaseResult {
  voies: VoieInfo[];
  voieBuilds: { voie: Voie; build: BuildResult }[];
  /** Meilleur stuff de chaque régime : départs des points du front. */
  regimes: StuffRef[];
  role: BuildResult;
  mainCarac: Voie;
  targets: Targets;
  rules: Rules;
}

export type Progress = (fraction: number, message: string) => void;

const PARETO_DMG = [0.9, 0.75, 0.6, 0.45, 0.3];
/** Trou du front : dégâts et PV effectifs qui sautent tous deux d'au moins cet écart (ln, ≈ 13 %) entre voisins. */
const FRONT_GAP = 0.12;
/** Trous comblés au plus (les plus grands). */
const MAX_GAPS = 2;
/** Voies essayées sans voie imposée : potentiel (dégâts ou soins) d'au moins cette part du meilleur. */
const TRY_VOIE = 0.5;
const MAX_ITER = 4;
const CANDIDATES = 30;
const TOP_SETS = 20;
/** Recherche itérée : redémarrages consécutifs sans progrès avant l'arrêt d'une chaîne. */
const PERTURB_TRIES = 25;
/** Chaînes indépendantes par régime pour le stuff du rôle / pour les autres points du front. */
const CHAINS_ROLE = 6;
const CHAINS_FRONT = 2;
/** Candidats par emplacement pour les perturbations (meilleurs échanges simples). */
const PERTURB_TOP = 25;
/** Un redémarrage n'est optimisé complètement que si son premier tour finit à moins de cet écart du meilleur (≈ 2 %). */
const RESTART_MARGIN = 0.02;
const EPS = 1e-7;

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const better = (a: State | undefined, b: State) => (!a || b.score > a.score ? b : a);

/** Pondérations dégâts du front de Pareto (celle du rôle comprise), de la plus offensive à la plus défensive. */
export const frontWeights = (role: Weights) => [...new Set([role.dmg, ...PARETO_DMG])].sort((a, b) => b - a);

export function nearestMonster(refs: MonsterRef[], level: number): MonsterRef {
  return refs.reduce((a, b) => (Math.abs(b.level - level) < Math.abs(a.level - level) ? b : a));
}

interface State {
  items: (Item | null)[];
  alloc: Allocation;
  ev: Evaluator;
  score: number;
}

interface SetOption {
  set: number;
  pieces: number[];
  uses: [type: number, n: number][];
  code: number;
  gain: number;
}

// ---------------------------------------------------------------- solveur

export class Solver {
  readonly rules: Rules;
  readonly targets: Targets;
  private readonly ch: Omit<Character, "alloc">;
  private readonly setupBase: Omit<Setup, "weights">;
  private readonly pool: Item[];
  private readonly typeOf: Int8Array;
  private readonly byType: number[][];
  private readonly allCands: Item[][];
  private readonly setList: ItemSet[];
  private readonly setIndex = new Map<number, number>();
  private readonly setPieces: number[][];
  /** Toutes les paires de pièces d'une même panoplie (passe finale de la recherche itérée). */
  private readonly allPairs: [Item, Item][] = [];
  /**
   * Régime « panoplies libres » : sans les items à condition sur le nombre de bonus de panoplie (Érudit, Miraculé,
   * Nomade…). Ces items et les panoplies s'excluent, si bien qu'aucune recherche locale ne passe d'un stuff qui les
   * porte à un stuff de panoplies : on cherche dans les deux régimes séparément.
   */
  private free = false;
  /** Plancher de PV effectifs pendant qu'on comble un trou du front (0 : aucun). */
  private ehpFloor = 0;
  private readonly setCond: Uint8Array;
  private readonly setCondItems: Set<Item>;
  private readonly freeCands: Item[][];
  private readonly freePairs: [Item, Item][];
  private readonly counts: Int32Array;
  private readonly locked: (Item | null)[];
  private readonly byId: Map<number, Item>;
  private readonly points: number;

  constructor(data: GameData, private readonly req: SolveRequest) {
    const cls = data.classes.find((c) => c.id === req.classId);
    if (!cls) throw new Error(`classe inconnue : ${req.classId}`);
    this.rules = { ...DEFAULT_RULES, ...req.rules };
    const profile = classProfile(cls.name);
    this.targets = { ...defaultTargets(req.level, profile), ...req.targets };
    this.ch = { cls, level: req.level, scrolls: req.scrolls ?? true, exo: req.exo };
    this.setupBase = {
      cls, level: req.level, profile, targets: this.targets, rules: this.rules,
      monster: nearestMonster(data.monsters, req.level), incoming: req.incoming ?? BALANCED_INCOMING,
    };
    this.points = statPointsAt(req.level, this.rules);

    const byId = (this.byId = new Map(data.items.map((it) => [it.id, it])));
    this.locked = SLOTS.map((_, p) => {
      const id = req.locked?.[p];
      return id == null ? null : (byId.get(id) ?? null);
    });
    const banned = new Set(req.banned ?? []);
    const lockedIds = new Set(this.locked.flatMap((it) => (it ? [it.id] : [])));
    this.pool = data.items.filter((it) => it.level <= req.level + (req.levelMargin ?? 0) && !banned.has(it.id) && !lockedIds.has(it.id));
    this.typeOf = Int8Array.from(this.pool, (it) => TYPES.indexOf(it.slot));
    this.byType = TYPES.map(() => []);
    this.pool.forEach((_, i) => this.byType[this.typeOf[i]].push(i));
    this.allCands = this.byType.map((idx) => idx.map((i) => this.pool[i]));

    this.setList = data.sets;
    this.setList.forEach((s, i) => this.setIndex.set(s.id, i));
    this.counts = new Int32Array(this.setList.length);
    this.setPieces = this.setList.map(() => []);
    this.pool.forEach((it, i) => {
      const k = it.set === undefined ? undefined : this.setIndex.get(it.set);
      if (k !== undefined) this.setPieces[k].push(i);
    });
    for (const idx of this.setPieces)
      for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) this.allPairs.push([this.pool[idx[i]], this.pool[idx[j]]]);
    const hasSetCond = (c: Cond): boolean => ("op" in c ? c.c.some(hasSetCond) : "sets" in c && c.cmp === "<");
    this.setCond = Uint8Array.from(this.pool, (it) => (it.cond && hasSetCond(it.cond) ? 1 : 0));
    const setCondItems = (this.setCondItems = new Set(this.pool.filter((_, i) => this.setCond[i])));
    this.freeCands = this.allCands.map((c) => c.filter((it) => !setCondItems.has(it)));
    this.freePairs = this.allPairs.filter(([a, b]) => !setCondItems.has(a) && !setCondItems.has(b));
  }

  /** L'item d'indice i du pool est-il permis dans le régime courant ? */
  private allowed = (i: number) => !this.free || !this.setCond[i];
  private get cands() {
    return this.free ? this.freeCands : this.allCands;
  }
  private get pairs() {
    return this.free ? this.freePairs : this.allPairs;
  }

  // ------------------------------------------------------------ évaluation exacte

  totalsOf(items: readonly (Item | null)[], alloc: Allocation) {
    const t = baseVec({ ...this.ch, alloc });
    const touched: number[] = [];
    for (const it of items) {
      if (!it) continue;
      for (const [s, , max] of it.stats) t[s] += max;
      const k = it.set === undefined ? undefined : this.setIndex.get(it.set);
      if (k !== undefined && this.counts[k]++ === 0) touched.push(k);
    }
    let setBonuses = 0;
    for (const k of touched) {
      const n = this.counts[k];
      this.counts[k] = 0;
      for (const [s, v] of setBonusFor(this.setList[k], n)) t[s] += v;
      if (n >= 2) setBonuses += this.rules.setBonusCount === "piecesMinusOne" ? n - 1 : 1;
    }
    return { totals: t, setBonuses };
  }

  private condFailures(items: readonly (Item | null)[], totals: Float64Array, setBonuses: number): number {
    let n = 0;
    for (const it of items) if (it?.cond && !evalCond(it.cond, { totals, level: this.ch.level, setBonuses })) n++;
    return n;
  }

  evaluate(items: readonly (Item | null)[], alloc: Allocation, ev: Evaluator): Evaluation {
    const { totals, setBonuses } = this.totalsOf(items, alloc);
    return ev.evaluate(totals, items[WEAPON_SLOT], this.condFailures(items, totals, setBonuses));
  }

  private score = (items: readonly (Item | null)[], alloc: Allocation, ev: Evaluator) => this.evaluate(items, alloc, ev).score;

  private setup = (weights: Weights, voie?: readonly Voie[]): Setup => ({
    ...this.setupBase,
    weights,
    voie,
    ...(this.ehpFloor ? { targets: { ...this.setupBase.targets, ehp: this.ehpFloor } } : {}),
  });

  // ------------------------------------------------------------ valeurs linéaires

  /** Valeur de chaque item du pool au stuff courant : gradient · stats (exacte pour les armes). */
  private itemValues(items: (Item | null)[], alloc: Allocation, ev: Evaluator) {
    const { totals } = this.totalsOf(items, alloc);
    const g = ev.gradient(totals, items[WEAPON_SLOT]);
    const values = new Float64Array(this.pool.length);
    this.pool.forEach((it, i) => {
      let v = 0;
      for (const [s, , max] of it.stats) v += g[s] * max;
      values[i] = v;
    });
    if (!this.locked[WEAPON_SLOT]) {
      const trial = items.slice();
      trial[WEAPON_SLOT] = null;
      const without = this.score(trial, alloc, ev);
      for (const i of this.byType[TYPES.indexOf("arme")]) {
        trial[WEAPON_SLOT] = this.pool[i];
        values[i] = this.score(trial, alloc, ev) - without;
      }
    }
    if (this.free) this.setCond.forEach((x, i) => x && (values[i] = -Infinity));
    return { values, gradient: g };
  }

  // ------------------------------------------------------------ squelette de panoplies

  /**
   * Meilleure combinaison de panoplies au sens des valeurs linéaires : programmation dynamique sur le nombre
   * d'emplacements occupés par type, les emplacements restants étant remplis par les meilleurs items libres.
   */
  private skeleton(values: Float64Array, gradient: Float64Array) {
    const order = this.byType.map((idx) => [...idx].sort((a, b) => values[b] - values[a]));
    // fill[t][k] : valeur des k meilleurs items libres du type t.
    const fill = order.map((idx, t) => {
      const out = [0];
      for (let k = 0; k < CAP[t]; k++) out.push(out[k] + Math.max(0, idx[k] === undefined ? 0 : values[idx[k]]));
      return out;
    });
    // Coût d'opportunité d'un emplacement pris par une panoplie : le dernier item libre qu'on retire.
    const opp = order.map((idx, t) => Math.max(0, idx[CAP[t] - 1] === undefined ? 0 : values[idx[CAP[t] - 1]]));

    const start = new Array(N_TYPES).fill(0);
    this.locked.forEach((it, p) => it && start[TYPE_OF_POS[p]]++);
    const s0 = start.reduce((n, u, t) => n + u * MUL[t], 0);

    const options: SetOption[][] = [];
    const setRank: { set: number; gain: number }[] = [];
    this.setPieces.forEach((pieces, k) => {
      if (pieces.length < 2) return;
      const net = (i: number) => values[i] - opp[this.typeOf[i]];
      const sorted = [...pieces].sort((a, b) => net(b) - net(a));
      const opts: SetOption[] = [];
      let bestGain = 0;
      for (let n = 2; n <= sorted.length; n++) {
        const used = new Array(N_TYPES).fill(0);
        const chosen: number[] = [];
        for (const i of sorted) {
          const t = this.typeOf[i];
          if (start[t] + used[t] >= CAP[t]) continue;
          used[t]++;
          chosen.push(i);
          if (chosen.length === n) break;
        }
        if (chosen.length < n) break;
        let bonus = 0;
        for (const [s, v] of setBonusFor(this.setList[k], n)) bonus += gradient[s] * v;
        const netGain = chosen.reduce((x, i) => x + net(i), 0) + bonus;
        if (netGain <= 0) continue;
        bestGain = Math.max(bestGain, netGain);
        const uses = used.flatMap((u, t) => (u ? [[t, u] as [number, number]] : []));
        opts.push({
          set: k, pieces: chosen, uses,
          code: uses.reduce((c, [t, u]) => c + u * MUL[t], 0),
          gain: chosen.reduce((x, i) => x + values[i], 0) + bonus,
        });
      }
      if (opts.length) {
        options.push(opts);
        setRank.push({ set: k, gain: bestGain });
      }
    });

    let dp = new Float64Array(N_STATES).fill(-Infinity);
    dp[s0] = 0;
    const choices: Int8Array[] = [];
    for (const opts of options) {
      const next = dp.slice();
      const ch = new Int8Array(N_STATES);
      for (let s = 0; s < N_STATES; s++) {
        const base = dp[s];
        if (base === -Infinity) continue;
        const row = s * N_TYPES;
        for (let o = 0; o < opts.length; o++) {
          const op = opts[o];
          let fits = true;
          for (const [t, u] of op.uses) if (USAGE[row + t] + u > CAP[t]) fits = false;
          if (!fits) continue;
          const s2 = s + op.code;
          const v = base + op.gain;
          if (v > next[s2]) {
            next[s2] = v;
            ch[s2] = o + 1;
          }
        }
      }
      dp = next;
      choices.push(ch);
    }

    let best = s0;
    let bestValue = -Infinity;
    for (let s = 0; s < N_STATES; s++) {
      if (dp[s] === -Infinity) continue;
      let v = dp[s];
      for (let t = 0; t < N_TYPES; t++) v += fill[t][CAP[t] - USAGE[s * N_TYPES + t]];
      if (v > bestValue) {
        bestValue = v;
        best = s;
      }
    }
    const picked: SetOption[] = [];
    for (let k = options.length - 1, s = best; k >= 0; k--) {
      const o = choices[k][s];
      if (!o) continue;
      picked.push(options[k][o - 1]);
      s -= options[k][o - 1].code;
    }

    const items = this.locked.slice();
    const used = new Set(items.flatMap((it) => (it ? [it.id] : [])));
    const place = (i: number) => {
      const it = this.pool[i];
      const p = POSITIONS[this.typeOf[i]].find((q) => !items[q]);
      if (p === undefined || used.has(it.id)) return;
      items[p] = it;
      used.add(it.id);
    };
    for (const o of picked) o.pieces.forEach(place);
    order.forEach((idx, t) => {
      for (const i of idx) {
        if (values[i] <= 0 || POSITIONS[t].every((q) => items[q])) break;
        place(i);
      }
    });
    setRank.sort((a, b) => b.gain - a.gain);
    return { items, order, setRank: setRank.slice(0, TOP_SETS).map((r) => r.set) };
  }

  // ------------------------------------------------------------ recherche locale

  private localSearch(items: (Item | null)[], alloc: Allocation, ev: Evaluator, cands: Item[][], pairs: [Item, Item][]): number {
    let best = this.score(items, alloc, ev);
    const equipped = (id: number) => items.some((it) => it?.id === id);
    const tryMove = (positions: number[], news: (Item | null)[]) => {
      const olds = positions.map((p) => items[p]);
      positions.forEach((p, j) => (items[p] = news[j]));
      const s = this.score(items, alloc, ev);
      if (s > best + EPS) {
        best = s;
        return true;
      }
      positions.forEach((p, j) => (items[p] = olds[j]));
      return false;
    };

    for (let round = 0; round < 20; round++) {
      // Échanges simples jusqu'à stabilité.
      for (let sweep = 0; sweep < 30; sweep++) {
        let improved = false;
        for (let p = 0; p < N_SLOTS; p++) {
          if (this.locked[p]) continue;
          if (items[p] && tryMove([p], [null])) improved = true;
          for (const c of cands[TYPE_OF_POS[p]]) {
            if (c === items[p] || equipped(c.id)) continue;
            if (tryMove([p], [c])) improved = true;
          }
        }
        if (!improved) break;
      }
      // Paires de pièces d'une même panoplie (débloque un bonus qu'aucun échange simple n'atteint).
      let improved = false;
      for (const [a, b] of pairs) {
        if (equipped(a.id) || equipped(b.id)) continue;
        const pa = POSITIONS[TYPES.indexOf(a.slot)].filter((p) => !this.locked[p]);
        const pb = POSITIONS[TYPES.indexOf(b.slot)].filter((p) => !this.locked[p]);
        search: for (const p of pa) {
          for (const q of pb) {
            if (p === q) continue;
            if (tryMove([p, q], [a, b])) {
              improved = true;
              break search;
            }
          }
        }
      }
      if (!improved) break;
    }
    return best;
  }

  private candidates(order: number[][], setRank: number[], keep: (Item | null)[][]): { cands: Item[][]; pairs: [Item, Item][] } {
    const cands = order.map((idx, t) => {
      const out = new Set<Item>(idx.filter(this.allowed).slice(0, CANDIDATES + CAP[t]).map((i) => this.pool[i]));
      for (const k of setRank) for (const i of this.setPieces[k]) if (this.typeOf[i] === t && this.allowed(i)) out.add(this.pool[i]);
      for (const items of keep) for (const p of POSITIONS[t]) if (items[p] && !this.locked[p] && !(this.free && this.setCondItems.has(items[p]!))) out.add(items[p]!);
      return [...out];
    });
    const pairs: [Item, Item][] = [];
    for (const k of setRank) {
      const pieces = this.setPieces[k].filter(this.allowed).map((i) => this.pool[i]);
      for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) pairs.push([pieces[i], pieces[j]]);
    }
    return { cands, pairs };
  }

  // ------------------------------------------------------------ caractéristiques

  private allocate(items: (Item | null)[], ev: Evaluator): Allocation {
    const { totals: bare, setBonuses } = this.totalsOf(items, emptyAlloc());
    const t = bare.slice();
    return optimizeAllocation(this.ch.cls, this.points, (a) => {
      for (const k of BASE_CARACS) t[S[k]] = bare[S[k]] + a[k];
      return ev.evaluate(t, items[WEAPON_SLOT], this.condFailures(items, t, setBonuses)).score;
    });
  }

  /** Tous les points dans une caractéristique (départ mono-élément). */
  private allIn(k: BaseCarac): Allocation {
    const a = emptyAlloc();
    const tiers = this.ch.cls.statCosts[k];
    let lo = 0;
    let hi = this.points;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (pointsFor(tiers, mid) <= this.points) lo = mid;
      else hi = mid - 1;
    }
    a[k] = lo;
    return a;
  }

  // ------------------------------------------------------------ boucle principale

  /** Caractéristiques puis variantes de sorts pour ces items, en ne gardant que ce qui améliore. */
  private settle(items: (Item | null)[], alloc0: Allocation, ev: Evaluator): State {
    const realloc = this.allocate(items, ev);
    const alloc = this.score(items, realloc, ev) >= this.score(items, alloc0, ev) ? realloc : alloc0;
    const ev2 = Evaluator.forStats(ev.setup, this.totalsOf(items, alloc).totals);
    const s1 = this.score(items, alloc, ev);
    const s2 = this.score(items, alloc, ev2);
    return s2 >= s1 ? { items, alloc, ev: ev2, score: s2 } : { items, alloc, ev, score: s1 };
  }

  /** Polissage : échanges sur tout le pool, la valeur linéaire pouvant mal classer un item près des plafonds. */
  private polish(best: State, pairs: [Item, Item][] = []): State {
    for (let iter = 0; iter < MAX_ITER; iter++) {
      const items = best.items.slice();
      this.localSearch(items, best.alloc, best.ev, this.cands, pairs);
      const next = this.settle(items, best.alloc, best.ev);
      if (next.score <= best.score + 1e-6) break;
      best = next;
    }
    return best;
  }

  /**
   * Optimisation depuis un stuff de départ (1 à 4 de l'en-tête), en au plus `iters` tours ; `polish` : finir par le
   * polissage sur tout le pool.
   */
  run(start: { items: (Item | null)[]; alloc: Allocation }, weights: Weights, voie?: readonly Voie[], polish = true, iters = MAX_ITER): State {
    const setup = this.setup(weights, voie);
    const ev0 = Evaluator.forStats(setup, this.totalsOf(start.items, start.alloc).totals);
    let best: State = { items: start.items.slice(), alloc: start.alloc, ev: ev0, score: this.score(start.items, start.alloc, ev0) };
    let pairs: [Item, Item][] = [];
    for (let iter = 0; iter < iters; iter++) {
      const { values, gradient } = this.itemValues(best.items, best.alloc, best.ev);
      const sk = this.skeleton(values, gradient);
      const current = best.items.slice();
      const c = this.candidates(sk.order, sk.setRank, [sk.items, current]);
      pairs = c.pairs;
      const proposal = sk.items;
      const sp = this.localSearch(proposal, best.alloc, best.ev, c.cands, pairs);
      const sc = this.localSearch(current, best.alloc, best.ev, c.cands, pairs);
      const next = this.settle(sp >= sc ? proposal : current, best.alloc, best.ev);
      if (next.score <= best.score + 1e-6) break;
      best = next;
    }
    return polish ? this.polish(best, pairs) : best;
  }

  /** Échanges simples de chaque emplacement (évaluation exacte), du meilleur au moins bon. */
  private swapScores(s: State): { p: number; it: Item | null; score: number }[] {
    const items = s.items.slice();
    const equipped = new Set(items.flatMap((it) => (it ? [it.id] : [])));
    const out: { p: number; it: Item | null; score: number }[] = [];
    for (let p = 0; p < N_SLOTS; p++) {
      if (this.locked[p]) continue;
      const old = items[p];
      for (const c of [null, ...this.cands[TYPE_OF_POS[p]]]) {
        if (c === old || (c && equipped.has(c.id))) continue;
        items[p] = c;
        out.push({ p, it: c, score: this.score(items, s.alloc, s.ev) });
      }
      items[p] = old;
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** Meilleurs remplaçants de chaque emplacement (échange simple, évaluation exacte). */
  private topSwaps(s: State): (Item | null)[][] {
    const swaps = this.swapScores(s);
    return SLOTS.map((_, p) => swaps.filter((m) => m.p === p).slice(0, PERTURB_TOP).map((m) => m.it));
  }

  /**
   * Recherche locale itérée : on remplace 2 à 7 items au hasard parmi les meilleurs candidats et on relance
   * l'optimisation depuis là. Sort des optimums locaux qu'aucun échange d'un ou deux items ne quitte
   * (changement de panoplie, d'arme et de Dofus en même temps).
   */
  perturb(best: State, weights: Weights, voie: readonly Voie[] | undefined, tries: number, seed = 1): State {
    const rand = rng(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    let top: (Item | null)[][] = [];
    let sets: Item[][] = [];
    const refresh = () => {
      top = this.topSwaps(best);
      // Panoplies représentées parmi les meilleurs remplaçants, avec leurs pièces permises.
      const ks = new Set(top.flat().flatMap((it) => (it?.set === undefined ? [] : [this.setIndex.get(it.set)!])));
      sets = [...ks].map((k) => this.setPieces[k].filter(this.allowed).map((i) => this.pool[i])).filter((pieces) => pieces.length >= 2);
    };
    refresh();
    for (let stall = 0; stall < tries; stall++) {
      const items = best.items.slice();
      let n = 2 + Math.floor(rand() * 6);
      if (sets.length && rand() < 0.5) {
        // Perturbation par panoplie : 2 à 4 pièces d'une même panoplie, puis 0 à 2 items au hasard.
        const pieces = pick(sets).slice().sort(() => rand() - 0.5);
        const want = 2 + Math.floor(rand() * 3);
        const used = new Set<number>();
        for (const it of pieces) {
          if (used.size >= want) break;
          const free = POSITIONS[TYPES.indexOf(it.slot)].filter((p) => !this.locked[p] && !used.has(p));
          if (!free.length) continue;
          const p = pick(free);
          items[p] = it;
          used.add(p);
        }
        n = Math.floor(rand() * 3);
      }
      for (let j = 0; j < n; j++) {
        const p = Math.floor(rand() * N_SLOTS);
        if (this.locked[p] || !top[p].length) continue;
        items[p] = rand() < 0.15 ? null : top[p][Math.floor(rand() * top[p].length)];
      }
      const seen = new Set<number>();
      items.forEach((it, p) => {
        if (it && seen.has(it.id) && !this.locked[p]) items[p] = null;
        else if (it) seen.add(it.id);
      });
      // Un tour d'abord ; l'optimisation complète seulement si le stuff s'approche du meilleur.
      let s = this.run({ items, alloc: best.alloc }, weights, voie, false, 1);
      if (s.score < best.score - RESTART_MARGIN) continue;
      s = this.run(s, weights, voie);
      if (s.score > best.score + 1e-6) {
        best = s;
        refresh();
        stall = -1;
      }
    }
    // Passe finale : deux pièces de n'importe quelle panoplie à la fois, pas seulement des mieux classées.
    for (let iter = 0; iter < MAX_ITER; iter++) {
      const items = best.items.slice();
      this.localSearch(items, best.alloc, best.ev, this.cands, this.pairs);
      const next = this.run({ items, alloc: best.alloc }, weights, voie);
      if (next.score <= best.score + 1e-6) break;
      best = next;
    }
    return best;
  }

  /**
   * Plusieurs chaînes de recherche itérée indépendantes (graines différentes) depuis le même stuff : à temps égal,
   * des chaînes courtes trouvent mieux qu'une longue, qui reste prise dans le premier bassin qu'elle atteint.
   */
  private chains(start: State, weights: Weights, voie: readonly Voie[] | undefined, n: number): State {
    // En parallèle, chaque part prend sa tranche de graines (au moins une chaîne chacune).
    const { index = 0, count = 1 } = this.req.part ?? {};
    const per = Math.ceil(n / count);
    let best = start;
    for (let seed = index * per + 1; seed <= (index + 1) * per; seed++) {
      const s = this.perturb(start, weights, voie, PERTURB_TRIES, seed);
      if (s.score > best.score) best = s;
    }
    return best;
  }

  /** Régimes de recherche : avec les items à condition de panoplie, puis sans (s'il y en a). */
  private get regimes() {
    return this.setCondItems.size ? [false, true] : [false];
  }

  private inRegime<T>(free: boolean, f: () => T): T {
    this.free = free;
    try {
      return f();
    } finally {
      this.free = false;
    }
  }

  /**
   * Stuff du rôle : meilleur stuff de chaque voie (ou de chaque élément de la voie imposée), mélange des éléments
   * sans voie imposée, puis recherche itérée dans chaque régime.
   */
  private rolePhase(step: (msg: string) => void) {
    const role = this.req.weights;
    const fixed = this.req.voie?.length ? [...this.req.voie] : undefined;
    const { cls, level, profile, targets, monster, rules } = this.setupBase;
    const voies = analyzeVoies(cls, level, profile, targets, monster, rules);
    const seeds: Voie[] = fixed ?? voies.filter((v) => v.rel >= TRY_VOIE || v.healRel >= TRY_VOIE).map((v) => v.voie);
    const regimes = this.regimes;

    const voieStates = new Map<Voie, State>();
    const regimeStates: (State | undefined)[] = regimes.map(() => undefined);
    let best: State | undefined;
    let mainCarac = seeds[0];
    for (const k of seeds) {
      let voieBest: State | undefined;
      regimes.forEach((free, r) => {
        const s = this.inRegime(free, () => this.run({ items: this.locked.slice(), alloc: this.allIn(k) }, role, fixed ?? [k]));
        voieBest = better(voieBest, s);
        regimeStates[r] = better(regimeStates[r], s);
      });
      if (!fixed) voieStates.set(k, voieBest!);
      if (!best || voieBest!.score > best.score) {
        best = voieBest;
        mainCarac = k;
      }
      step(fixed ? `départ ${STAT_LABELS[k]}` : `voie ${VOIE_LABEL[k]}`);
    }
    // Sans voie imposée : tous les sorts sont permis, en partant du meilleur stuff mono-élément (multi si ça paie).
    let chains = regimeStates.map((s) => s!);
    if (!fixed) {
      chains = chains.map((s, r) => this.inRegime(regimes[r], () => this.run({ items: s.items, alloc: s.alloc }, role)));
      step("mélange des éléments");
    }
    chains = chains.map((s, r) => this.inRegime(regimes[r], () => this.chains(s, role, fixed, CHAINS_ROLE)));
    step("redémarrages");
    return { voies, voieStates, chains, roleState: chains.reduce(better), mainCarac, fixed, seeds };
  }

  /**
   * Un point du front de Pareto : départ depuis le stuff voisin de chaque régime et départ à froid sur l'élément
   * principal (la recherche locale dépend de son point de départ), puis recherche itérée dans le régime qui mène.
   * Renvoie les nouveaux stuffs de chaque régime, dont le meilleur est le point du front.
   */
  private frontStep(prev: State[], w: Weights, mainCarac: Voie): State[] {
    const fixed = this.req.voie?.length ? [...this.req.voie] : undefined;
    const regimes = this.regimes;
    const next = prev.map((p, r) =>
      this.inRegime(regimes[r], () =>
        better(this.run({ items: p.items, alloc: p.alloc }, w, fixed), this.run({ items: this.locked.slice(), alloc: this.allIn(mainCarac) }, w, fixed)),
      ),
    );
    const lead = next.indexOf(next.reduce(better));
    next[lead] = this.inRegime(regimes[lead], () => this.chains(next[lead], w, fixed, CHAINS_FRONT));
    return next;
  }

  solve(progress?: Progress): SolveResult {
    const t0 = performance.now();
    const role = this.req.weights;
    const weightsList = frontWeights(role);
    const total = (this.req.voie?.length || 4) + (this.req.voie?.length ? 0 : 1) + 1 + weightsList.length;
    let done = 0;
    const step = (msg: string) => progress?.(Math.min(0.99, ++done / total), msg);

    const phase = this.rolePhase(step);
    // Front de Pareto : on glisse la pondération de proche en proche depuis le stuff du rôle.
    const states = new Map<number, State>([[role.dmg, phase.roleState]]);
    const below = weightsList.filter((w) => w < role.dmg);
    const above = weightsList.filter((w) => w > role.dmg).reverse();
    for (const chain of [above, below]) {
      let prev = phase.chains;
      for (const wd of chain) {
        prev = this.frontStep(prev, { dmg: wd, surv: 1 - wd }, phase.mainCarac);
        states.set(wd, prev.reduce(better));
        step(`pondération dégâts ${Math.round(wd * 100)} %`);
      }
    }
    progress?.(1, "terminé");

    const builds = [...states.entries()].map(([wd, s]) => this.describe(s, wd === role.dmg ? role : { dmg: wd, surv: 1 - wd }));
    const roleBuild = builds.find((b) => b.weights === role)!;
    const gapBuilds = frontGaps(paretoFilter(builds, roleBuild)).map((g) => this.solveGap(g, phase.mainCarac));
    const front = paretoFilter([...builds, ...gapBuilds], roleBuild);
    return {
      builds: front,
      highlighted: front.findIndex((b) => b.weights === role),
      targets: this.targets,
      rules: this.rules,
      voies: phase.voies,
      voieBuilds: [...phase.voieStates].map(([voie, s]) => ({ voie, build: this.describe(s, role) })),
      voie: phase.fixed,
      elapsedMs: performance.now() - t0,
    };
  }

  // ------------------------------------------------------------ calcul parallèle (voir parallel.ts)

  private toRef = (s: State): StuffRef => ({ items: s.items.map((it) => it?.id ?? null), alloc: s.alloc, score: s.score });

  private fromRef(ref: StuffRef, weights: Weights): State {
    const items = ref.items.map((id) => (id == null ? null : this.byId.get(id)!));
    const ev = Evaluator.forStats(this.setup(weights, this.req.voie), this.totalsOf(items, ref.alloc).totals);
    return { items, alloc: ref.alloc, ev, score: this.score(items, ref.alloc, ev) };
  }

  /** Phase 1 d'un calcul parallèle : stuff du rôle (chaînes de la part `req.part`). */
  solveRole(progress?: Progress): RolePhaseResult {
    let done = 0;
    const total = (this.req.voie?.length || 4) + 2;
    const phase = this.rolePhase((msg) => progress?.(Math.min(1, ++done / total), msg));
    return {
      voies: phase.voies,
      voieBuilds: [...phase.voieStates].map(([voie, s]) => ({ voie, build: this.describe(s, this.req.weights) })),
      regimes: phase.chains.map(this.toRef),
      role: this.describe(phase.roleState, this.req.weights),
      mainCarac: phase.mainCarac,
      targets: this.targets,
      rules: this.rules,
    };
  }

  /** Phase 2 : un point du front, depuis les meilleurs stuffs de chaque régime de la phase 1. */
  solvePoint(dmg: number, starts: StuffRef[], mainCarac: Voie): BuildResult {
    const w: Weights = { dmg, surv: 1 - dmg };
    const next = this.frontStep(starts.map((r) => this.fromRef(r, w)), w, mainCarac);
    return this.describe(next.reduce(better), w);
  }

  /**
   * Comble un trou du front : meilleur stuff à la pondération la plus offensive des deux voisins, avec des PV
   * effectifs au moins égaux au plancher. Décrit à la pondération médiane, sans le plancher.
   */
  solveGap(gap: FrontGap, mainCarac: Voie): BuildResult {
    const w: Weights = { dmg: gap.dmg, surv: 1 - gap.dmg };
    this.ehpFloor = gap.floor;
    let s: State;
    try {
      const start = gap.starts.map((r) => this.fromRef(r, w)).reduce(better);
      s = this.frontStep(this.regimes.map(() => start), w, mainCarac).reduce(better);
    } finally {
      this.ehpFloor = 0;
    }
    const label: Weights = { dmg: gap.label, surv: 1 - gap.label };
    return this.describe(this.fromRef(this.toRef(s), label), label);
  }

  /**
   * Évalue un stuff donné sans changer ses items. Sans répartition fournie, les points de caractéristique sont
   * répartis au mieux pour le rôle, en partant de chaque caractéristique d'élément (voie imposée seulement).
   */
  evaluateStuff(stuff: StuffInput): BuildResult {
    const weights = this.req.weights;
    const items = SLOTS.map((_, p) => {
      const id = stuff.items[p];
      return id == null ? null : (this.byId.get(id) ?? null);
    });
    const setup = this.setup(weights, this.req.voie);
    const at = (alloc: Allocation): State => {
      const ev = Evaluator.forStats(setup, this.totalsOf(items, alloc).totals);
      return { items, alloc, ev, score: this.score(items, alloc, ev) };
    };
    if (stuff.alloc) {
      const b = this.describe(at(stuff.alloc), weights);
      const used = allocPoints(this.ch.cls, stuff.alloc);
      if (used > this.points) b.problems.push(`Caractéristiques : ${used} points investis sur ${this.points} disponibles`);
      return b;
    }
    const starts: BaseCarac[] = this.req.voie?.length ? this.req.voie : ["force", "intel", "chance", "agi"];
    const best = starts
      .map((k) => {
        const s0 = at(this.allIn(k));
        const s1 = this.settle(items, s0.alloc, s0.ev);
        return this.settle(items, s1.alloc, s1.ev);
      })
      .reduce(better);
    return this.describe(best, weights);
  }

  // ------------------------------------------------------------ résultat

  describe(s: State, weights: Weights): BuildResult {
    const ch: Character = { ...this.ch, alloc: s.alloc };
    const sets = new Map(this.setList.map((x) => [x.id, x]));
    const agg = aggregate(ch, s.items, sets, this.rules);
    const evaluation = s.ev.evaluate(agg.totals, s.items[WEAPON_SLOT], this.condFailures(s.items, agg.totals, agg.setBonuses));
    const problems = buildProblems(ch, s.items, agg, this.req.levelMargin);
    const t = agg.totals;
    const cap = (k: "pa" | "pm" | "po" | "invo", v: number) => Math.min(v, k === "pa" ? this.rules.capPA : k === "pm" ? this.rules.capPM : k === "po" ? this.rules.capPO : Infinity);
    for (const k of ["pa", "pm", "po", "invo"] as const) {
      const v = cap(k, t[S[k]]);
      if (v < this.targets[k]) problems.push(`${STAT_LABELS[k]} : ${v} / ${this.targets[k]} visés`);
    }
    if (this.targets.dpt && evaluation.dpt < this.targets.dpt)
      problems.push(`Dégâts par tour : ${Math.round(evaluation.dpt)} / ${this.targets.dpt} visés`);
    const itemValue = s.items.map((it, p) => {
      if (!it) return 0;
      const trial = s.items.slice();
      trial[p] = null;
      return evaluation.score - this.score(trial, s.alloc, s.ev);
    });
    return {
      weights,
      level: this.ch.level,
      items: s.items,
      alloc: s.alloc,
      totals: [...t],
      hp: hitPoints(t, this.ch.level),
      evaluation,
      sets: [...agg.setPieces].filter(([, n]) => n >= 2).map(([id, n]) => ({ id, name: sets.get(id)!.name, pieces: n })),
      setBonuses: agg.setBonuses,
      rotation: s.ev.explain(t, s.items[WEAPON_SLOT]),
      itemValue,
      problems,
    };
  }
}

/** Trou du front de Pareto à combler (voir `Solver.solveGap`). */
export interface FrontGap {
  /** Pondération dégâts de la recherche (la plus offensive des deux voisins). */
  dmg: number;
  /** Pondération dégâts affichée (médiane des deux voisins). */
  label: number;
  /** PV effectifs minimum : moyenne géométrique des deux voisins. */
  floor: number;
  starts: StuffRef[];
}

/** Trous d'un front trié du plus offensif au plus défensif, les plus grands d'abord. */
export function frontGaps(front: BuildResult[]): FrontGap[] {
  const ref = (b: BuildResult): StuffRef => ({ items: b.items.map((it) => it?.id ?? null), alloc: b.alloc, score: b.evaluation.score });
  const gaps: (FrontGap & { size: number })[] = [];
  for (let i = 0; i + 1 < front.length; i++) {
    const [a, b] = [front[i].evaluation, front[i + 1].evaluation];
    const dDmg = Math.log(a.dpt / b.dpt);
    const dSurv = Math.log(b.ehp / a.ehp);
    if (dDmg < FRONT_GAP || dSurv < FRONT_GAP) continue;
    const [wa, wb] = [front[i].weights.dmg, front[i + 1].weights.dmg];
    gaps.push({
      dmg: Math.max(wa, wb), label: (wa + wb) / 2, floor: Math.sqrt(a.ehp * b.ehp), starts: [ref(front[i]), ref(front[i + 1])], size: dDmg * dSurv,
    });
  }
  return gaps.sort((x, y) => y.size - x.size).slice(0, MAX_GAPS).map(({ size: _, ...g }) => g);
}

/** Garde les stuffs non dominés en (DPT, EHP, soins), sans doublon, du plus offensif au plus défensif. */
export function paretoFilter(builds: BuildResult[], keep: BuildResult): BuildResult[] {
  const key = (b: BuildResult) => b.items.map((it) => it?.id ?? 0).join(",") + "|" + BASE_CARACS.map((k) => b.alloc[k]).join(",");
  const seen = new Set<string>();
  const out: BuildResult[] = [];
  for (const b of [keep, ...builds.filter((x) => x !== keep)]) {
    const k = key(b);
    if (seen.has(k)) continue;
    seen.add(k);
    const dominated = builds.some(
      (o) =>
        o !== b && o.evaluation.penalty <= b.evaluation.penalty &&
        o.evaluation.dpt >= b.evaluation.dpt && o.evaluation.ehp >= b.evaluation.ehp && o.evaluation.hpt >= b.evaluation.hpt &&
        (o.evaluation.dpt > b.evaluation.dpt || o.evaluation.ehp > b.evaluation.ehp || o.evaluation.hpt > b.evaluation.hpt),
    );
    if (!dominated || b === keep) out.push(b);
  }
  return out.sort((a, b) => b.evaluation.dpt - a.evaluation.dpt);
}

export function solve(data: GameData, req: SolveRequest, progress?: Progress): SolveResult {
  return new Solver(data, req).solve(progress);
}

