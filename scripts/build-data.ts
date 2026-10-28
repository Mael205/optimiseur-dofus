// Normalise les données brutes (data/raw) en fichiers compacts pour l'app (public/data).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { S, type StatKey } from "../src/engine/statIds";
import type {
  ClassData, Cond, DmgLine, Item, ItemSet, LineElem, MonsterRef, Slot, Spell, SpellBoost, SpellGrade, SpellLine, StatLine,
} from "../src/engine/types";

const ROOT = join(import.meta.dirname, "..");
const RAW = join(ROOT, "data", "raw");
const OUT = join(ROOT, "public", "data");

const readJson = (p: string) => JSON.parse(readFileSync(join(RAW, p), "utf8"));
/** Les fichiers du jeu (export Unity) rangent les lignes dans references.RefIds[].data. */
const gameRows = <T = any>(name: string): T[] =>
  readJson(`game/${name}.json`).references.RefIds.map((r: { data: T }) => r.data);
const arr = <T>(x: { Array: T[] } | undefined): T[] => x?.Array ?? [];

// ---------------------------------------------------------------- items (API dofusdude)

/** Ids d'effets dofusdude → stat unifiée. */
const EFFECT_STAT: Record<number, StatKey> = {
  8: "pm", 9: "vita", 10: "sagesse", 12: "pa", 13: "intel", 22: "chance", 36: "agi", 45: "force",
  14: "rfFeu", 15: "rfTerre", 33: "rfNeutre", 60: "rfAir", 82: "rfEau", 46: "rfCrit", 70: "rfPou",
  16: "rpAir", 17: "rpEau", 34: "rpNeutre", 37: "rpFeu", 63: "rpTerre", 65: "rpMelee", 108: "rpDist",
  30: "do", 32: "puissance", 38: "doCrit", 27: "doEau", 47: "doAir", 48: "doTerre", 49: "doNeutre", 61: "doFeu",
  62: "doPou", 112: "doPieges", 106: "puiPieges",
  40: "pctMelee", 41: "pctArmes", 71: "pctDist", 93: "pctSorts",
  24: "ini", 25: "prospe", 26: "tacle", 28: "invo", 29: "crit", 31: "po", 39: "esqPM", 50: "retPM", 59: "fuite",
  64: "retPA", 75: "esqPA", 121: "soin", 220: "pods", 249: "renvoi",
};

/** Lignes de dégâts des armes (ids dofusdude). */
const WEAPON_LINE: Record<number, [LineElem, DmgLine["kind"]]> = {
  195: [0, "dmg"], 194: [1, "dmg"], 198: [2, "dmg"], 214: [3, "dmg"], 189: [4, "dmg"], 248: [-1, "dmg"],
  223: [0, "steal"], 221: [1, "steal"], 193: [2, "steal"], 203: [3, "steal"], 224: [4, "steal"], 257: [-1, "steal"],
  278: [0, "heal"], 261: [2, "heal"],
};

/**
 * Items accessibles aux joueurs : le bit 1024 de m_flags (fichiers du jeu) manque aux seuls items réservés
 * (MJ, quêtes temporaires, serveur Ankarton, objets nominatifs…), déduit des données comme FLAG_RANGE_BOOSTABLE.
 */
const FLAG_PLAYABLE = 1024;
/** Critères impossibles en jeu normal : droits MJ, nom de personnage, quête en cours, carte, serveur, incarnation. */
const IMPOSSIBLE_CRITERION = /\b(PX|PN|Qa|Qo|OS|Pm|PZ)[=<>!~]|\bBI=1/;

/** Effets textuels à garder pour l'affichage : passifs (163) et modificateurs de sorts de classe (204-279). */
const NOTE_EFFECTS = new Set([163, 204, 205, 207, 208, 209, 226, 227, 240, 243, 245, 274, 276, 279]);

const TYPE_SLOT: Record<number, Slot> = {
  33: "amulette", 17: "anneau", 27: "coiffe", 43: "cape", 58: "ceinture", 45: "bottes", 87: "bouclier",
  1: "familier", 180: "familier", 247: "familier", 242: "familier", 245: "familier",
  177: "dofus", 23: "dofus", 124: "dofus",
};
const WEAPON_TYPES = new Set([80, 39, 93, 65, 125, 42, 52, 73, 163, 111, 199, 105]);

interface ApiEffect {
  int_minimum: number;
  int_maximum: number;
  ignore_int_min: boolean;
  ignore_int_max: boolean;
  type: { id: number; name: string };
  formatted: string;
}

/** Plage [min, max] d'un effet ; une valeur fixe a ignore_int_max = true. */
function effectRange(e: ApiEffect): [number, number] {
  const max = e.ignore_int_max ? e.int_minimum : e.int_maximum;
  return [Math.min(e.int_minimum, max), Math.max(e.int_minimum, max)];
}

const CONDITION_STAT: Record<number, StatKey> = {
  8: "pm", 12: "pa", 10: "sagesse", 22: "chance", 45: "force", 36: "agi", 9: "vita", 13: "intel",
};

function convertCond(n: any, unknown: Set<string>): Cond | undefined {
  if (!n.is_operand) {
    const c = (n.children as any[]).map((x) => convertCond(x, unknown)).filter((x): x is Cond => !!x);
    if (c.length === 0) return undefined;
    return c.length === 1 ? c[0] : { op: n.relation === "or" ? "or" : "and", c };
  }
  const { operator: cmp, int_value: v, element } = n.condition;
  if (element.id in CONDITION_STAT) return { stat: S[CONDITION_STAT[element.id]], cmp, v };
  if (element.id === 72) return { sets: true, cmp, v };
  if (element.id === 200) return { level: true, cmp, v };
  // Alignement, abonnement, kamas… : supposés remplis.
  unknown.add(`${element.id} ${element.name}`);
  return undefined;
}

function buildItems(): Item[] {
  const raw = readJson("api/equipment.json").items as any[];
  const game = new Map(gameRows("items").map((r) => [r.id as number, r]));
  const unknownEffects = new Map<string, number>();
  const unknownConds = new Set<string>();
  const excluded: string[] = [];
  const items: Item[] = [];
  for (const it of raw) {
    const typeId: number = it.type.id;
    const slot: Slot | undefined = WEAPON_TYPES.has(typeId) ? "arme" : TYPE_SLOT[typeId];
    if (!slot) continue;
    const g = game.get(it.ankama_id);
    if (!g || !(g.m_flags & FLAG_PLAYABLE) || IMPOSSIBLE_CRITERION.test(g.criterions ?? "")) {
      excluded.push(it.name);
      continue;
    }
    const stats: StatLine[] = [];
    const lines: DmgLine[] = [];
    const notes: string[] = [];
    for (const e of (it.effects ?? []) as ApiEffect[]) {
      const id = e.type.id;
      const [min, max] = effectRange(e);
      if (id in EFFECT_STAT) {
        const stat = S[EFFECT_STAT[id]];
        const prev = stats.find((s) => s[0] === stat);
        if (prev) { prev[1] += min; prev[2] += max; } else stats.push([stat, min, max]);
      } else if (id in WEAPON_LINE) {
        const [elem, kind] = WEAPON_LINE[id];
        lines.push({ elem, kind, min, max });
      } else if (NOTE_EFFECTS.has(id)) {
        notes.push(e.formatted.replace(/\{\{spell,\d+,\d+::([^}]*)\}\}/g, "$1").trim());
      } else {
        const k = `${id} ${e.type.name}`;
        unknownEffects.set(k, (unknownEffects.get(k) ?? 0) + 1);
      }
    }
    const item: Item = {
      id: it.ankama_id,
      name: it.name,
      typeId,
      type: it.type.name,
      slot,
      level: it.level,
      stats,
    };
    if (it.parent_set) item.set = it.parent_set.id;
    if (it.image_urls?.icon) item.icon = it.image_urls.icon;
    if (it.conditions) {
      const cond = convertCond(it.conditions, unknownConds);
      if (cond) item.cond = cond;
    }
    if (slot === "arme") {
      item.weapon = {
        ap: it.ap_cost ?? 0,
        minRange: it.range?.min ?? 1,
        range: it.range?.max ?? 1,
        critRate: it.critical_hit_probability ?? 0,
        critBonus: it.critical_hit_bonus ?? 0,
        // 0 sur une seule arme jouable (Bounihimée) : on prend le cas général, 1 utilisation par tour.
        perTurn: it.max_cast_per_turn || 1,
        lines,
      };
    }
    if (notes.length) item.notes = notes;
    items.push(item);
  }
  console.log(`items : ${items.length} (${excluded.length} inaccessibles écartés)`);
  console.log("  effets ignorés :", [...unknownEffects].map(([k, n]) => `${k} ×${n}`).join(", "));
  console.log("  conditions supposées remplies :", [...unknownConds].join(", "));
  return items;
}

function buildSets(items: Item[]): ItemSet[] {
  const raw = readJson("api/sets.json").sets as any[];
  const known = new Set(items.map((i) => i.id));
  const sets: ItemSet[] = [];
  for (const s of raw) {
    const members = (s.equipment_ids ?? []).filter((id: number) => known.has(id));
    if (members.length < 2) continue;
    const bonus: ItemSet["bonus"] = {};
    for (const [n, effects] of Object.entries(s.effects ?? {})) {
      const list: [number, number][] = [];
      for (const e of (effects ?? []) as ApiEffect[]) {
        if (!(e.type.id in EFFECT_STAT)) continue;
        list.push([S[EFFECT_STAT[e.type.id]], effectRange(e)[1]]);
      }
      if (list.length) bonus[+n] = list;
    }
    sets.push({ id: s.ankama_id, name: s.name, items: members, bonus });
  }
  console.log(`panoplies : ${sets.length}`);
  return sets;
}

// ---------------------------------------------------------------- classes et sorts (fichiers du jeu)

/** actionId des effets de sort → ligne de dégâts/soin qui profite des stats. */
const SPELL_LINE: Record<number, [LineElem, DmgLine["kind"]]> = {
  100: [0, "dmg"], 97: [1, "dmg"], 99: [2, "dmg"], 96: [3, "dmg"], 98: [4, "dmg"], 2822: [-1, "dmg"], 2832: [-2, "dmg"],
  // Dommages proportionnels aux PM restants : traités comme des dommages classiques.
  1012: [0, "dmg"], 1016: [1, "dmg"], 1015: [2, "dmg"], 1014: [3, "dmg"], 1013: [4, "dmg"],
  95: [0, "steal"], 92: [1, "steal"], 94: [2, "steal"], 91: [3, "steal"], 93: [4, "steal"], 2828: [-1, "steal"], 2890: [-2, "steal"],
  3001: [0, "heal"], 3000: [1, "heal"], 108: [2, "heal"], 81: [2, "heal"], 2998: [3, "heal"], 2999: [4, "heal"], 3002: [-1, "heal"],
};
const SUMMON_ACTIONS = new Set([180, 181, 1008, 1011]);
/** Effets qui lancent un autre sort (diceNum = id du sous-sort, diceSide = grade) : lancer de sort, piège, glyphes, rune. */
const SUBSPELL_ACTIONS = new Set([1160, 2160, 2960, 400, 401, 402, 1165, 2022]);
/** « +X dégâts de base » d'un sort (diceNum = sort, value = X). */
const SPELL_BASE_BOOST = 293;
/** Lancers de sous-sort suivis pour retrouver un bonus de dégâts (792 : sous-sort lancé sur le lanceur). */
const SELF_CAST_ACTIONS = new Set([...SUBSPELL_ACTIONS, 792]);
/** Masque qui exige un état (sur la cible ou, avec `*`, sur le lanceur). */
const POSITIVE_STATE = /(^|,)\*?E\d+/;
/**
 * Sorts dont les lignes de plusieurs éléments (mêmes dés) sont des alternatives et non des coups cumulés :
 * "best" = élément choisi par le joueur (une ligne dans le meilleur élément), "random" = élément tiré au hasard
 * (chaque élément pondéré 1/k), "skip" = dégâts indirects d'une mécanique (non comptés comme attaque).
 * Les autres sorts multi-éléments (Défiance, Glas, Appui, Embuscade…) frappent bien dans chaque élément.
 */
const ALT_ELEMENTS: Record<number, "best" | "random" | "skip"> = {
  25802: "skip", // Mot Alchimique : la Fiole n'occasionne des dommages qu'une fois remplie puis détruite
  13670: "best", // Runification : élément de la rune
  13724: "best", // Surcharge Runique : élément des runes
  13710: "best", // Manifestation : élément de la rune déclenchée
  29785: "random", // Bluff : selon les cartes tirées
  12853: "random", // Rekop : selon la main
};

/** Applique ALT_ELEMENTS : regroupe les lignes de même type / déclencheur / état et aux mêmes dés. */
function mergeAlternatives(lines: SpellLine[], mode: "best" | "random" | "skip" | undefined): SpellLine[] {
  if (!mode) return lines;
  if (mode === "skip") return [];
  const groups = new Map<string, SpellLine[]>();
  for (const l of lines) {
    const k = l.elem < 0 ? `x${groups.size}` : `${l.kind}|${l.trig}|${l.state ?? ""}|${l.min}|${l.max}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  return [...groups.values()].flatMap((g) => {
    if (g.length < 2) return g;
    if (mode === "best") return [{ ...g[0], elem: -1 as LineElem }];
    return g.map((l) => ({ ...l, p: (l.p ?? 1) / g.length }));
  });
}

/** Bits de SpellLevel.m_flags, déduits des données (portée modifiable : Crâ oui, Iop corps-à-corps non). */
const FLAG_RANGE_BOOSTABLE = 1 << 6;

/**
 * Bit d'EffectInstance.m_flags des lignes « affichage seulement » : le jeu les montre dans l'infobulle mais
 * l'effet réel passe par un sous-sort (ex. la zone de Vacarme sur un Feu Follet, la zone de Cryothérapie à la
 * perte de l'état). Les compter doublerait le sort.
 */
const FLAG_CLIENT_ONLY = 1 << 4;

interface RawSpellEffect {
  actionId: number;
  diceNum: number;
  diceSide: number;
  targetMask: string;
  triggers: string;
  /** Probabilité (%) que la ligne s'applique, 0 si toujours. */
  random: number;
  m_flags: number;
  value: number;
  /** Tours de l'effet : -1 = tout le combat, 0 = le lancer en cours. */
  duration: number;
  delay: number;
}


/**
 * Filtres du masque de cible qu'une cible standard (joueur allié, monstre ennemi, sans bouclier) ne remplit pas :
 * P invocation, PB avec bouclier, F<id> / *F<id> cible ou lanceur = tel monstre. Les minuscules (p, pb, f<id>)
 * sont les négations, toujours vraies pour elle. Exception : R / r = sort projeté / non projeté dans un portail
 * (Eliotrope : vol de vie du Faisceau, poison de l'Extinction…). L'Eliotrope tape à travers ses portails, donc le
 * tour modélisé passe par un portail : on garde R et on écarte r (sans le bonus de dommages du portail).
 */
const NOT_STANDARD_TARGET = /^(P|PB|r|\*?F\d+)$/;
/** Pseudo-monstre des lignes d'infobulle (Bluff, Noa, Méprise…) : comme FLAG_CLIENT_ONLY. */
const DISPLAY_TARGET = "F50000";
/** Conditions d'état (cible E<id>, lanceur *E<id>) : sorts à mise en place, voir pickLines côté moteur. */
const STATE_TOKEN = /^\*?E\d+$/;
/**
 * Déclencheurs retenus : immédiat (I), début ou fin de tour (TB, TE). Un déclencheur composé (« TE|PD » : fin de
 * tour ou poussée) compte s'il contient l'un d'eux. Les autres (dommages subis, dissipation…) sont réactifs.
 */
function playTrigger(triggers: string): SpellLine["trig"] | undefined {
  const parts = triggers.split("|");
  if (parts.includes("I")) return "I";
  if (parts.includes("TB") || parts.includes("TE")) return "T";
  return undefined;
}

/** Garde les lignes qui touchent un ennemi standard. Renvoie undefined si la ligne ne s'applique pas. */
function spellLine(e: RawSpellEffect, keepDisplay: boolean): SpellLine | undefined {
  const def = SPELL_LINE[e.actionId];
  if (!def) return undefined;
  let tokens = e.targetMask.split(",");
  const display = (e.m_flags & FLAG_CLIENT_ONLY) !== 0 || tokens.includes(DISPLAY_TARGET);
  if (display && !keepDisplay) return undefined;
  tokens = tokens.filter((t) => t !== DISPLAY_TARGET);
  const [elem, kind] = def;
  const target = kind === "heal" ? /^[ag*]$/ : /^[AML*]$/;
  if (!tokens.some((t) => target.test(t)) || tokens.some((t) => NOT_STANDARD_TARGET.test(t))) return undefined;
  const trig = playTrigger(e.triggers);
  if (!trig) return undefined;
  const min = e.diceNum;
  const max = Math.max(e.diceNum, e.diceSide);
  const line: SpellLine = { elem, kind, min, max, trig };
  if (e.random > 0) line.p = e.random / 100;
  const state = tokens.filter((t) => STATE_TOKEN.test(t));
  if (state.length) line.state = state.join(",");
  return line;
}

function buildClasses(): ClassData[] {
  const fr: Record<string, string> = readJson("game/fr.json").entries;
  const breeds = gameRows("breeds");
  const variants = gameRows("spell_variants");
  const spells = new Map(gameRows("spells").map((s: any) => [s.id, s]));
  const levels = new Map(gameRows("spell_levels").map((s: any) => [s.id, s]));
  const monsters = new Map(gameRows("monsters").map((m: any) => [m.id, m]));

  const costs = (x: any): [number, number][] => arr<any>(x).map((v) => arr<number>(v.values) as [number, number]);

  /**
   * Lignes d'un sort, y compris celles des sous-sorts qu'il lance (pièges, glyphes, runes, sorts déclenchés).
   * Les lignes d'affichage ne sont gardées que pour les sorts à élément au choix, dont elles sont la seule trace.
   */
  const collectLines = (effects: RawSpellEffect[], depth: number, keepDisplay: boolean): SpellLine[] => {
    const out: SpellLine[] = [];
    for (const e of effects) {
      const line = spellLine(e, keepDisplay);
      if (line) out.push(line);
      // un sous-sort lancé à la dissipation double celui lancé à la fin de l'état : seuls les déclencheurs de jeu
      if (depth >= 2 || !SUBSPELL_ACTIONS.has(e.actionId) || !playTrigger(e.triggers)) continue;
      const sub = spells.get(e.diceNum);
      if (!sub) continue;
      const ids = arr<number>(sub.spellLevels);
      const lv = levels.get(ids[Math.min(ids.length - 1, Math.max(0, e.diceSide - 1))]);
      if (!lv) continue;
      // sous-sort lancé sur une invocation ou un monstre précis : effet à mise en place, traité comme un état
      const state = e.targetMask.split(",").filter((t) => /^\*?[EF]\d+$/.test(t) || t === "P").join(",");
      for (const l of collectLines(arr<RawSpellEffect>(lv.effects), depth + 1, keepDisplay)) {
        if (state) l.state = l.state ? `${state},${l.state}` : state;
        out.push(l);
      }
    }
    return out;
  };

  /** Un sous-sort lancé sur le lanceur sans état requis (`e` = n'a pas l'état) donne-t-il un bonus au sort ? */
  const boostReachable = (effects: RawSpellEffect[], spellId: number, depth: number): boolean =>
    effects.some((e) => {
      if (e.actionId === SPELL_BASE_BOOST) return e.diceNum === spellId && (e.m_flags & FLAG_CLIENT_ONLY) === 0 && !POSITIVE_STATE.test(e.targetMask);
      if (depth >= 3 || !SELF_CAST_ACTIONS.has(e.actionId) || POSITIVE_STATE.test(e.targetMask)) return false;
      const lv = levels.get(arr<number>(spells.get(e.diceNum)?.spellLevels)[Math.max(0, e.diceSide - 1)]);
      return !!lv && boostReachable(arr<RawSpellEffect>(lv.effects), spellId, depth + 1);
    });

  /**
   * Bonus de dégâts de base que le sort se donne à chaque lancer, sans condition (lanceur seul, sans état) :
   * « augmentés après chaque lancer » ou « à la récupération du sort ». Une ligne d'affichage ne compte que si le
   * mécanisme réel (sous-sorts) l'applique aussi sans état requis : Fureur oui, Horloge (cible Téléfrag) non. Les
   * bonus d'un seul lancer (durée 0) et de tout le combat (durée -1) comptent des entités (« pour chaque ennemi
   * dans la zone », bombes, arbres…) : la situation n'est pas modélisée, on les ignore.
   */
  const selfBoosts = (effects: RawSpellEffect[], spellId: number): SpellBoost[] =>
    effects
      .filter((e) => e.actionId === SPELL_BASE_BOOST && e.diceNum === spellId && /^[Cc]$/.test(e.targetMask) && e.triggers === "I" && e.duration > 0)
      .filter((e) => (e.m_flags & FLAG_CLIENT_ONLY) === 0 || boostReachable(effects, spellId, 0))
      .map((e) => ({ value: e.value, duration: e.duration, delay: e.delay }));

  const classes: ClassData[] = [];
  for (const b of breeds.sort((a: any, b: any) => a.sortIndex - b.sortIndex)) {
    const pairs: number[][] = variants.filter((v: any) => v.breedId === b.id).map((v: any) => arr<number>(v.spellIds));
    const inPairs = new Set(pairs.flat());
    for (const id of arr<number>(b.breedSpellsId)) if (!inPairs.has(id)) pairs.push([id]);

    const out: Spell[] = [];
    pairs.forEach((ids, pair) => {
      for (const id of ids) {
        const s = spells.get(id);
        if (!s) continue;
        const grades: SpellGrade[] = [];
        for (const lid of arr<number>(s.spellLevels)) {
          const lv = levels.get(lid);
          if (!lv) continue;
          const effects = arr<RawSpellEffect>(lv.effects);
          const crits = arr<RawSpellEffect>(lv.criticalEffect);
          const g: SpellGrade = {
            level: lv.minPlayerLevel,
            ap: lv.apCost,
            minRange: lv.minRange,
            range: lv.range,
            boostable: (lv.m_flags & FLAG_RANGE_BOOSTABLE) !== 0,
            crit: crits.length ? lv.criticalHitProbability : 0,
            perTurn: lv.maxCastPerTurn,
            perTarget: lv.maxCastPerTarget,
            interval: lv.minCastInterval,
            initialCooldown: lv.initialCooldown,
            lines: mergeAlternatives(collectLines(effects, 0, id in ALT_ELEMENTS), ALT_ELEMENTS[id]),
            critLines: mergeAlternatives(collectLines(crits, 0, id in ALT_ELEMENTS), ALT_ELEMENTS[id]),
          };
          const summons = effects
            .filter((e) => SUMMON_ACTIONS.has(e.actionId))
            .map((e) => ({ monster: e.diceNum, cost: monsters.get(e.diceNum)?.summonCost ?? 1 }));
          if (summons.length) g.summons = summons;
          const boosts = selfBoosts(effects, id);
          if (boosts.length) {
            g.boosts = boosts;
            g.maxStack = lv.maxStack;
          }
          grades.push(g);
        }
        grades.sort((a, b) => a.level - b.level);
        out.push({ id, name: fr[s.nameId] ?? `#${id}`, pair, grades });
      }
    });
    classes.push({
      id: b.id,
      name: fr[b.shortNameId],
      statCosts: {
        vita: costs(b.statsPointsForVitality),
        sagesse: costs(b.statsPointsForWisdom),
        force: costs(b.statsPointsForStrength),
        intel: costs(b.statsPointsForIntelligence),
        chance: costs(b.statsPointsForChance),
        agi: costs(b.statsPointsForAgility),
      },
      spells: out,
    });
  }
  console.log(`classes : ${classes.map((c) => `${c.name} (${c.spells.length})`).join(", ")}`);
  return classes;
}

// ---------------------------------------------------------------- monstre de référence

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Résistances médianes des monstres par tranche de 10 niveaux (fenêtre ±10). */
function buildMonsterRefs(): MonsterRef[] {
  const grades = gameRows("monsters").flatMap((m: any) => arr<any>(m.grades));
  const refs: MonsterRef[] = [];
  for (let level = 10; level <= 200; level += 10) {
    const g = grades.filter((x) => x.level >= level - 10 && x.level <= level + 10 && x.lifePoints > 0);
    const keys = ["Neutral", "Earth", "Fire", "Water", "Air"];
    refs.push({
      level,
      res: keys.map((k) => median(g.map((x) => x[`reduction${k}`]))),
      resFlat: keys.map((k) => median(g.map((x) => x[`reduction${k}Flat`]))),
      hp: median(g.map((x) => x.lifePoints)),
    });
  }
  return refs;
}

// ----------------------------------------------------------------

function main() {
  mkdirSync(OUT, { recursive: true });
  const version = readJson("version.json");
  const items = buildItems();
  const sets = buildSets(items);
  const classes = buildClasses();
  const monsters = buildMonsterRefs();
  const meta = { version: version.version, update_stamp: version.update_stamp, built_at: new Date().toISOString() };
  const write = (name: string, data: unknown) => {
    const text = JSON.stringify(data);
    writeFileSync(join(OUT, name), text);
    console.log(`→ public/data/${name} (${Math.round(text.length / 1024)} ko)`);
  };
  write("meta.json", meta);
  write("items.json", items);
  write("sets.json", sets);
  write("classes.json", classes);
  write("monsters.json", monsters);
}

main();
