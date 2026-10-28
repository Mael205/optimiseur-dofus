// Pool de Web Workers persistants : chacun charge les données une fois, puis exécute les tâches du calcul
// parallèle (parallel.ts). Le premier worker prêt fournit l'index des items à l'interface.

import { type Exec, type Task, type TaskResult, solveParallel } from "../engine/parallel";
import type { BuildResult, Progress, SolveRequest, SolveResult, StuffInput } from "../engine/solver";
import type { WorkerIn, WorkerOut } from "../engine/worker";

export type ReadyInfo = Extract<WorkerOut, { type: "ready" }>;

interface Pending {
  resolve: (r: TaskResult) => void;
  reject: (e: Error) => void;
  progress: (fraction: number, message: string) => void;
}

/** Workers du pool : un cœur laissé libre pour l'interface, 14 au plus. */
export const defaultPoolSize = () => Math.max(1, Math.min(14, (navigator.hardwareConcurrency || 4) - 1));
/**
 * Parts d'un calcul. Normal : 8 au plus, le plus rapide (au-delà, les cœurs logiques se partagent les cœurs
 * physiques). Approfondi : 14 parts, plus de chaînes de recherche, parfois un stuff un peu meilleur, ~1,5× plus long.
 */
export const partsFor = (poolSize: number, deep: boolean) => (deep ? Math.max(poolSize, 14) : Math.min(8, poolSize));

export class SolverPool {
  readonly size: number;
  readonly ready: Promise<ReadyInfo>;
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: (() => void)[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(size = defaultPoolSize()) {
    this.size = size;
    let onReady!: (r: ReadyInfo) => void;
    let onFail!: (e: Error) => void;
    this.ready = new Promise((res, rej) => ((onReady = res), (onFail = rej)));
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
      this.workers.push(w);
      w.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === "ready") {
          onReady(m);
          this.release(w);
          return;
        }
        const p = m.id == null ? undefined : this.pending.get(m.id);
        if (m.type === "error" && !p) onFail(new Error(m.message));
        if (!p) return;
        if (m.type === "progress") p.progress(m.fraction, m.message);
        else {
          this.pending.delete(m.id!);
          this.release(w);
          if (m.type === "result") p.resolve(m.result);
          else p.reject(new Error(m.message));
        }
      };
      w.onerror = (e) => onFail(new Error(e.message || "le worker n'a pas pu démarrer"));
    }
  }

  private release(w: Worker) {
    this.idle.push(w);
    this.queue.shift()?.();
  }

  private exec: Exec = (task: Task, progress) =>
    new Promise((resolve, reject) => {
      const go = () => {
        const w = this.idle.pop()!;
        const id = this.nextId++;
        this.pending.set(id, { resolve, reject, progress });
        w.postMessage({ type: "task", id, task } satisfies WorkerIn);
      };
      if (this.idle.length) go();
      else this.queue.push(go);
    });

  async solve(req: SolveRequest, parts: number, progress?: Progress): Promise<SolveResult> {
    await this.ready;
    return solveParallel(req, parts, this.exec, progress);
  }

  /** Évalue un stuff donné (comparateur), sur le premier worker libre. */
  async evaluate(req: SolveRequest, stuff: StuffInput): Promise<BuildResult> {
    await this.ready;
    return this.exec({ kind: "eval", req, stuff }, () => {}) as Promise<BuildResult>;
  }

  /** Arrête tous les workers (annulation d'un calcul) : les tâches en cours sont rejetées. */
  terminate() {
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error("annulé"));
    this.pending.clear();
  }
}
