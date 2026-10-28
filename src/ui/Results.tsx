// Résultats d'un calcul : graphique dégâts / survie, choix du stuff, potentiel des éléments, détail du stuff.

import type { SolveResult } from "../engine/solver";
import { MAIN_VOIE, PLAYABLE_VOIE } from "../engine/analysis";
import { VOIE_LABEL } from "../engine/voies";
import { ELEM_COLOR, VOIE_ELEM, buildTitle, fmt, pct } from "./format";
import { ParetoChart, type Pick } from "./ParetoChart";

interface Props {
  result: SolveResult;
  selected: Pick;
  onSelect: (p: Pick) => void;
  title: string;
}

const tag = (rel: number) => (rel >= MAIN_VOIE ? "principale" : rel >= PLAYABLE_VOIE ? "jouable" : "faible");

export function Results({ result: r, selected, onSelect, title }: Props) {
  const hasHeal = r.voies.some((v) => v.heal > 0);
  return (
    <section className="results">
      <header className="results-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            {r.builds.length} stuffs du plus offensif au plus défensif · calculés en {(r.elapsedMs / 1000).toFixed(1).replace(".", ",")} s · objectifs{" "}
            {r.targets.pa} PA, {r.targets.pm} PM{r.targets.po ? `, ${r.targets.po} PO` : ""}
            {r.targets.invo > 1 ? `, ${r.targets.invo} invocations` : ""}
            {r.targets.dpt ? `, ${fmt(r.targets.dpt)} dégâts/tour minimum` : ""}
          </p>
        </div>
      </header>

      <div className="results-top">
        <div className="card chart-card">
          <ParetoChart front={r.builds} highlighted={r.highlighted} voieBuilds={r.voieBuilds} selected={selected} onSelect={onSelect} />
        </div>
        <div className="card voies">
          <h3>Potentiel des éléments</h3>
          <p className="hint">Dégâts par tour d'un personnage tout investi dans l'élément, rapportés au meilleur.</p>
          {[...r.voies]
            .sort((a, b) => b.rel - a.rel)
            .map((v) => (
              <div key={v.voie} className="voie-row">
                <span className="voie-name">
                  <i className="dot" style={{ background: ELEM_COLOR[VOIE_ELEM[v.voie]] }} aria-hidden />
                  {v.label}
                </span>
                <div className="voie-bar">
                  <span style={{ width: pct(v.rel) }} />
                </div>
                <span className="voie-val">{pct(v.rel)}</span>
                <span className={`voie-tag ${tag(v.rel)}`}>{tag(v.rel)}</span>
                {hasHeal && v.heal > 0 && <small className="voie-heal">soins {pct(v.healRel)}</small>}
              </div>
            ))}
        </div>
      </div>

      <div className="build-tabs" role="tablist">
        {r.builds.map((b, i) => {
          const on = selected.kind === "front" && selected.i === i;
          return (
            <button key={`f${i}`} role="tab" aria-selected={on} className={`build-tab${on ? " on" : ""}`} onClick={() => onSelect({ kind: "front", i })}>
              <span className="tab-title">
                {i === r.highlighted && <span className="star">★ </span>}
                {buildTitle(b)}
              </span>
              <span className="tab-stats">
                <b>{fmt(b.evaluation.dpt)}</b> dégâts · <b>{fmt(b.hp)}</b> PV · <b>{fmt(b.evaluation.ehp)}</b> PV eff.
              </span>
            </button>
          );
        })}
        {r.voieBuilds.map((v, i) => {
          const on = selected.kind === "voie" && selected.i === i;
          return (
            <button key={`v${i}`} role="tab" aria-selected={on} className={`build-tab voie-tab${on ? " on" : ""}`} onClick={() => onSelect({ kind: "voie", i })}>
              <span className="tab-title">
                <i className="dot" style={{ background: ELEM_COLOR[VOIE_ELEM[v.voie]] }} aria-hidden /> Meilleur {VOIE_LABEL[v.voie]}
              </span>
              <span className="tab-stats">
                <b>{fmt(v.build.evaluation.dpt)}</b> dégâts · <b>{fmt(v.build.hp)}</b> PV · <b>{fmt(v.build.evaluation.ehp)}</b> PV eff.
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
