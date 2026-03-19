import * as d3 from "d3";
import type { DistributionByTaste } from "../lib/types";

type Props = {
  senses: Record<string, string>;
  distribution: DistributionByTaste;
  width?: number;
  height?: number;
  valueRange?: { min: number; max: number };
};

function violinPath(
  levels: number[],
  widths: number[],
  xCenter: number,
  yScale: d3.ScaleLinear<number, number>,
) {
  const leftPoints = levels.map((level, index) => [
    xCenter - widths[index],
    yScale(level),
  ]) as [number, number][];
  const rightPoints = levels
    .slice()
    .reverse()
    .map((level, reverseIndex) => {
      const index = levels.length - 1 - reverseIndex;
      return [xCenter + widths[index], yScale(level)] as [number, number];
    });

  return d3
    .line<[number, number]>()
    .curve(d3.curveCatmullRomClosed.alpha(0.5))([...leftPoints, ...rightPoints]);
}

export default function ViolinPlot({
  senses,
  distribution,
  width = 560,
  height = 300,
  valueRange = { min: 0, max: 5 },
}: Props) {
  const keys = Object.keys(senses);
  const margin = { top: 18, right: 20, bottom: 58, left: 40 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const xBand = innerWidth / Math.max(1, keys.length);
  const levels = Array.from(
    { length: valueRange.max - valueRange.min + 1 },
    (_, index) => valueRange.min + index,
  );

  const maxCount = Math.max(
    1,
    ...keys.flatMap((key) =>
      levels.map((level) => distribution[key]?.[String(level)]?.count ?? 0),
    ),
  );

  const yScale = d3
    .scaleLinear()
    .domain([valueRange.min, valueRange.max])
    .range([innerHeight, 0]);

  const widthScale = d3
    .scaleLinear()
    .domain([0, maxCount])
    .range([0, xBand * 0.34]);

  return (
    <svg width={width} height={height} aria-label="Violin plot">
      <g transform={`translate(${margin.left},${margin.top})`}>
        {levels.map((level) => {
          const y = yScale(level);
          return (
            <g key={`grid-${level}`}>
              <line
                x1={0}
                y1={y}
                x2={innerWidth}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="4 4"
              />
              <text x={-10} y={y + 4} fontSize="11" textAnchor="end" fill="#475569">
                {level}
              </text>
            </g>
          );
        })}

        {keys.map((key, index) => {
          const centerX = index * xBand + xBand / 2;
          const counts = levels.map(
            (level) => distribution[key]?.[String(level)]?.count ?? 0,
          );
          const widths = counts.map((count) => widthScale(count));
          const path = violinPath(levels, widths, centerX, yScale) ?? "";

          return (
            <g key={key}>
              <line
                x1={centerX}
                y1={0}
                x2={centerX}
                y2={innerHeight}
                stroke="#cbd5e1"
              />
              <path
                d={path}
                fill="rgba(14, 165, 233, 0.24)"
                stroke="#0284c7"
                strokeWidth={2}
              />
              <circle
                cx={centerX}
                cy={yScale(
                  levels.reduce((bestLevel, level) =>
                    (distribution[key]?.[String(level)]?.count ?? 0) >
                    (distribution[key]?.[String(bestLevel)]?.count ?? 0)
                      ? level
                      : bestLevel,
                  valueRange.min,
                  ),
                )}
                r={3}
                fill="#0369a1"
              />
              <text
                x={centerX}
                y={innerHeight + 18}
                fontSize="10"
                textAnchor="middle"
                fill="#334155"
                transform={`rotate(20 ${centerX} ${innerHeight + 18})`}
              >
                {senses[key]}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
