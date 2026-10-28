// Fiche de calibration : tests à faire en jeu pour trancher les règles incertaines du moteur (rules.ts).
// Les réponses qui correspondent à une règle sont appliquées aux calculs suivants ; les autres sont notées.

import { useState } from "react";
import { DEFAULT_RULES, type Rules } from "../engine/rules";
import type { Calibration as Cal } from "./config";
import { fmt } from "./format";

interface Props {
  calibration: Cal;
  onChange: (c: Cal) => void;
}

type Opt<T> = { value: T; label: string; detail: string; engine?: boolean };

function Choice<T extends string | boolean>({ name, value, options, onChange }: { name: string; value: T; options: Opt<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="choices" role="radiogroup">
      {options.map((o) => (
        <label key={String(o.value)} className={`choice${value === o.value ? " on" : ""}`}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            <strong>{o.label}</strong>
            {o.engine && <em className="engine-tag">hypothèse par défaut</em>}
            <small>{o.detail}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

function Test({ n, title, children, status }: { n: number; title: string; children: React.ReactNode; status?: string }) {
  return (
    <section className="card test">
      <header>
        <span className="test-n">{n}</span>
        <h3>{title}</h3>
        {status && <span className="test-status">{status}</span>}
      </header>
      {children}
    </section>
  );
}

/** Calculatrice du test de dégâts : fourchette prévue selon l'ordre des multiplicateurs. */
function DamageCalc({ notes, setNote }: { notes: Record<string, string>; setNote: (k: string, v: string) => void }) {
  const [v, setV] = useState({ min: 20, max: 24, carac: 500, puissance: 100, do: 20, doElem: 10, pctSorts: 0 });
  const field = (k: keyof typeof v, label: string) => (
    <label className="num-field">
      <span>{label}</span>
      <input type="number" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) || 0 })} />
    </label>
  );
  const mult = (100 + v.carac + v.puissance) / 100;
  const s = 1 + v.pctSorts / 100;
  const a = (j: number) => Math.floor((j * mult + v.do + v.doElem) * s);
  const b = (j: number) => Math.floor(j * mult * s) + v.do + v.doElem;
  return (
    <>
      <div className="num-grid six">
        {field("min", "Jet min du sort")}
        {field("max", "Jet max du sort")}
        {field("carac", "Carac. de l'élément")}
        {field("puissance", "Puissance")}
        {field("do", "Dommages")}
        {field("doElem", "Dommages de l'élément")}
        {field("pctSorts", "% dommages aux sorts")}
      </div>
      <div className="predictions">
        <div className="prediction">
          <span>Hypothèse A (moteur)</span>
          <strong>
            {fmt(a(v.min))} à {fmt(a(v.max))}
          </strong>
          <small>les % multiplient aussi les dommages fixes</small>
        </div>
        <div className="prediction">
          <span>Hypothèse B</span>
          <strong>
            {fmt(b(v.min))} à {fmt(b(v.max))}
          </strong>
          <small>les % ne multiplient que le jet</small>
        </div>
      </div>
      {v.pctSorts === 0 && <p className="hint">Sans % de dommages aux sorts, les deux hypothèses coïncident : refais le test avec un item qui en donne.</p>}
      <label className="note-field">
        <span>Fourchette relevée en jeu</span>
        <input value={notes.damage ?? ""} placeholder="ex. 812 à 905 avec 15 % sorts" onChange={(e) => setNote("damage", e.target.value)} />
      </label>
    </>
  );
}

export function Calibration({ calibration, onChange }: Props) {
  const rules: Rules = { ...DEFAULT_RULES, ...calibration.rules };
  const setRule = <K extends keyof Rules>(k: K, value: Rules[K]) => {
    const next = { ...calibration.rules, [k]: value };
    if (DEFAULT_RULES[k] === value) delete next[k];
    onChange({ ...calibration, rules: next });
  };
  const setNote = (k: string, value: string) => onChange({ ...calibration, notes: { ...calibration.notes, [k]: value } });
  const changed = Object.keys(calibration.rules) as (keyof Rules)[];
  const num = (k: "capPA" | "capPM" | "capPO" | "resCap" | "pointsPerLevel", label: string) => (
    <label className="num-field">
      <span>{label}</span>
      <input type="number" min={0} value={rules[k]} onChange={(e) => setRule(k, Number(e.target.value) || DEFAULT_RULES[k])} />
    </label>
  );

  return (
    <div className="calibration">
      <header className="cal-head">
        <div>
          <h2>Calibration en jeu</h2>
          <p>
            Certaines règles de Dofus 3 ne sont publiées nulle part : le moteur les traite comme des paramètres. Chaque test ci-dessous se fait en
            quelques minutes avec ton personnage (idéalement sur un Poutch, qui n'a aucune résistance). Tes réponses sont appliquées aux calculs
            suivants.
          </p>
        </div>
        <div className={`card rules-state${changed.length ? " modified" : ""}`}>
          <strong>{changed.length ? `${changed.length} règle${changed.length > 1 ? "s" : ""} modifiée${changed.length > 1 ? "s" : ""}` : "Règles par défaut"}</strong>
          <small>
            {changed.length ? changed.map((k) => `${k} = ${String(calibration.rules[k])}`).join(" · ") : "issues des guides et des simulateurs existants"}
          </small>
          {changed.length > 0 && (
            <button type="button" className="ghost" onClick={() => onChange({ ...calibration, rules: {} })}>
              Rétablir
            </button>
          )}
        </div>
      </header>

      <Test n={1} title="Formule de dégâts et ordre des multiplicateurs" status={calibration.notes.damage ? "noté" : undefined}>
        <ol className="steps">
          <li>Ouvre ta fiche de caractéristiques et note la carac. de l'élément d'un sort simple (une seule ligne de dégâts), la Puissance, les Dommages et les Dommages de l'élément.</li>
          <li>Note le jet de base du sort dans l'encyclopédie (niveau du sort actuel).</li>
          <li>Compare avec la fourchette affichée dans l'infobulle du sort en combat, ou relève 5 à 10 coups sur un Poutch.</li>
          <li>Recommence en équipant un item avec des % de dommages aux sorts pour départager A et B.</li>
        </ol>
        <DamageCalc notes={calibration.notes} setNote={setNote} />
      </Test>

      <Test n={2} title="Condition « PA < 12 » des items qui donnent des PA" status={calibration.notes.condPA ? "noté" : undefined}>
        <ol className="steps">
          <li>Monte à exactement 11 PA avec ton équipement.</li>
          <li>Équipe un item qui donne +1 PA et qui a la condition « PA &lt; 12 » (visible dans son infobulle).</li>
        </ol>
        <Choice
          name="condPA"
          value={(calibration.notes.condPA ?? "") as string}
          onChange={(v) => setNote("condPA", v)}
          options={[
            { value: "refusé", label: "L'item est refusé ou se déséquipe", detail: "la condition compte le PA de l'item lui-même", engine: true },
            { value: "accepté", label: "L'item reste équipé (12 PA)", detail: "la condition ignore le PA de l'item : dis-le moi, le moteur sera corrigé" },
          ]}
        />
      </Test>

      <Test n={3} title="Plafonds de PA, PM, PO et exos" status={changed.some((k) => k.startsWith("cap")) ? "appliqué" : undefined}>
        <ol className="steps">
          <li>Avec un stuff qui dépasse 12 PA (ou 6 PM), regarde la valeur affichée sur la fiche et le nombre de PA en combat.</li>
          <li>Équipe deux items exo PA : vérifie si les deux comptent.</li>
        </ol>
        <div className="num-grid">
          {num("capPA", "Plafond PA")}
          {num("capPM", "Plafond PM")}
          {num("capPO", "Plafond PO")}
          {num("resCap", "Plafond % rés.")}
        </div>
        <Choice
          name="exo"
          value={(calibration.notes.exo ?? "") as string}
          onChange={(v) => setNote("exo", v)}
          options={[
            { value: "un", label: "Un seul exo de chaque compte", detail: "le second exo PA n'apporte rien", engine: true },
            { value: "tous", label: "Tous les exos comptent", detail: "à me signaler : le moteur limite aujourd'hui à un exo de chaque" },
          ]}
        />
      </Test>

      <Test n={4} title="Coût des points de caractéristique" status={calibration.notes.costs ? "noté" : undefined}>
        <ol className="steps">
          <li>Dans la fiche, regarde le coût affiché pour monter une caractéristique élémentaire à 100, 200, 300 et au-delà.</li>
          <li>Vérifie le nombre de points gagnés par niveau.</li>
        </ol>
        <div className="num-grid">{num("pointsPerLevel", "Points par niveau")}</div>
        <label className="note-field">
          <span>Coûts relevés</span>
          <input value={calibration.notes.costs ?? ""} placeholder="ex. Force : 1 jusqu'à 100, 2 jusqu'à 200…" onChange={(e) => setNote("costs", e.target.value)} />
        </label>
      </Test>

      <Test n={5} title="Héritage des stats par les invocations" status={calibration.notes.summon ? "noté" : undefined}>
        <ol className="steps">
          <li>Invoque une créature et note ses stats (survol en combat).</li>
          <li>Ajoute +100 dans une caractéristique (item ou parchemin), réinvoque et compare.</li>
        </ol>
        <label className="note-field">
          <span>Part héritée relevée</span>
          <input value={calibration.notes.summon ?? ""} placeholder="ex. +100 Terre → +30 Terre sur le Bouftou (30 %)" onChange={(e) => setNote("summon", e.target.value)} />
        </label>
      </Test>

      <Test n={6} title="Condition des trophées : « Bonus de panoplies »" status={calibration.rules.setBonusCount ? "appliqué" : undefined}>
        <ol className="steps">
          <li>Équipe une panoplie à 3 pièces et un trophée qui demande « Bonus de panoplies &lt; 2 ».</li>
          <li>Si le trophée reste actif, une panoplie compte pour 1 ; s'il se désactive, chaque pièce au-delà de la première compte.</li>
        </ol>
        <Choice
          name="setBonusCount"
          value={rules.setBonusCount}
          onChange={(v) => setRule("setBonusCount", v)}
          options={[
            { value: "piecesMinusOne", label: "Pièces − 1 par panoplie", detail: "3 pièces = 2 bonus : le trophée se désactive", engine: DEFAULT_RULES.setBonusCount === "piecesMinusOne" },
            { value: "sets", label: "Une par panoplie", detail: "3 pièces = 1 bonus : le trophée reste actif", engine: DEFAULT_RULES.setBonusCount === "sets" },
          ]}
        />
      </Test>

      <Test n={7} title="Soins et Puissance" status={calibration.rules.healUsesPower != null ? "appliqué" : undefined}>
        <ol className="steps">
          <li>Note les soins d'un sort de soin, puis équipe un item qui donne de la Puissance (sans Intelligence) et compare.</li>
        </ol>
        <Choice
          name="heal"
          value={rules.healUsesPower}
          onChange={(v) => setRule("healUsesPower", v)}
          options={[
            { value: false, label: "Les soins ne bougent pas", detail: "la Puissance n'augmente pas les soins", engine: !DEFAULT_RULES.healUsesPower },
            { value: true, label: "Les soins augmentent", detail: "la Puissance compte comme de l'Intelligence pour les soins", engine: DEFAULT_RULES.healUsesPower },
          ]}
        />
      </Test>
    </div>
  );
}
