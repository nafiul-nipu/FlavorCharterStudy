import * as d3 from "d3";
import type { MeansByTaste } from "../lib/types";

type Props = {
  senses: Record<string, string>;
  baselineMean: MeansByTaste;
  compareMean: MeansByTaste;
  size?: number;
  valueRange?: { min: number; max: number };
};

function buildPath(
  keys: string[],
  values: MeansByTaste,
  radius: number,
  scale: d3.ScaleLinear<number, number>,
) {
  const angleSlice = (Math.PI * 2) / Math.max(1, keys.length);
  const points = keys.map((key, index) => {
    const angle = angleSlice * index - Math.PI / 2;
    const r = scale(values[key] ?? 0);
    return [r * Math.cos(angle), r * Math.sin(angle)] as [number, number];
  });

  return (
    d3
      .line<[number, number]>()
      .curve(d3.curveLinearClosed)(points) ?? ""
  );
}

export default function OverlaidRadarChart({
  senses,
  baselineMean,
  compareMean,
  size = 260,
  valueRange = { min: 0, max: 5 },
}: Props) {
  const keys = Object.keys(senses);
  const radius = size / 2;
  const outerRadius = radius * 0.74;
  const horizontalMargin = 22;
  const topMargin = 26;
  const bottomMargin = 40;
  const angleSlice = (Math.PI * 2) / Math.max(1, keys.length);
  const levels = 5;
  const scale = d3
    .scaleLinear()
    .domain([valueRange.min, valueRange.max])
    .range([0, outerRadius]);

  const baselinePath = buildPath(keys, baselineMean, radius, scale);
  const comparePath = buildPath(keys, compareMean, radius, scale);

  return (
    <svg
      width={size + horizontalMargin * 2}
      height={size + topMargin + bottomMargin}
      viewBox={`${-radius - horizontalMargin} ${-radius - topMargin} ${
        size + horizontalMargin * 2
      } ${size + topMargin + bottomMargin}`}
      aria-label="Overlaid radar chart"
    >
      <g transform="translate(0,-18)">
        {Array.from({ length: levels }).map((_, idx) => {
          const r = ((idx + 1) / levels) * outerRadius;
          return (
            <circle key={idx} cx={0} cy={0} r={r} fill="none" stroke="#e2e8f0" />
          );
        })}

        {keys.map((key, index) => {
          const angle = angleSlice * index - Math.PI / 2;
          const x = outerRadius * 1.08 * Math.cos(angle);
          const y = outerRadius * 1.08 * Math.sin(angle);
          const lx = outerRadius * 1.22 * Math.cos(angle);
          const ly = outerRadius * 1.22 * Math.sin(angle);
          return (
            <g key={key}>
              <line x1={0} y1={0} x2={x} y2={y} stroke="#cbd5e1" />
              <text
                x={lx}
                y={ly}
                fontSize="10"
                textAnchor={lx > 8 ? "start" : lx < -8 ? "end" : "middle"}
                dominantBaseline={ly > 8 ? "hanging" : ly < -8 ? "auto" : "middle"}
                fill="#334155"
              >
                {senses[key]}
              </text>
            </g>
          );
        })}

        <path
          d={baselinePath}
          fill="rgba(100, 116, 139, 0.18)"
          stroke="#475569"
          strokeWidth={2}
        />
        <path
          d={comparePath}
          fill="rgba(249, 115, 22, 0.2)"
          stroke="#c2410c"
          strokeWidth={2}
        />
      </g>

      <g transform={`translate(${-60}, ${outerRadius + 64})`}>
        <rect x={0} y={0} width={12} height={12} fill="#94a3b8" />
        <text x={18} y={10} fontSize="12" fill="#334155">
          Baseline
        </text>
        <rect x={88} y={0} width={12} height={12} fill="#fb923c" />
        <text x={106} y={10} fontSize="12" fill="#334155">
          Subgroup
        </text>
      </g>
    </svg>
  );
}
