// Comparateur de stuffs : jusqu'à trois stuffs côte à côte, évalués tels quels (mêmes classe, niveau, rôle, éléments)
// par le moteur de l'optimiseur. Une colonne par stuff, une ligne par emplacement, résultat ou stat.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "../engine/types";
import type { BuildResult } from "../engine/solver";
import { DEFAULT_RULES } from "../engine/rules";
import { ROLES, type Role } from "../engine/score";
import { BASE_CARACS, ELEMENTS, STAT_LABELS, S, type StatKey } from "../engine/statIds";
import { type Allocation, SLOTS, emptyAlloc } from "../engine/stats";
import { VOIES, VOIE_LABEL, type Voie } from "../engine/voies";
import type { ReadyInfo, SolverPool } from "./pool";
import type { Calibration } from "./config";
import {
  type CompareState, type CompareStuff, MAX_STUFFS, STUFF_COLOR, STUFF_LETTER, compareRequest, emptyStuff, freeSlot, parseItemList,
  stuffInput,
} from "./compareState";
import { ELEM_COLOR, VOIE_ELEM, buildText, fmt, pct, slotLabel } from "./format";
import { BuildView, Delta, ItemCard } from "./BuildView";
import { ItemIcon, ItemSelect } from "./ItemSelect";

interface Props {
  state: CompareState;
  setState: React.Dispatch<React.SetStateAction<CompareState>>;
  pool: SolverPool | null;
  info: ReadyInfo;
  calibration: Calibration;
}

type Outcome = BuildResult | { error: string };
const isBuild = (o: Outcome | undefined): o is BuildResult => !!o && "evaluation" in o;

const EQUIP = SLOTS.map((_, i) => i).filter((i) => SLOTS[i] !== "dofus");
const DOFUS = SLOTS.map((_, i) => i).filter((i) => SLOTS[i] === "dofus");
const CARAC_SHORT: Record<string, string> = { vita: "Vita", sagesse: "Sag", force: "Force", intel: "Intel", chance: "Chance", agi: "Agi" };

const STAT_ROWS: StatKey[][] = [
  ["pa", "pm", "po", "invo"],
  ["vita", "sagesse", "force", "intel", "chance", "agi", "puissance"],
  ["do", "doNeutre", "doTerre", "doFeu", "doEau", "doAir", "doCrit", "crit", "pctSorts", "pctArmes", "pctMelee", "pctDist", "soin", "doPou"],
  ["rpNeutre", "rpTerre", "rpFeu", "rpEau", "rpAir", "rfNeutre", "rfTerre", "rfFeu", "rfEau", "rfAir", "rpMelee", "rpDist", "rfCrit", "rfPou"],
  ["ini", "prospe", "tacle", "fuite", "esqPA", "esqPM", "retPA", "retPM"],
];

const stuffName = (s: CompareStuff) => s.name.trim() || `Stuff ${STUFF_LETTER[s.slot]}`;
const ratio = (a: number, b: number) => `${a >= b ? "+" : "−"}${pct(Math.abs(a / b - 1), Math.abs(a / b - 1) < 0.1 ? 1 : 0)}`;

export function Compare({ state, setState, pool, info, calibration }: Props) {
  const { stuffs } = state;
  const byId = useMemo(() => new Map(info.items.map((it) => [it.id, it])), [info.items]);
  const cls = info.classes.find((c) => c.id === state.classId);
  const rules = { ...DEFAULT_RULES, ...calibration.rules };
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [importFor, setImportFor] = useState<number | null>(null);
  const [importText, setImportText] = useState("");
  const [importReport, setImportReport] = useState<{ slot: number; found: number; unknown: string[] } | null>(null);
  const [detail, setDetail] = useState(state.ref);
  const [tip, setTip] = useState<{ item: Item; at: DOMRect } | null>(null);

  // ------------------------------------------------------------ évaluation (débounce, cache par demande)
  const [results, setResults] = useState<Record<string, Outcome>>({});
  const inflight = useRef(new Map<string, SolverPool>());
  const currentPool = useRef(pool);
  currentPool.current = pool;
  const keys = stuffs.map((s) => (state.classId == null ? null : JSON.stringify([compareRequest(state, s, calibration), stuffInput(s)])));
  const keysJoined = keys.join("\n");

  useEffect(() => {
    if (!pool) return;
    const todo = stuffs.flatMap((s, i) => {
      const k = keys[i];
      return k && !(k in results) && inflight.current.get(k) !== pool ? [{ s, k }] : [];
    });
    if (!todo.length) return;
    const t = setTimeout(() => {
      for (const { s, k } of todo) {
        inflight.current.set(k, pool);
        pool
          .evaluate(compareRequest(state, s, calibration), stuffInput(s))
          .then(
            (r) => setResults((m) => ({ ...m, [k]: r })),
            (e: Error) => currentPool.current === pool && setResults((m) => ({ ...m, [k]: { error: e.message } })),
          )
          .finally(() => inflight.current.get(k) === pool && inflight.current.delete(k));
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysJoined, pool]);

  // dernier résultat connu de chaque stuff, affiché (atténué) pendant le recalcul
  const lastShown = useRef(new Map<number, BuildResult>());
  const current = keys.map((k) => (k ? results[k] : undefined));
  const shown = stuffs.map((s, i) => {
    const r = current[i];
    if (isBuild(r)) lastShown.current.set(s.slot, r);
    return state.classId == null ? undefined : isBuild(r) ? r : lastShown.current.get(s.slot);
  });
  const pending = stuffs.map((_, i) => state.classId != null && !current[i]);
  const errors = current.map((r) => (r && !isBuild(r) ? r.error : null));
  const refIndex = Math.max(0, stuffs.findIndex((s) => s.slot === state.ref));
  const refBuild = shown[refIndex];

  // ------------------------------------------------------------ modifications
  const setStuff = (slot: number, patch: Partial<CompareStuff> | ((s: CompareStuff) => Partial<CompareStuff>)) =>
    setState((c) => ({ ...c, stuffs: c.stuffs.map((s) => (s.slot === slot ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) } : s)) }));
  const setItem = (slot: number, p: number, id: number | null) => setStuff(slot, (s) => ({ items: s.items.map((x, i) => (i === p ? id : x)) }));
  const addStuff = (from?: CompareStuff) =>
    setState((c) => {
      if (c.stuffs.length >= MAX_STUFFS) return c;
      const slot = freeSlot(c.stuffs);
      const copy = from ? { ...from, slot, name: from.name ? `${from.name} (copie)` : "", items: [...from.items] } : emptyStuff(slot);
      return { ...c, stuffs: [...c.stuffs, copy] };
    });
  const removeStuff = (slot: number) =>
    setState((c) => {
      const rest = c.stuffs.filter((s) => s.slot !== slot);
      return { ...c, stuffs: rest, ref: c.ref === slot ? rest[0].slot : c.ref };
    });
  const excludes = useMemo(() => stuffs.map((s) => new Set(s.items.filter((x): x is number => x != null))), [stuffs]);

  const runImport = () => {
    if (importFor == null) return;
    const { items, unknown } = parseItemList(importText, info.items, state.level);
    setStuff(importFor, { items });
    setImportReport({ slot: importFor, found: items.filter((x) => x != null).length, unknown });
    setImportFor(null);
    setImportText("");
  };

  // ------------------------------------------------------------ cellules
  const showTip = (b: BuildResult | undefined, p: number, id: number, el: HTMLElement) => {
    const it = b?.items[p];
    if (it && it.id === id) setTip({ item: it, at: el.getBoundingClientRect() });
  };

  const slotRow = (p: number) => {
    const ids = stuffs.map((s) => s.items[p]);
    const differs = new Set(ids).size > 1;
    if (onlyDiff && !differs) return null;
    return (
      <tr key={p} className={differs ? "differs" : ""}>
        <th scope="row">{slotLabel(p)}</th>
        {stuffs.map((s, i) => {
          const id = s.items[p];
          const it = id != null ? byId.get(id) : undefined;
          return (
            <td key={s.slot}>
              {id != null ? (
                <div
                  className="cmp-item"
                  tabIndex={0}
                  onMouseEnter={(e) => showTip(shown[i], p, id, e.currentTarget)}
                  onMouseLeave={() => setTip(null)}
                  onFocus={(e) => showTip(shown[i], p, id, e.currentTarget)}
                  onBlur={() => setTip(null)}
                >
                  <ItemIcon item={it} size={30} />
                  <span className="cmp-item-text">
                    <span className="cmp-item-name">{it?.name ?? `#${id}`}</span>
                    <small className={it && it.level > state.level ? "neg" : ""}>niv. {it?.level ?? "?"}</small>
                  </span>
                  <button type="button" className="cmp-x" aria-label={`Retirer ${it?.name ?? ""}`} onClick={() => setItem(s.slot, p, null)}>
                    ×
                  </button>
                </div>
              ) : (
                <ItemSelect
                  items={info.items}
                  slot={SLOTS[p]}
                  maxLevel={state.level}
                  exclude={excludes[i]}
                  placeholder="Ajouter…"
                  onPick={(x) => setItem(s.slot, p, x.id)}
                />
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  const metricRow = (label: string, get: (b: BuildResult) => number, hint?: string) => {
    const vals = shown.map((b) => (b ? get(b) : 0));
    const max = Math.max(1e-9, ...vals);
    return (
      <tr className="metric">
        <th scope="row">
          {label}
          {hint && <small>{hint}</small>}
        </th>
        {stuffs.map((s, i) => {
          const b = shown[i];
          return (
            <td key={s.slot} className={pending[i] ? "pending" : ""}>
              {b ? (
                <>
                  <div className="m-val">
                    <strong>{fmt(vals[i])}</strong>
                    {refBuild && i !== refIndex && <Delta a={vals[i]} b={get(refBuild)} />}
                  </div>
                  <div className="m-bar">
                    <span style={{ width: `${(Math.max(0, vals[i]) / max) * 100}%`, background: STUFF_COLOR[s.slot] }} />
                  </div>
                </>
              ) : (
                <span className="muted">{errors[i] ? "erreur" : "…"}</span>
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  const statRow = (k: StatKey) => {
    const vals = shown.map((b) => (b ? b.totals[S[k]] : 0));
    if (vals.every((v) => !v)) return null;
    const differs = vals.some((v) => Math.round(v) !== Math.round(vals[0]));
    if (onlyDiff && !differs) return null;
    const cap = k === "pa" ? rules.capPA : k === "pm" ? rules.capPM : k === "po" ? rules.capPO : k.startsWith("rp") && k !== "rpMelee" && k !== "rpDist" ? rules.resCap : undefined;
    const unit = k.startsWith("rp") || k === "crit" || k.startsWith("pct") ? " %" : "";
    return (
      <tr key={k} className={`stat${differs ? " differs" : ""}`}>
        <th scope="row">{STAT_LABELS[k]}</th>
        {stuffs.map((s, i) => {
          const v = vals[i];
          const d = refBuild && i !== refIndex ? Math.round(v) - Math.round(refBuild.totals[S[k]]) : 0;
          return (
            <td key={s.slot} className={pending[i] ? "pending" : ""}>
              {shown[i] && (
                <>
                  <span className={v < 0 ? "neg" : ""}>
                    {fmt(v)}
                    {unit}
                  </span>
                  {cap != null && v > cap && <small className="over" title="Au-delà du plafond, sans effet"> plafond {cap}</small>}
                  {d !== 0 && <span className={`delta ${d > 0 ? "up" : "down"}`}> {d > 0 ? `+${fmt(d)}` : `−${fmt(-d)}`}</span>}
                </>
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  const group = (title: string, extra?: React.ReactNode) => (
    <tr className="group">
      <th colSpan={stuffs.length + 1}>
        <span>{title}</span>
        {extra}
      </th>
    </tr>
  );

  // ------------------------------------------------------------ verdict
  const ready = shown.every(Boolean) && stuffs.length > 1;
  // indice hors pénalités : un objectif manqué ou une condition non remplie est signalé à part (« À noter »)
  const quality = (b: BuildResult) => b.evaluation.score + b.evaluation.penalty;
  const best = ready ? shown.reduce((bi, b, i) => (quality(b!) > quality(shown[bi]!) ? i : bi), 0) : -1;
  const roleIndex = (b: BuildResult) => (refBuild ? Math.exp(quality(b) - quality(refBuild)) : 1);

  const detailIndex = Math.max(0, stuffs.findIndex((s) => s.slot === detail));
  const detailBuild = shown[detailIndex];

  return (
    <div className="compare">
      <header className="cmp-head">
        <div>
          <h2>Comparateur de stuffs</h2>
          <p>
            Compose jusqu'à trois stuffs, ou envoie ceux de l'optimiseur, et compare-les dans le même contexte : mêmes sorts, même monstre de
            référence, même rôle. Les points de caractéristique sont répartis au mieux, sauf si tu les fixes.
          </p>
        </div>
      </header>

      <section className="card cmp-context">
        <label className="ctx-field">
          <span>Classe</span>
          <select value={state.classId ?? ""} onChange={(e) => setState((c) => ({ ...c, classId: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">Choisir…</option>
            {info.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ctx-field level">
          <span>Niveau</span>
          <input
            type="number"
            min={1}
            max={200}
            value={state.level}
            onChange={(e) => setState((c) => ({ ...c, level: Math.max(1, Math.min(200, Number(e.target.value) || 1)) }))}
          />
        </label>
        <div className="ctx-field">
          <span>Rôle</span>
          <div className="seg-mini" role="radiogroup">
            {(Object.keys(ROLES) as Role[]).map((r) => (
              <button
                type="button"
                key={r}
                role="radio"
                aria-checked={state.role === r}
                className={state.role === r ? "on" : ""}
                onClick={() => setState((c) => ({ ...c, role: r }))}
              >
                {ROLES[r].label}
              </button>
            ))}
          </div>
        </div>
        <div className="ctx-field">
          <span>Éléments joués</span>
          <div className="chips small">
            <button type="button" className={`chip${state.voie.length ? "" : " on"}`} onClick={() => setState((c) => ({ ...c, voie: [] }))}>
              ✦ Auto
            </button>
            {VOIES.map((v) => (
              <button
                type="button"
                key={v}
                className={`chip elem${state.voie.includes(v) ? " on" : ""}`}
                style={{ "--elem": ELEM_COLOR[VOIE_ELEM[v]] } as React.CSSProperties}
                onClick={() =>
                  setState((c) => ({
                    ...c,
                    voie: c.voie.includes(v) ? c.voie.filter((x) => x !== v) : VOIES.filter((x): x is Voie => x === v || c.voie.includes(x)),
                  }))
                }
              >
                <span className="dot" aria-hidden />
                {VOIE_LABEL[v]}
              </button>
            ))}
          </div>
        </div>
        <label className="toggle ctx-toggle">
          <input type="checkbox" checked={state.scrolls} onChange={(e) => setState((c) => ({ ...c, scrolls: e.target.checked }))} />
          <span className="switch" aria-hidden />
          Parchemins
        </label>
      </section>

      {state.classId == null && <div className="banner stale">Choisis une classe pour évaluer les stuffs : les dégâts dépendent de ses sorts.</div>}

      {ready && refBuild && (
        <section className="card verdict" aria-live="polite">
          <p className="verdict-main">
            <span className="stuff-letter" style={{ "--stuff": STUFF_COLOR[stuffs[best].slot] } as React.CSSProperties}>
              {STUFF_LETTER[stuffs[best].slot]}
            </span>
            <span>
              <strong>{stuffName(stuffs[best])}</strong> est le plus fort pour le rôle {ROLES[state.role].label}
              {stuffs.length > 1 && best !== refIndex ? ` : ${ratio(roleIndex(shown[best]!), 1)} sur l'indice du rôle face à la référence.` : "."}
              {shown[best]!.problems.length > 0 && <em className="verdict-warn"> Attention : {shown[best]!.problems.length} point{shown[best]!.problems.length > 1 ? "s" : ""} à noter.</em>}
            </span>
          </p>
          <ul className="verdict-lines">
            {stuffs.map((s, i) =>
              i === refIndex ? null : (
                <li key={s.slot}>
                  <b>{STUFF_LETTER[s.slot]}</b> face à <b>{STUFF_LETTER[stuffs[refIndex].slot]}</b> : indice {ratio(roleIndex(shown[i]!), 1)} · dégâts{" "}
                  {ratio(shown[i]!.evaluation.dpt, refBuild.evaluation.dpt)} · PV effectifs {ratio(shown[i]!.evaluation.ehp, refBuild.evaluation.ehp)}
                  {refBuild.evaluation.hpt > 0 && ` · soins ${ratio(shown[i]!.evaluation.hpt, refBuild.evaluation.hpt)}`}
                </li>
              ),
            )}
          </ul>
          <p className="hint">
            Indice du rôle : moyenne des dégâts et de la survie pondérée par le rôle ({Math.round(ROLES[state.role].w.dmg * 100)} % dégâts,{" "}
            {Math.round(ROLES[state.role].w.surv * 100)} % survie), bonus d'utilité compris. Les objectifs manqués et les conditions non remplies ne
            sont pas déduits : ils sont listés dans « À noter ».
          </p>
        </section>
      )}

      {importFor != null && (
        <section className="card import-card">
          <h3>
            Importer une liste dans le stuff {STUFF_LETTER[importFor]}
          </h3>
          <p className="hint">Un item par ligne (copié depuis DofusBook, un guide, Discord…). Les noms sont reconnus sans accents ni majuscules.</p>
          <textarea
            value={importText}
            autoFocus
            rows={8}
            placeholder={"Gelano\nCoiffe du Bouftou Royal\nAnneau : Anneau de Sagesse\n…"}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="import-actions">
            <button type="button" className="ghost" onClick={() => setImportFor(null)}>
              Annuler
            </button>
            <button type="button" className="run small" disabled={!importText.trim()} onClick={runImport}>
              Importer
            </button>
          </div>
        </section>
      )}
      {importReport && (
        <div className={`banner ${importReport.unknown.length ? "stale" : "ok"}`}>
          <span>
            Stuff {STUFF_LETTER[importReport.slot]} : {importReport.found} item{importReport.found > 1 ? "s" : ""} reconnu{importReport.found > 1 ? "s" : ""}
            {importReport.unknown.length > 0 && ` · lignes ignorées : ${importReport.unknown.slice(0, 6).join(", ")}${importReport.unknown.length > 6 ? "…" : ""}`}
          </span>
          <button type="button" className="ghost" onClick={() => setImportReport(null)}>
            OK
          </button>
        </div>
      )}

      <section className="card cmp-sheet">
        <div className="sheet-bar">
          <label className="toggle">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
            <span className="switch" aria-hidden />
            Seulement les différences
          </label>
          {stuffs.length < MAX_STUFFS && (
            <button type="button" className="ghost" onClick={() => addStuff()}>
              + Ajouter un stuff
            </button>
          )}
        </div>
        <div className="cmp-scroll">
          <table className="cmp-table" style={{ minWidth: 170 + stuffs.length * 230 }}>
            <colgroup>
              <col className="label-col" />
              {stuffs.map((s) => (
                <col key={s.slot} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="corner" />
                {stuffs.map((s, i) => {
                  const isRef = s.slot === state.ref;
                  return (
                    <th key={s.slot} className="stuff-head" style={{ "--stuff": STUFF_COLOR[s.slot] } as React.CSSProperties}>
                      <div className="sh-top">
                        <span className="stuff-letter">{STUFF_LETTER[s.slot]}</span>
                        <input
                          className="stuff-name"
                          value={s.name}
                          placeholder={`Stuff ${STUFF_LETTER[s.slot]}`}
                          aria-label={`Nom du stuff ${STUFF_LETTER[s.slot]}`}
                          onChange={(e) => setStuff(s.slot, { name: e.target.value })}
                        />
                        {pending[i] && <span className="mini-spinner" title="Calcul en cours" />}
                      </div>
                      <div className="sh-actions">
                        <button
                          type="button"
                          className={isRef ? "on" : ""}
                          disabled={isRef}
                          title="Les écarts sont calculés par rapport à ce stuff"
                          onClick={() => setState((c) => ({ ...c, ref: s.slot }))}
                        >
                          {isRef ? "Référence" : "Prendre en réf."}
                        </button>
                        <button type="button" disabled={stuffs.length >= MAX_STUFFS} onClick={() => addStuff(s)}>
                          Dupliquer
                        </button>
                        <button type="button" onClick={() => (setImportFor(s.slot), setImportReport(null))}>
                          Importer
                        </button>
                        <button type="button" onClick={() => setStuff(s.slot, { items: s.items.map(() => null), alloc: null })}>
                          Vider
                        </button>
                        {stuffs.length > 1 && (
                          <button type="button" className="danger" aria-label={`Retirer le stuff ${STUFF_LETTER[s.slot]}`} onClick={() => removeStuff(s.slot)}>
                            Retirer
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {group("Bilan")}
              <tr className="metric">
                <th scope="row">
                  Indice du rôle
                  <small>{ROLES[state.role].label}</small>
                </th>
                {stuffs.map((s, i) => {
                  const b = shown[i];
                  return (
                    <td key={s.slot} className={pending[i] ? "pending" : ""}>
                      {b && refBuild ? (
                        i === refIndex ? (
                          <span className="ref-tag">référence</span>
                        ) : (
                          <strong className={`index ${roleIndex(b) >= 1 ? "up" : "down"}`}>{ratio(roleIndex(b), 1)}</strong>
                        )
                      ) : (
                        <span className="muted">{errors[i] ? "erreur" : "…"}</span>
                      )}
                      {i === best && <span className="best-tag">★ le plus fort</span>}
                    </td>
                  );
                })}
              </tr>
              {metricRow("Dégâts / tour", (b) => b.evaluation.dpt)}
              {metricRow("PV effectifs", (b) => b.evaluation.ehp, "PV / résistances moyennes")}
              {metricRow("Points de vie", (b) => b.hp, "base du niveau + Vitalité")}
              {shown.some((b) => b && b.evaluation.hpt > 0) && metricRow("Soins / tour", (b) => b.evaluation.hpt)}
              <tr>
                <th scope="row">Éléments</th>
                {stuffs.map((s, i) => {
                  const b = shown[i];
                  return (
                    <td key={s.slot} className={pending[i] ? "pending" : ""}>
                      {b && (
                        <>
                          <div className="elem-split" role="img" aria-label="Part des dégâts par élément">
                            {b.rotation.elements.map((x, e) =>
                              x > 0.005 ? <span key={e} style={{ flex: x, background: ELEM_COLOR[e] }} title={`${ELEMENTS[e]} ${pct(x)}`} /> : null,
                            )}
                          </div>
                          <small className="elem-text">
                            {b.rotation.elements
                              .map((x, e) => [x, e] as const)
                              .filter(([x]) => x > 0.04)
                              .sort((a, z) => z[0] - a[0])
                              .map(([x, e]) => `${ELEMENTS[e]} ${pct(x)}`)
                              .join(" · ")}
                          </small>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th scope="row">À noter</th>
                {stuffs.map((s, i) => (
                  <td key={s.slot} className={pending[i] ? "pending" : ""}>
                    {errors[i] ? (
                      <span className="neg">Évaluation impossible : {errors[i]}</span>
                    ) : shown[i]?.problems.length ? (
                      <ul className="cmp-problems">
                        {shown[i]!.problems.map((p, j) => (
                          <li key={j}>⚠ {p}</li>
                        ))}
                      </ul>
                    ) : shown[i] ? (
                      <span className="ok-text">✓ objectifs atteints</span>
                    ) : null}
                  </td>
                ))}
              </tr>

              {group("Équipement")}
              {EQUIP.map(slotRow)}
              {group("Dofus, trophées et prysmaradites")}
              {DOFUS.map(slotRow)}

              {group("Forgemagie et caractéristiques")}
              <tr>
                <th scope="row">Exos</th>
                {stuffs.map((s) => (
                  <td key={s.slot}>
                    <div className="chips small">
                      {(["pa", "pm", "po"] as const).map((k) => (
                        <button
                          type="button"
                          key={k}
                          className={`chip${s.exo[k] ? " on" : ""}`}
                          aria-pressed={!!s.exo[k]}
                          onClick={() => setStuff(s.slot, { exo: { ...s.exo, [k]: !s.exo[k] } })}
                        >
                          {k.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">
                  Points investis
                  <small>{cls ? "auto : répartis au mieux" : ""}</small>
                </th>
                {stuffs.map((s, i) => (
                  <td key={s.slot}>
                    <AllocCell
                      alloc={s.alloc}
                      computed={shown[i]?.alloc}
                      onChange={(alloc) => setStuff(s.slot, { alloc })}
                    />
                  </td>
                ))}
              </tr>

              {group("Stats")}
              {STAT_ROWS.map((g) => g.map(statRow))}
              <tr>
                <th scope="row">Panoplies</th>
                {stuffs.map((s, i) => (
                  <td key={s.slot} className={pending[i] ? "pending" : ""}>
                    {shown[i]?.sets.length ? (
                      <ul className="cmp-sets">
                        {shown[i]!.sets.map((x) => (
                          <li key={x.id}>
                            {x.name} <small>{x.pieces} pièces</small>
                          </li>
                        ))}
                      </ul>
                    ) : shown[i] ? (
                      <span className="muted">aucune</span>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {detailBuild && cls && (
        <section className="cmp-detail">
          <div className="build-tabs" role="tablist">
            {stuffs.map((s, i) => (
              <button
                key={s.slot}
                role="tab"
                aria-selected={i === detailIndex}
                className={`build-tab${i === detailIndex ? " on" : ""}`}
                onClick={() => setDetail(s.slot)}
              >
                <span className="tab-title">
                  <span className="stuff-letter small" style={{ "--stuff": STUFF_COLOR[s.slot] } as React.CSSProperties}>
                    {STUFF_LETTER[s.slot]}
                  </span>{" "}
                  Détail · {stuffName(s)}
                </span>
                {shown[i] && (
                  <span className="tab-stats">
                    <b>{fmt(shown[i]!.evaluation.dpt)}</b> dégâts · <b>{fmt(shown[i]!.hp)}</b> PV · <b>{fmt(shown[i]!.evaluation.ehp)}</b> PV eff.
                  </span>
                )}
              </button>
            ))}
          </div>
          <BuildView
            build={detailBuild}
            reference={detailIndex !== refIndex ? refBuild : undefined}
            rules={rules}
            onCopy={() =>
              navigator.clipboard?.writeText(
                buildText(detailBuild, { cls: cls.name, level: state.level, version: info.meta.version, voie: state.voie, name: stuffName(stuffs[detailIndex]) }),
              )
            }
          />
        </section>
      )}

      {tip && <ItemCard item={tip.item} at={tip.at} />}
    </div>
  );
}

/** Points de caractéristique : automatiques (affichés) ou fixés à la main. */
function AllocCell({ alloc, computed, onChange }: { alloc: Allocation | null; computed?: Allocation; onChange: (a: Allocation | null) => void }) {
  const shown = alloc ?? computed;
  return (
    <div className="alloc-cell">
      <div className="seg-mini" role="radiogroup">
        <button type="button" role="radio" aria-checked={!alloc} className={!alloc ? "on" : ""} onClick={() => onChange(null)}>
          Auto
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!!alloc}
          className={alloc ? "on" : ""}
          onClick={() => onChange(alloc ?? { ...emptyAlloc(), ...computed })}
        >
          Fixés
        </button>
      </div>
      {alloc ? (
        <div className="alloc-grid">
          {BASE_CARACS.map((k) => (
            <label key={k}>
              <span>{CARAC_SHORT[k]}</span>
              <input
                type="number"
                min={0}
                step={10}
                value={alloc[k] || ""}
                placeholder="0"
                onChange={(e) => onChange({ ...alloc, [k]: Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
          ))}
        </div>
      ) : (
        <small className="muted">
          {shown
            ? BASE_CARACS.filter((k) => shown[k] > 0)
                .map((k) => `${CARAC_SHORT[k]} ${fmt(shown[k])}`)
                .join(" · ") || "aucun"
            : "…"}
        </small>
      )}
    </div>
  );
}
