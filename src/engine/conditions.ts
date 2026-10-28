import type { Cmp, Cond } from "./types";

export interface CondContext {
  totals: ArrayLike<number>;
  level: number;
  setBonuses: number;
}

const compare = (a: number, cmp: Cmp, b: number) => (cmp === "<" ? a < b : cmp === ">" ? a > b : a === b);

/** Évalue l'arbre de conditions d'un item sur les totaux du stuff. */
export function evalCond(cond: Cond, ctx: CondContext): boolean {
  if ("op" in cond) {
    return cond.op === "and" ? cond.c.every((c) => evalCond(c, ctx)) : cond.c.some((c) => evalCond(c, ctx));
  }
  if ("stat" in cond) return compare(ctx.totals[cond.stat], cond.cmp, cond.v);
  if ("sets" in cond) return compare(ctx.setBonuses, cond.cmp, cond.v);
  return compare(ctx.level, cond.cmp, cond.v);
}

/** Texte lisible d'une condition (affichage). */
export function condToText(cond: Cond, statLabel: (stat: number) => string): string {
  if ("op" in cond) return cond.c.map((c) => condToText(c, statLabel)).join(cond.op === "and" ? " et " : " ou ");
  const what = "stat" in cond ? statLabel(cond.stat) : "sets" in cond ? "Bonus de panoplies" : "Niveau";
  return `${what} ${cond.cmp} ${cond.v}`;
}
