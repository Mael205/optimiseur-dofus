// Calcul parallèle sur plusieurs workers (Web Workers dans le navigateur, worker_threads pour le banc) :
//   1. stuff du rôle : chaque worker fait sa tranche des chaînes de recherche itérée, on garde le meilleur ;
//   2. front de Pareto : chaque pondération est calculée à part, sur ses propres workers, depuis le meilleur
//      stuff de chaque régime trouvé en 1 (au lieu de glisser de proche en proche, qui est séquentiel) ;
//   3. trous du front : stuffs intermédiaires sous plancher de PV effectifs (voir Solver.solveGap).
// Indépendant de l'environnement : `exec` envoie une tâche à un worker libre, qui appelle `runTask`.

import type { GameData } from "./types";
import type { Weights } from "./score";
import type { Voie } from "./voies";
import {
  type BuildResult, type FrontGap, type Progress, type RolePhaseResult, type SolveRequest, type SolveResult, type StuffInput, type StuffRef, Solver,
  frontGaps,
  frontWeights,
  paretoFilter,
} from "./solver";

export type Task =
  | { kind: "role"; req: SolveRequest }
  | { kind: "point"; req: SolveRequest; dmg: number; starts: StuffRef[]; mainCarac: Voie }
  | { kind: "gap"; req: SolveRequest; gap: FrontGap; mainCarac: Voie }
  | { kind: "eval"; req: SolveRequest; stuff: StuffInput };
export type TaskResult = RolePhaseResult | BuildResult;

/** Exécute une tâche (côté worker). */
export function runTask(data: GameData, task: Task, progress?: Progress): TaskResult {
  const sv = new Solver(data, task.req);
  if (task.kind === "eval") return sv.evaluateStuff(task.stuff);
  if (task.kind === "gap") return sv.solveGap(task.gap, task.mainCarac);
  return task.kind === "role" ? sv.solveRole(progress) : sv.solvePoint(task.dmg, task.starts, task.mainCarac);
}

/** Envoie une tâche à un worker ; `progress` reçoit l'avancement de la tâche (0..1). */
export type Exec = (task: Task, progress: (fraction: number, message: string) => void) => Promise<TaskResult>;

/** Part de la barre de progression réservée à la phase 1, et fin de la phase 2. */
const ROLE_SHARE = 0.4;
const POINTS_END = 0.85;

const maxBy = <T>(list: T[], score: (x: T) => number) => list.reduce((a, b) => (score(b) > score(a) ? b : a));

export async function solveParallel(req: SolveRequest, workers: number, exec: Exec, progress?: Progress): Promise<SolveResult> {
  const t0 = performance.now();
  const n = Math.max(1, workers);
  const role: Weights = req.weights;

  // 1. Stuff du rôle.
  const roleProgress = new Array<number>(n).fill(0);
  const roles = (await Promise.all(
    Array.from({ length: n }, (_, index) =>
      exec({ kind: "role", req: { ...req, part: { index, count: n } } }, (f, msg) => {
        roleProgress[index] = f;
        progress?.((ROLE_SHARE * roleProgress.reduce((a, b) => a + b, 0)) / n, msg);
      }),
    ),
  )) as RolePhaseResult[];
  const best = maxBy(roles, (r) => r.role.evaluation.score);
  const starts = best.regimes.map((_, r) => maxBy(roles.map((x) => x.regimes[r]), (s) => s.score));
  const voieBuilds = best.voieBuilds.map(({ voie }) =>
    maxBy(roles.map((x) => x.voieBuilds.find((v) => v.voie === voie)!), (v) => v.build.evaluation.score),
  );

  // 2. Points du front : les workers sont répartis entre les pondérations (chacune au moins un).
  const points = frontWeights(role).filter((w) => w !== role.dmg);
  const tasks: Task[] = points.flatMap((dmg, j) => {
    const count = Math.max(1, Math.floor(n / points.length) + (j < n % points.length ? 1 : 0));
    return Array.from({ length: count }, (_, index): Task => ({
      kind: "point", req: { ...req, part: { index, count } }, dmg, starts, mainCarac: best.mainCarac,
    }));
  });
  let finished = 0;
  const results = (await Promise.all(
    tasks.map((task) =>
      exec(task, () => {}).then((r) => {
        progress?.(ROLE_SHARE + ((POINTS_END - ROLE_SHARE) * ++finished) / tasks.length, `pondération dégâts ${Math.round((task as { dmg: number }).dmg * 100)} %`);
        return r;
      }),
    ),
  )) as BuildResult[];
  const pointBuilds = points.map((dmg) => maxBy(results.filter((b) => b.weights.dmg === dmg), (b) => b.evaluation.score));

  let builds = paretoFilter([best.role, ...pointBuilds], best.role);

  // 3. Trous du front : les workers sont répartis entre les trous.
  const gaps = frontGaps(builds);
  if (gaps.length) {
    const gapTasks: Task[] = gaps.flatMap((gap, j) => {
      const count = Math.max(1, Math.floor(n / gaps.length) + (j < n % gaps.length ? 1 : 0));
      return Array.from({ length: count }, (_, index): Task => ({
        kind: "gap", req: { ...req, part: { index, count } }, gap, mainCarac: best.mainCarac,
      }));
    });
    let gapsDone = 0;
    const gapResults = (await Promise.all(
      gapTasks.map((task) =>
        exec(task, () => {}).then((r) => {
          progress?.(POINTS_END + ((1 - POINTS_END) * ++gapsDone) / gapTasks.length, "stuffs intermédiaires");
          return r;
        }),
      ),
    )) as BuildResult[];
    const gapBuilds = gaps.map((g) => maxBy(gapResults.filter((b) => b.weights.dmg === g.label), (b) => b.evaluation.score));
    builds = paretoFilter([best.role, ...pointBuilds, ...gapBuilds], best.role);
  }
  return {
    builds,
    highlighted: builds.indexOf(best.role),
    targets: best.targets,
    rules: best.rules,
    voies: best.voies,
    voieBuilds,
    voie: req.voie?.length ? [...req.voie] : undefined,
    elapsedMs: performance.now() - t0,
  };
}
