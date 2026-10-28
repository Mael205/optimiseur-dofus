// Web Worker : charge les données une fois, puis exécute à la demande les tâches du calcul parallèle
// (parallel.ts) sans bloquer l'interface. L'interface en lance plusieurs (src/ui/pool.ts).
//   entrée  : { type: "task", id, task }
//   sortie  : "ready" (version, classes, index des items), "progress", "result", "error"

import type { ClassData, DataMeta, GameData, Item, ItemSet } from "./types";
import { type Task, type TaskResult, runTask } from "./parallel";

export type ItemIndex = Pick<Item, "id" | "name" | "slot" | "type" | "level" | "icon" | "set">;

export type WorkerIn = { type: "task"; id: number; task: Task };
export type WorkerOut =
  | { type: "ready"; meta: DataMeta; classes: { id: number; name: string }[]; items: ItemIndex[]; sets: { id: number; name: string }[] }
  | { type: "progress"; id: number; fraction: number; message: string }
  | { type: "result"; id: number; result: TaskResult }
  | { type: "error"; id?: number; message: string };

const post = (m: WorkerOut) => self.postMessage(m);

async function load<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`);
  if (!res.ok) throw new Error(`données manquantes : ${name}.json (${res.status}), lancer « npm run data »`);
  return res.json() as Promise<T>;
}

const ready: Promise<GameData> = (async () => {
  const [meta, items, sets, classes, monsters] = await Promise.all([
    load<DataMeta>("meta"),
    load<Item[]>("items"),
    load<ItemSet[]>("sets"),
    load<ClassData[]>("classes"),
    load<GameData["monsters"]>("monsters"),
  ]);
  return { meta, items, sets, classes, monsters };
})();

ready.then(
  (d) =>
    post({
      type: "ready",
      meta: d.meta,
      classes: d.classes.map((c) => ({ id: c.id, name: c.name })),
      items: d.items.map(({ id, name, slot, type, level, icon, set }) => ({ id, name, slot, type, level, icon, set })),
      sets: d.sets.map((s) => ({ id: s.id, name: s.name })),
    }),
  (e) => post({ type: "error", message: String(e?.message ?? e) }),
);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type !== "task") return;
  try {
    const data = await ready;
    let last = 0;
    const result = runTask(data, msg.task, (fraction, message) => {
      const now = performance.now();
      if (now - last < 50 && fraction < 1) return;
      last = now;
      post({ type: "progress", id: msg.id, fraction, message });
    });
    post({ type: "result", id: msg.id, result });
  } catch (err) {
    post({ type: "error", id: msg.id, message: String((err as Error)?.message ?? err) });
  }
};
