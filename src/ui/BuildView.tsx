// Détail d'un stuff : équipement (valeur de chaque item, imposer / bannir), stats, résistances, tours de jeu,
// panoplies, passifs et points d'attention.

import { useState } from "react";
import type { Item } from "../engine/types";
import type { BuildResult } from "../engine/solver";
import type { Rules } from "../engine/rules";
import { BASE_CARACS, ELEMENTS, STAT_LABELS, S, type StatKey } from "../engine/statIds";
import { SLOTS } from "../engine/stats";
import { ELEM_COLOR, condText, fmt, pct, slotLabel, statLineText, total } from "./format";
import { ItemIcon } from "./ItemSelect";

interface Props {
  build: BuildResult;
  /** Stuff du rôle, pour comparer. */
  reference?: BuildResult;
  rules: Rules;
  locked?: (number | null)[];
  banned?: number[];
  /** Absents : pas de boutons Imposer / Bannir (comparateur). */
  onLock?: (slot: number, id: number | null) => void;
  onBan?: (id: number) => void;
  onCopy: () => void;
  onCompare?: () => void;
}

const EQUIP = SLOTS.map((_, i) => i).filter((i) => SLOTS[i] !== "dofus");
const DOFUS = SLOTS.map((_, i) => i).filter((i) => SLOTS[i] === "dofus");

export function Delta({ a, b }: { a: number; b?: number }) {
  if (b == null || Math.abs(a / b - 1) < 0.005) return null;
  const d = a / b - 1;
  return <span className={`delta ${d > 0 ? "up" : "down"}`}>{`${d > 0 ? "+" : "−"}${pct(Math.abs(d))}`}</span>;
}

export function ItemCard({ item, at }: { item: Item; at: DOMRect }) {
  const left = at.right + 310 < window.innerWidth ? at.right + 10 : Math.max(8, at.left - 310);
  const top = Math.max(8, Math.min(at.top, window.innerHeight - 360));
  const cond = condText(item);
  return (
    <div className="item-card" style={{ left, top }}>
      <header>
        <ItemIcon item={item} size={44} />
        <div>
          <strong>{item.name}</strong>
          <small>
            {item.type} · niveau {item.level}
          </small>
        </div>
      </header>
      {item.weapon && (
        <p className="weapon-line">
          {item.weapon.ap} PA · portée {item.weapon.minRange}–{item.weapon.range} · critique {item.weapon.critRate} % (+{item.weapon.critBonus})
        </p>
      )}
      <ul className="stat-lines">
        {item.stats.map((l, i) => (
          <li key={i} className={l[2] < 0 ? "neg" : ""}>
            {statLineText(l)}
          </li>
        ))}
      </ul>
      {cond && <p className="cond">Condition : {cond}</p>}
      {item.notes?.map((n, i) => (
        <p key={i} className="note">
          {n}
        </p>
      ))}
    </div>
  );
}

export function BuildView({ build: b, reference, rules, locked = [], banned = [], onLock, onBan, onCopy, onCompare }: Props) {
  const [tip, setTip] = useState<{ item: Item; at: DOMRect } | null>(null);
  const [copied, setCopied] = useState(false);
  const e = b.evaluation;
  const maxValue = Math.max(1e-9, ...b.itemValue);
  /** Baisse relative de l'indice du rôle si on retire l'item (itemValue : perte de score, en unités de ln). */
  const share = (i: number) => 1 - Math.exp(-Math.max(0, b.itemValue[i]));

  const slotCell = (i: number) => {
    const it = b.items[i];
    const isLocked = it != null && locked[i] === it.id;
    return (
      <div key={i} className={`equip-cell${it ? "" : " empty"}${isLocked ? " locked" : ""}`}>
        {it ? (
          <>
            <div
              className="equip-main"
              tabIndex={0}
              onMouseEnter={(ev) => setTip({ item: it, at: ev.currentTarget.getBoundingClientRect() })}
              onMouseLeave={() => setTip(null)}
              onFocus={(ev) => setTip({ item: it, at: ev.currentTarget.getBoundingClientRect() })}
              onBlur={() => setTip(null)}
            >
              <ItemIcon item={it} size={44} />
              <div className="equip-text">
                <span className="equip-name">{it.name}</span>
                <small>
                  {slotLabel(i)} · niv. {it.level}
                  {it.level > b.level && (
                    <span className="ahead" title={`${it.level - b.level} niveau${it.level - b.level > 1 ? "x" : ""} au-dessus du personnage`}>
                      {" "}(+{it.level - b.level})
                    </span>
                  )}
                </small>
              </div>
            </div>
            <div className="value-row" title={`Sans cet item (emplacement vide), l'indice du rôle baisserait de ${pct(share(i), 1)}`}>
              <div className="value-bar">
                <span style={{ width: `${Math.max(0, (b.itemValue[i] / maxValue) * 100)}%` }} />
              </div>
              <small>{share(i) >= 0.005 ? pct(share(i)) : "≈ 0"}</small>
            </div>
            {onLock && onBan && (
            <div className="equip-actions">
              <button
                type="button"
                className={isLocked ? "on" : ""}
                title={isLocked ? "Libérer cet emplacement" : "Imposer cet item au prochain calcul"}
                onClick={() => onLock(i, isLocked ? null : it.id)}
              >
                {isLocked ? "Imposé" : "Imposer"}
              </button>
              <button
                type="button"
                className={banned.includes(it.id) ? "on danger" : "danger"}
                title="Exclure cet item des prochains calculs"
                disabled={banned.includes(it.id)}
                onClick={() => onBan(it.id)}
              >
                {banned.includes(it.id) ? "Banni" : "Bannir"}
              </button>
            </div>
            )}
          </>
        ) : (
          <div className="equip-main">
            <span className="item-icon placeholder" style={{ width: 44, height: 44 }} />
            <div className="equip-text">
              <span className="equip-name muted">Vide</span>
              <small>{slotLabel(i)}</small>
            </div>
          </div>
        )}
      </div>
    );
  };

  const statRow = (k: StatKey, opts: { cap?: number; label?: string; always?: boolean } = {}) => {
    const v = total(b, k);
    if (!v && !opts.always) return null;
    const over = opts.cap != null && v > opts.cap;
    return (
      <div className="stat-row" key={k}>
        <span>{opts.label ?? STAT_LABELS[k]}</span>
        <span className={v < 0 ? "neg" : ""}>
          {fmt(over ? opts.cap! : v)}
          {over && <small className="over" title="Au-delà du plafond, sans effet"> ({fmt(v)})</small>}
        </span>
      </div>
    );
  };

  const passives = b.items.filter((it): it is Item => !!it?.notes?.length);

  return (
    <article className="build">
      <header className="build-head">
        <div className="kpis">
          <div className="kpi">
            <span>Dégâts / tour</span>
            <strong>{fmt(e.dpt)}</strong>
            <Delta a={e.dpt} b={reference && reference !== b ? reference.evaluation.dpt : undefined} />
          </div>
          <div className="kpi">
            <span>PV effectifs</span>
            <strong>{fmt(e.ehp)}</strong>
            <Delta a={e.ehp} b={reference && reference !== b ? reference.evaluation.ehp : undefined} />
          </div>
          <div className="kpi">
            <span>Points de vie</span>
            <strong>{fmt(b.hp)}</strong>
          </div>
          {e.hpt > 0 && (
            <div className="kpi">
              <span>Soins / tour</span>
              <strong>{fmt(e.hpt)}</strong>
            </div>
          )}
        </div>
        <div className="build-actions">
        {onCompare && (
          <button type="button" className="ghost" title="Ajouter ce stuff au comparateur" onClick={onCompare}>
            Comparer
          </button>
        )}
        <button
          type="button"
          className="ghost copy"
          onClick={() => {
            onCopy();
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copié ✓" : "Copier en texte"}
        </button>
        </div>
      </header>

      {b.problems.length > 0 && (
        <ul className="problems" role="alert">
          {b.problems.map((p, i) => (
            <li key={i}>
              <span aria-hidden>⚠</span> {p}
            </li>
          ))}
        </ul>
      )}

      <section className="equipment">
        <p className="hint value-legend">
          <span className="value-sample" aria-hidden>
            <span />
          </span>
          Barre sous chaque item : ce qu'il apporte au stuff. Le pourcentage est la baisse de l'indice du rôle (dégâts et survie pondérés)
          si on retirait l'item sans le remplacer ; la plus longue barre est l'item le plus précieux.
        </p>
        <div className="equip-grid">{EQUIP.map(slotCell)}</div>
        <h4>Dofus, trophées et prysmaradites</h4>
        <div className="equip-grid dofus">{DOFUS.map(slotCell)}</div>
      </section>

      <div className="build-cols">
        <section className="card">
          <h3>Caractéristiques</h3>
          <div className="stat-group">
            {statRow("pa", { cap: rules.capPA, always: true })}
            {statRow("pm", { cap: rules.capPM, always: true })}
            {statRow("po", { cap: rules.capPO, always: true })}
            {statRow("invo", { always: true })}
          </div>
          <div className="stat-group">
            <div className="stat-row hp-row">
              <span>Points de vie</span>
              <span>
                {fmt(b.hp)}
                <small className="alloc"> dont {fmt(b.hp - total(b, "vita"))} de base</small>
              </span>
            </div>
            {BASE_CARACS.map((k) => (
              <div className="stat-row" key={k}>
                <span>{STAT_LABELS[k]}</span>
                <span className={total(b, k) < 0 ? "neg" : ""}>
                  {fmt(total(b, k))}
                  {b.alloc[k] > 0 && <small className="alloc"> dont {fmt(b.alloc[k])} investis</small>}
                </span>
              </div>
            ))}
          </div>
          <div className="stat-group">
            {(["puissance", "do", "doNeutre", "doTerre", "doFeu", "doEau", "doAir", "doCrit", "crit", "soin", "pctSorts", "pctArmes", "pctMelee", "pctDist", "doPou"] as StatKey[]).map((k) =>
              statRow(k),
            )}
          </div>
          <div className="stat-group">
            {(["ini", "prospe", "tacle", "fuite", "esqPA", "esqPM", "retPA", "retPM"] as StatKey[]).map((k) => statRow(k))}
          </div>
        </section>

        <section className="card">
          <h3>Résistances</h3>
          <div className="res-list">
            {ELEMENTS.map((el, i) => {
              const v = b.totals[S.rpNeutre + i];
              const flat = b.totals[S.rfNeutre + i];
              return (
                <div className="res-row" key={el}>
                  <span className="res-name">
                    <i className="dot" style={{ background: ELEM_COLOR[i] }} aria-hidden />
                    {el}
                  </span>
                  <div className="res-bar" title={`Plafond ${rules.resCap} %`}>
                    <span style={{ width: `${Math.max(0, Math.min(1, v / rules.resCap)) * 100}%` }} className={v >= rules.resCap ? "capped" : ""} />
                  </div>
                  <span className={`res-val${v < 0 ? " neg" : ""}`}>{fmt(v)} %</span>
                  <span className="res-flat">{flat ? `+${fmt(flat)}` : ""}</span>
                </div>
              );
            })}
          </div>
          <div className="stat-group">
            {statRow("rpMelee")}
            {statRow("rpDist")}
            {statRow("rfCrit")}
            {statRow("rfPou")}
          </div>

          <h3>Panoplies</h3>
          {b.sets.length ? (
            <ul className="sets">
              {b.sets.map((s) => (
                <li key={s.id}>
                  <span>{s.name}</span>
                  <span className="pieces">
                    {Array.from({ length: s.pieces }, (_, i) => (
                      <i key={i} />
                    ))}
                    {s.pieces} pièces
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Aucune panoplie active.</p>
          )}
        </section>

        <section className="card rotation">
          <h3>Tour de jeu</h3>
          <div className="elem-split" role="img" aria-label="Part des dégâts par élément">
            {b.rotation.elements.map((x, i) =>
              x > 0.005 ? <span key={i} style={{ flex: x, background: ELEM_COLOR[i] }} title={`${ELEMENTS[i]} ${pct(x)}`} /> : null,
            )}
          </div>
          <div className="elem-legend">
            {b.rotation.elements.map((x, i) =>
              x > 0.005 ? (
                <span key={i}>
                  <i className="dot" style={{ background: ELEM_COLOR[i] }} aria-hidden />
                  {ELEMENTS[i]} {pct(x)}
                </span>
              ) : null,
            )}
          </div>
          <ol className="turns">
            {b.rotation.turns.map((t, i) => (
              <li key={i}>
                <div className="turn-head">
                  <span className="turn-share">{pct(t.weight)} des tours</span>
                  <strong>{fmt(t.damage)}</strong>
                </div>
                <div className="casts">
                  {t.casts.map((c, j) => (
                    <span key={j} className="cast">
                      {c}
                    </span>
                  ))}
                </div>
                <small className="muted">{t.apUsed} PA utilisés</small>
              </li>
            ))}
          </ol>
          {b.rotation.heals.length > 0 && (
            <>
              <h4>Soins</h4>
              <ol className="turns heal">
                {b.rotation.heals.map((t, i) => (
                  <li key={i}>
                    <div className="turn-head">
                      <span className="turn-share">{pct(t.weight)} des tours</span>
                      <strong>{fmt(t.damage)}</strong>
                    </div>
                    <div className="casts">
                      {t.casts.map((c, j) => (
                        <span key={j} className="cast">
                          {c}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          <details className="attacks">
            <summary>Dégâts de chaque sort</summary>
            <table>
              <thead>
                <tr>
                  <th>Sort</th>
                  <th>PA</th>
                  <th>Normal</th>
                  <th>Critique</th>
                  <th>% crit.</th>
                </tr>
              </thead>
              <tbody>
                {[...b.rotation.attacks]
                  .sort((x, y) => y.expected / y.ap - x.expected / x.ap)
                  .map((a, i) => (
                    <tr key={i}>
                      <td>{a.name}</td>
                      <td>{a.ap}</td>
                      <td>{fmt(a.normal)}</td>
                      <td>{a.critChance > 0 ? fmt(a.critical) : "—"}</td>
                      <td>{a.critChance > 0 ? pct(a.critChance) : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="hint">Dégâts moyens d'un lancer sur le monstre de référence du niveau (résistances moyennes).</p>
          </details>
        </section>
      </div>

      {passives.length > 0 && (
        <section className="card passives">
          <h3>Effets passifs</h3>
          <p className="hint">Non chiffrés par l'optimiseur, à garder en tête.</p>
          {passives.map((it) => (
            <div key={it.id} className="passive">
              <ItemIcon item={it} size={32} />
              <div>
                <strong>{it.name}</strong>
                {it.notes!.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {tip && <ItemCard item={tip.item} at={tip.at} />}
    </article>
  );
}
