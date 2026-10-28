// Application : formulaire à gauche, résultats à droite ; onglet de calibration.

import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildResult, SolveResult } from "../engine/solver";
import { ROLES, classProfile, defaultTargets } from "../engine/score";
import { DEFAULT_RULES } from "../engine/rules";
import { voieName } from "../engine/voies";
import { type Config, loadCalibration, loadConfig, saveCalibration, saveConfig, toRequest } from "./config";
import { SolverPool, type ReadyInfo, partsFor } from "./pool";
import { Form } from "./Form";
import { Results } from "./Results";
import { BuildView } from "./BuildView";
import { Calibration } from "./Calibration";
import type { Pick } from "./ParetoChart";
import { buildText } from "./format";
import { Compare } from "./Compare";
import { type CompareState, MAX_STUFFS, freeSlot, loadCompare, saveCompare } from "./compareState";

interface Run {
  fraction: number;
  message: string;
  started: number;
}

interface Done {
  result: SolveResult;
  /** Demande telle qu'elle a été calculée (pour savoir si le formulaire a changé depuis). */
  key: string;
  title: string;
  cls: string;
  level: number;
  /** Réglages du calcul (pour envoyer un stuff au comparateur dans le même contexte). */
  config: Config;
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <defs>
        <linearGradient id="egg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe6a3" />
          <stop offset="0.45" stopColor="#e3ac45" />
          <stop offset="1" stopColor="#8a5a17" />
        </linearGradient>
      </defs>
      <path d="M32 5C20 5 11 24 11 37c0 13 9.5 22 21 22s21-9 21-22C53 24 44 5 32 5Z" fill="url(#egg)" />
      <path d="M32 5 24 22l8 9 8-9Z M11 37l13-15 8 9-8 12Z M53 37 40 22l-8 9 8 12Z M24 43l8-12 8 12-8 16Z" fill="#000" opacity="0.12" />
      <path d="M22 18c-3 5-5 11-5 16" stroke="#fff6dc" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
    </svg>
  );
}

export function App() {
  const poolRef = useRef<SolverPool | null>(null);
  const [info, setInfo] = useState<ReadyInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>(loadConfig);
  const [calibration, setCalibration] = useState(loadCalibration);
  const [tab, setTab] = useState<"opti" | "compare" | "calib">("opti");
  const [compare, setCompare] = useState<CompareState>(loadCompare);
  const [run, setRun] = useState<Run | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pick>({ kind: "front", i: 0 });
  const [now, setNow] = useState(0);

  const startPool = () => {
    const pool = new SolverPool();
    poolRef.current = pool;
    pool.ready.then(setInfo, (e: Error) => setLoadError(e.message));
    return pool;
  };

  useEffect(() => {
    const pool = startPool();
    return () => pool.terminate();
  }, []);
  useEffect(() => saveConfig(config), [config]);
  useEffect(() => saveCalibration(calibration), [calibration]);
  useEffect(() => saveCompare(compare), [compare]);
  useEffect(() => {
    if (!run) return;
    const t = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(t);
  }, [run]);

  const update = (patch: Partial<Config>) => setConfig((c) => ({ ...c, ...patch }));
  const cls = info?.classes.find((c) => c.id === config.classId);
  const defaults = useMemo(() => (cls ? defaultTargets(config.level, classProfile(cls.name)) : null), [cls, config.level]);
  const requestKey = JSON.stringify([toRequest(config, calibration), config.deep]);

  const solve = async () => {
    const pool = poolRef.current;
    if (!pool || !cls) return;
    const req = toRequest(config, calibration);
    const title = `${cls.name} niveau ${config.level} · ${ROLES[config.role].label}${config.voie.length ? ` · ${voieName(config.voie)}` : ""}`;
    setError(null);
    setRun({ fraction: 0, message: "démarrage", started: performance.now() });
    try {
      const result = await pool.solve(req, partsFor(pool.size, config.deep), (fraction, message) =>
        setRun((r) => r && { ...r, fraction, message }),
      );
      setDone({ result, key: requestKey, title, cls: cls.name, level: config.level, config });
      setSelected({ kind: "front", i: result.highlighted });
    } catch (e) {
      if (poolRef.current === pool) setError((e as Error).message);
    } finally {
      if (poolRef.current === pool) setRun(null);
    }
  };

  /** Envoie un stuff de l'optimiseur au comparateur, avec le contexte du calcul ; remplace le dernier stuff si c'est plein. */
  const sendToCompare = (b: BuildResult, d: Done) => {
    setCompare((c) => {
      let stuffs = c.stuffs.filter((s) => s.items.some((x) => x != null));
      if (stuffs.length >= MAX_STUFFS) stuffs = stuffs.filter((s) => s.slot !== stuffs.filter((x) => x.slot !== c.ref).at(-1)!.slot);
      const slot = freeSlot(stuffs);
      const stuff = { slot, name: `Optimiseur · ${Math.round(b.weights.dmg * 100)} % dégâts`, items: b.items.map((it) => it?.id ?? null), alloc: { ...b.alloc }, exo: { ...d.config.exo } };
      stuffs = [...stuffs, stuff];
      const { classId, level, role, voie, scrolls } = d.config;
      return { classId, level, role, voie, scrolls, stuffs, ref: stuffs.some((s) => s.slot === c.ref) ? c.ref : slot };
    });
    setTab("compare");
    window.scrollTo({ top: 0 });
  };

  const cancel = () => {
    poolRef.current?.terminate();
    setRun(null);
    startPool();
  };

  const r = done?.result;
  const build = r && (selected.kind === "front" ? r.builds[selected.i] : r.voieBuilds[selected.i]?.build);
  const stale = done && done.key !== requestKey;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <h1>Optimiseur de stuff</h1>
            <span className="subtitle">Dofus 3 · {info ? `données ${info.meta.version}` : "chargement des données…"}</span>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "opti"} className={tab === "opti" ? "on" : ""} onClick={() => setTab("opti")}>
            Optimiseur
          </button>
          <button role="tab" aria-selected={tab === "compare"} className={tab === "compare" ? "on" : ""} onClick={() => setTab("compare")}>
            Comparateur
          </button>
          <button role="tab" aria-selected={tab === "calib"} className={tab === "calib" ? "on" : ""} onClick={() => setTab("calib")}>
            Calibration
            {Object.keys(calibration.rules).length > 0 && <span className="badge">{Object.keys(calibration.rules).length}</span>}
          </button>
        </nav>
      </header>

      {loadError && (
        <div className="banner error" role="alert">
          Impossible de charger les données : {loadError}
        </div>
      )}

      {tab === "calib" ? (
        <main className="page">
          <Calibration calibration={calibration} onChange={setCalibration} />
        </main>
      ) : tab === "compare" ? (
        <main className="page wide">
          {info ? (
            <Compare state={compare} setState={setCompare} pool={poolRef.current} info={info} calibration={calibration} />
          ) : (
            <div className="panel form loading">
              <div className="spinner" aria-hidden />
              <p>Chargement des items et des sorts…</p>
            </div>
          )}
        </main>
      ) : (
        <main className="layout">
          <aside>
            {info ? (
              <Form
                config={config}
                update={update}
                classes={info.classes}
                items={info.items}
                defaults={defaults}
                running={!!run}
                onRun={solve}
                onCancel={cancel}
              />
            ) : (
              <div className="panel form loading">
                <div className="spinner" aria-hidden />
                <p>Chargement des items et des sorts…</p>
              </div>
            )}
          </aside>

          <div className="main-col">
            {error && (
              <div className="banner error" role="alert">
                Le calcul a échoué : {error}
              </div>
            )}

            {run && (
              <div className="progress card" aria-live="polite">
                <div className="progress-head">
                  <span>
                    Recherche du meilleur stuff… <em>{run.message}</em>
                  </span>
                  <span className="muted">{Math.max(0, (now - run.started) / 1000).toFixed(0)} s</span>
                </div>
                <div className="progress-bar">
                  <span style={{ width: `${Math.round(run.fraction * 100)}%` }} />
                </div>
                <small className="muted">
                  {poolRef.current ? `${partsFor(poolRef.current.size, config.deep)} calculs en parallèle` : ""} · compte 10 à 30 secondes
                </small>
              </div>
            )}

            {!r && !run && <Welcome hasClass={config.classId != null} />}

            {r && build && done && (
              <div className={run ? "dimmed" : ""}>
                {stale && !run && (
                  <div className="banner stale">
                    <span>Les réglages ont changé depuis ce calcul.</span>
                    <button type="button" className="run small" onClick={solve} disabled={!cls}>
                      Relancer
                    </button>
                  </div>
                )}
                <Results result={r} selected={selected} onSelect={setSelected} title={done.title} />
                <BuildView
                  build={build}
                  reference={r.builds[r.highlighted]}
                  rules={r.rules ?? DEFAULT_RULES}
                  locked={config.locked}
                  banned={config.banned}
                  onLock={(slot, id) => update({ locked: config.locked.map((x, i) => (i === slot ? id : x)) })}
                  onBan={(id) => update({ banned: [...config.banned, id] })}
                  onCopy={() => navigator.clipboard?.writeText(buildText(build, { cls: done.cls, level: done.level, version: info?.meta.version ?? "", voie: r.voie }))}
                  onCompare={() => sendToCompare(build, done)}
                />
              </div>
            )}
          </div>
        </main>
      )}

      <footer className="footer">
        Données dofusdude · calcul local dans ton navigateur · jets parfaits, monstre de référence du niveau
      </footer>
    </div>
  );
}

function Welcome({ hasClass }: { hasClass: boolean }) {
  return (
    <section className="welcome">
      <Logo size={88} />
      <h2>Le meilleur stuff, calculé et non deviné</h2>
      <p>
        L'optimiseur simule tes vrais sorts contre un monstre de ton niveau, puis cherche parmi tous les items, panoplies et trophées le stuff
        qui maximise tes dégâts et ta survie.
      </p>
      <ol className="welcome-steps">
        <li className={hasClass ? "done" : ""}>
          <strong>Choisis ta classe et ton niveau</strong>
          <span>Le rôle règle l'équilibre entre dégâts et survie.</span>
        </li>
        <li>
          <strong>Lance l'optimisation</strong>
          <span>Plusieurs stuffs, du plus offensif au plus défensif.</span>
        </li>
        <li>
          <strong>Affine</strong>
          <span>Impose ou bannis des items, puis relance.</span>
        </li>
      </ol>
    </section>
  );
}
