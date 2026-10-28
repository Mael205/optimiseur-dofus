// Formulaire de la demande : classe, niveau, rôle, éléments, monture, forgemagie, options avancées.

import { useMemo, useState } from "react";
import type { ItemIndex } from "../engine/worker";
import { ROLES, type Role, type Targets } from "../engine/score";
import { SLOTS } from "../engine/stats";
import { VOIES, VOIE_LABEL, type Voie } from "../engine/voies";
import type { Config } from "./config";
import { ELEM_COLOR, VOIE_ELEM, slotLabel } from "./format";
import { ItemIcon, ItemSelect } from "./ItemSelect";

const FAMILIER = SLOTS.indexOf("familier");
const MOUNT_TYPES = ["Familier", "Montilier", "Dragodinde", "Muldo", "Volkorne"];
const ROLE_HINT: Record<Role, string> = {
  dps: "Dégâts avant tout, survie minimale",
  equilibre: "Le compromis des guides",
  tank: "Survie et soutien d'abord",
};

interface Props {
  config: Config;
  update: (patch: Partial<Config>) => void;
  classes: { id: number; name: string }[];
  items: ItemIndex[];
  defaults: Targets | null;
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
}

export function Form({ config, update, classes, items, defaults, running, onRun, onCancel }: Props) {
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const [mountTypes, setMountTypes] = useState<string[]>(MOUNT_TYPES);
  const [editSlot, setEditSlot] = useState<number | null>(null);
  const banned = useMemo(() => new Set(config.banned), [config.banned]);

  const setLocked = (slot: number, id: number | null) => update({ locked: config.locked.map((x, i) => (i === slot ? id : x)) });
  const toggleVoie = (v: Voie) =>
    update({ voie: config.voie.includes(v) ? config.voie.filter((x) => x !== v) : VOIES.filter((x) => x === v || config.voie.includes(x)) });
  const mount = config.locked[FAMILIER] != null ? byId.get(config.locked[FAMILIER]!) : undefined;
  const lockedCount = config.locked.filter((x, i) => x != null && i !== FAMILIER).length;
  const targetField = (k: "pa" | "pm" | "po" | "invo", label: string) => (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={k === "pa" ? 12 : k === "invo" ? 8 : 6}
        value={config.targets[k] ?? ""}
        placeholder={defaults ? String(defaults[k]) : ""}
        onChange={(e) => update({ targets: { ...config.targets, [k]: e.target.value === "" ? undefined : Number(e.target.value) } })}
      />
    </label>
  );

  return (
    <form
      className="panel form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!running && config.classId != null) onRun();
      }}
    >
      <section>
        <h2>Classe</h2>
        <div className="class-grid">
          {classes.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`class-tile${config.classId === c.id ? " selected" : ""}`}
              onClick={() => update({ classId: c.id })}
              aria-pressed={config.classId === c.id}
            >
              <span className="sigil" aria-hidden>
                {c.name.slice(0, 2)}
              </span>
              <span className="label">{c.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>
          Niveau <output className="level-value">{config.level}</output>
        </h2>
        <div className="level-row">
          <input
            type="range"
            min={1}
            max={200}
            value={config.level}
            onChange={(e) => update({ level: Number(e.target.value) })}
            style={{ "--fill": `${((config.level - 1) / 199) * 100}%` } as React.CSSProperties}
          />
          <input
            type="number"
            className="level-input"
            min={1}
            max={200}
            value={config.level}
            onChange={(e) => update({ level: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })}
          />
        </div>
        <div className="level-marks">
          {[50, 100, 150, 200].map((l) => (
            <button type="button" key={l} onClick={() => update({ level: l })}>
              {l}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Rôle</h2>
        <div className="segmented" role="radiogroup">
          {(Object.keys(ROLES) as Role[]).map((r) => (
            <button
              type="button"
              key={r}
              role="radio"
              aria-checked={config.role === r}
              className={config.role === r ? "on" : ""}
              onClick={() => update({ role: r })}
            >
              <strong>{ROLES[r].label}</strong>
              <small>{ROLE_HINT[r]}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Éléments</h2>
        <div className="chips">
          <button type="button" className={`chip${config.voie.length ? "" : " on"}`} onClick={() => update({ voie: [] })}>
            ✦ Auto
          </button>
          {VOIES.map((v) => (
            <button
              type="button"
              key={v}
              className={`chip elem${config.voie.includes(v) ? " on" : ""}`}
              style={{ "--elem": ELEM_COLOR[VOIE_ELEM[v]] } as React.CSSProperties}
              onClick={() => toggleVoie(v)}
            >
              <span className="dot" aria-hidden />
              {VOIE_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="hint">
          {config.voie.length === 0
            ? "Compare les éléments de la classe et garde le meilleur (mélanges compris)."
            : config.voie.length === 1
              ? `Stuff ${VOIE_LABEL[config.voie[0]]} : seuls les sorts de cet élément sont joués.`
              : `Multi-élément ${config.voie.map((v) => VOIE_LABEL[v]).join(" / ")}.`}
        </p>
      </section>

      <section>
        <h2>Monture / familier</h2>
        {mount ? (
          <div className="picked">
            <ItemIcon item={mount} size={36} />
            <div>
              <strong>{mount.name}</strong>
              <small>
                {mount.type} · niv. {mount.level}
              </small>
            </div>
            <button type="button" className="ghost" onClick={() => setLocked(FAMILIER, null)}>
              Retirer
            </button>
          </div>
        ) : (
          <>
            <div className="chips small">
              {MOUNT_TYPES.map((t) => (
                <button
                  type="button"
                  key={t}
                  className={`chip${mountTypes.includes(t) ? " on" : ""}`}
                  onClick={() => setMountTypes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))}
                >
                  {t}
                </button>
              ))}
            </div>
            <ItemSelect
              items={items}
              slot="familier"
              types={mountTypes}
              maxLevel={config.level + config.levelMargin}
              placeholder="Automatique : choisi par l'optimiseur"
              onPick={(it) => setLocked(FAMILIER, it.id)}
            />
          </>
        )}
      </section>

      <section>
        <h2>Forgemagie</h2>
        <div className="toggles">
          {(["pa", "pm", "po"] as const).map((k) => (
            <label key={k} className="toggle">
              <input type="checkbox" checked={!!config.exo[k]} onChange={(e) => update({ exo: { ...config.exo, [k]: e.target.checked } })} />
              <span className="switch" aria-hidden />
              Exo {k.toUpperCase()}
            </label>
          ))}
          <label className="toggle">
            <input type="checkbox" checked={config.scrolls} onChange={(e) => update({ scrolls: e.target.checked })} />
            <span className="switch" aria-hidden />
            Parchemins
          </label>
        </div>
      </section>

      <details className="advanced">
        <summary>
          Options avancées
          {(lockedCount > 0 || config.banned.length > 0 || config.dptMin > 0 || config.deep || config.levelMargin > 0 || Object.values(config.targets).some((v) => v != null)) && (
            <span className="badge">actives</span>
          )}
        </summary>

        <h3>Objectifs</h3>
        <p className="hint">Laisser vide pour les objectifs du niveau et de la classe (indiqués en gris).</p>
        <div className="num-grid">
          {targetField("pa", "PA")}
          {targetField("pm", "PM")}
          {targetField("po", "PO")}
          {targetField("invo", "Invocations")}
        </div>
        <label className="num-field wide">
          <span>Dégâts par tour minimum</span>
          <input
            type="number"
            min={0}
            step={100}
            value={config.dptMin || ""}
            placeholder="aucun"
            onChange={(e) => update({ dptMin: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <p className="hint">Les stuffs sous ce seuil sont fortement pénalisés : la survie passe après.</p>

        <label className="toggle block">
          <input type="checkbox" checked={config.deep} onChange={(e) => update({ deep: e.target.checked })} />
          <span className="switch" aria-hidden />
          Recherche approfondie
        </label>
        <p className="hint">Explore davantage de stuffs : parfois un peu meilleur, environ 1,5 fois plus long.</p>

        <label className="num-field wide">
          <span>Items jusqu'à N niveaux au-dessus</span>
          <input
            type="number"
            min={0}
            max={5}
            value={config.levelMargin || ""}
            placeholder="0"
            onChange={(e) => update({ levelMargin: Math.max(0, Math.min(5, Math.round(Number(e.target.value) || 0))) })}
          />
        </label>
        <p className="hint">Pour préparer un stuff à l'avance : quelques items un peu plus hauts peuvent beaucoup l'améliorer.</p>

        <h3>
          Items imposés <small>{lockedCount ? `${lockedCount} imposé${lockedCount > 1 ? "s" : ""}` : ""}</small>
        </h3>
        <div className="slot-picker">
          {SLOTS.map((_, i) =>
            i === FAMILIER ? null : (
              <button
                type="button"
                key={i}
                className={`slot-cell${config.locked[i] != null ? " filled" : ""}${editSlot === i ? " editing" : ""}`}
                title={config.locked[i] != null ? `${slotLabel(i)} : ${byId.get(config.locked[i]!)?.name}` : slotLabel(i)}
                onClick={() => setEditSlot(editSlot === i ? null : i)}
              >
                {config.locked[i] != null ? <ItemIcon item={byId.get(config.locked[i]!)} size={30} /> : <span className="slot-glyph">{slotLabel(i).slice(0, 2)}</span>}
              </button>
            ),
          )}
        </div>
        {editSlot != null && (
          <div className="slot-editor">
            <strong>{slotLabel(editSlot)}</strong>
            {config.locked[editSlot] != null ? (
              <div className="picked">
                <ItemIcon item={byId.get(config.locked[editSlot]!)} size={32} />
                <div>
                  <strong>{byId.get(config.locked[editSlot]!)?.name}</strong>
                </div>
                <button type="button" className="ghost" onClick={() => setLocked(editSlot, null)}>
                  Libérer
                </button>
              </div>
            ) : (
              <ItemSelect
                items={items}
                slot={SLOTS[editSlot]}
                maxLevel={config.level + config.levelMargin}
                placeholder="Chercher un item…"
                autoFocus
                onPick={(it) => {
                  setLocked(editSlot, it.id);
                  setEditSlot(null);
                }}
              />
            )}
          </div>
        )}

        <h3>
          Items bannis <small>{config.banned.length || ""}</small>
        </h3>
        <ItemSelect
          items={items}
          maxLevel={200}
          exclude={banned}
          placeholder="Bannir un item…"
          onPick={(it) => update({ banned: [...config.banned, it.id] })}
        />
        {config.banned.length > 0 && (
          <ul className="banned-list">
            {config.banned.map((id) => (
              <li key={id}>
                <ItemIcon item={byId.get(id)} size={22} />
                <span>{byId.get(id)?.name ?? `#${id}`}</span>
                <button type="button" aria-label="Retirer" onClick={() => update({ banned: config.banned.filter((x) => x !== id) })}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>

      <div className="run-bar">
        {running ? (
          <button type="button" className="run cancel" onClick={onCancel}>
            Annuler
          </button>
        ) : (
          <button type="submit" className="run" disabled={config.classId == null}>
            {config.classId == null ? "Choisis une classe" : "Optimiser"}
          </button>
        )}
      </div>
    </form>
  );
}
