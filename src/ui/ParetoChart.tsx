// Nuage dégâts par tour / PV effectifs : le front de Pareto (du plus offensif au plus défensif) et le meilleur
// stuff de chaque élément essayé. Survol : détail ; clic : affiche le stuff.

import { useState } from "react";
import type { BuildResult } from "../engine/solver";
import type { Voie } from "../engine/voies";
import { VOIE_LABEL } from "../engine/voies";
import { buildTitle, fmt } from "./format";

export type Pick = { kind: "front" | "voie"; i: number };

interface Props {
  front: BuildResult[];
  highlighted: number;
  voieBuilds: { voie: Voie; build: BuildResult }[];
  selected: Pick;
  onSelect: (p: Pick) => void;
}

const W = 640;
const H = 300;
const M = { l: 58, r: 20, t: 18, b: 44 };

function ticks(lo: number, hi: number, n = 5) {
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

const compact = (v: number) => (v >= 10000 ? `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k` : fmt(v));

export function ParetoChart({ front, highlighted, voieBuilds, selected, onSelect }: Props) {
  const [hover, setHover] = useState<Pick | null>(null);
  const all = [...front, ...voieBuilds.map((v) => v.build)];
  const xs = all.map((b) => b.evaluation.ehp);
  const ys = all.map((b) => b.evaluation.dpt);
  const pad = (lo: number, hi: number) => {
    const d = Math.max(hi - lo, hi * 0.1);
    return [Math.max(0, lo - d * 0.12), hi + d * 0.12] as const;
  };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const sx = (v: number) => M.l + ((v - x0) / (x1 - x0)) * (W - M.l - M.r);
  const sy = (v: number) => H - M.b - ((v - y0) / (y1 - y0)) * (H - M.t - M.b);
  const pt = (b: BuildResult) => [sx(b.evaluation.ehp), sy(b.evaluation.dpt)] as const;
  const sorted = [...front].sort((a, b) => a.evaluation.ehp - b.evaluation.ehp);
  const isSel = (p: Pick) => selected.kind === p.kind && selected.i === p.i;
  const hovered = hover && (hover.kind === "front" ? front[hover.i] : voieBuilds[hover.i]?.build);

  // Étiquettes des éléments à gauche de leur point (le front passe à droite), écartées verticalement
  // quand les points sont proches.
  const voieLabelY = new Map<number, number>();
  let prev = -Infinity;
  for (const i of voieBuilds.map((_, i) => i).sort((a, b) => pt(voieBuilds[a].build)[1] - pt(voieBuilds[b].build)[1])) {
    prev = Math.max(pt(voieBuilds[i].build)[1] + 4, prev + 13);
    voieLabelY.set(i, prev);
  }

  const dot = (b: BuildResult, p: Pick, cls: string, label?: string) => {
    const [x, y] = pt(b);
    const left = p.kind === "voie";
    return (
      <g
        key={`${p.kind}${p.i}`}
        className={`mark ${cls}${isSel(p) ? " selected" : ""}`}
        onMouseEnter={() => setHover(p)}
        onMouseLeave={() => setHover(null)}
        onClick={() => onSelect(p)}
        role="button"
        tabIndex={0}
        aria-label={`${label ?? buildTitle(b)} : ${fmt(b.evaluation.dpt)} dégâts par tour, ${fmt(b.evaluation.ehp)} PV effectifs`}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(p)}
      >
        {isSel(p) && <circle className="sel-ring" cx={x} cy={y} r={10} />}
        <circle className="dot" cx={x} cy={y} r={p.kind === "front" && p.i === highlighted ? 7 : 5} />
        <circle className="hit" cx={x} cy={y} r={16} />
        {label && (
          <text className="direct-label" x={left ? x - 10 : x + 10} y={left ? voieLabelY.get(p.i) : y - 10} textAnchor={left ? "end" : "start"}>
            {label}
          </text>
        )}
      </g>
    );
  };

  let tip: { left: string; top: string; transform: string } | null = null;
  if (hovered) {
    const [x, y] = pt(hovered);
    tip = { left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, transform: `translate(${x > W * 0.6 ? "calc(-100% - 14px)" : "14px"}, -50%)` };
  }

  return (
    <figure className="pareto">
      <div className="legend">
        <span>
          <i className="swatch front" /> Front dégâts / survie
        </span>
        {voieBuilds.length > 0 && (
          <span>
            <i className="swatch voie" /> Meilleur stuff par élément
          </span>
        )}
        <span className="legend-note">★ stuff du rôle · clic pour l'afficher</span>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dégâts par tour en fonction des PV effectifs">
          {ticks(y0, y1).map((v) => (
            <g key={`y${v}`} className="grid">
              <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} />
              <text x={M.l - 8} y={sy(v)} dy="0.32em" textAnchor="end">
                {compact(v)}
              </text>
            </g>
          ))}
          {ticks(x0, x1, 6).map((v) => (
            <text key={`x${v}`} className="tick" x={sx(v)} y={H - M.b + 18} textAnchor="middle">
              {compact(v)}
            </text>
          ))}
          <line className="axis" x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
          <text className="axis-title" x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle">
            PV effectifs (survie) →
          </text>
          <text className="axis-title" transform={`translate(14 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle">
            Dégâts par tour →
          </text>
          <polyline className="front-line" points={sorted.map((b) => pt(b).join(",")).join(" ")} />
          {voieBuilds.map((v, i) => dot(v.build, { kind: "voie", i }, "voie", VOIE_LABEL[v.voie]))}
          {front.map((b, i) => dot(b, { kind: "front", i }, "front", i === highlighted ? "★" : undefined))}
        </svg>
        {hovered && tip && (
          <div className="chart-tip" style={tip}>
            <strong>{hover!.kind === "voie" ? `Meilleur stuff ${VOIE_LABEL[voieBuilds[hover!.i].voie]}` : buildTitle(hovered)}</strong>
            <dl>
              <dt>Dégâts / tour</dt>
              <dd>{fmt(hovered.evaluation.dpt)}</dd>
              <dt>PV effectifs</dt>
              <dd>{fmt(hovered.evaluation.ehp)}</dd>
              <dt>PV</dt>
              <dd>{fmt(hovered.hp)}</dd>
              {hovered.evaluation.hpt > 0 && (
                <>
                  <dt>Soins / tour</dt>
                  <dd>{fmt(hovered.evaluation.hpt)}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </div>
    </figure>
  );
}
