import type { MeansByTaste } from "../lib/types";

type Props = {
  senses: Record<string, string>;
  meanValues: MeansByTaste;
  width?: number;
  height?: number;
  valueRange?: { min: number; max: number };
};

export default function GroupedBarChart({
  senses,
  meanValues,
  width = 560,
  height = 280,
  valueRange = { min: 0, max: 5 },
}: Props) {
  const keys = Object.keys(senses);
  const margin = { top: 20, right: 16, bottom: 56, left: 36 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const band = innerWidth / Math.max(1, keys.length);

  return (
    <svg width={width} height={height} aria-label="Grouped bar chart">
      <g transform={`translate(${margin.left},${margin.top})`}>
        {Array.from({ length: valueRange.max - valueRange.min + 1 }).map(
          (_, idx) => {
            const value = valueRange.min + idx;
            const y =
              innerHeight -
              ((value - valueRange.min) / (valueRange.max - valueRange.min)) *
                innerHeight;
            return (
              <g key={value}>
                <line
                  x1={0}
                  y1={y}
                  x2={innerWidth}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray="4 4"
                />
                <text x={-10} y={y + 4} fontSize="11" textAnchor="end">
                  {value}
                </text>
              </g>
            );
          },
        )}

        {keys.map((key, idx) => {
          const value = meanValues[key] ?? 0;
          const barHeight =
            ((value - valueRange.min) / (valueRange.max - valueRange.min)) *
            innerHeight;
          const x = idx * band + band * 0.15;
          const y = innerHeight - barHeight;
          const barWidth = band * 0.7;

          return (
            <g key={key}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={8}
                fill="#f59e0b"
              />
              <text
                x={x + barWidth / 2}
                y={y - 8}
                fontSize="11"
                textAnchor="middle"
                fill="#7c2d12"
              >
                {value.toFixed(2)}
              </text>
              <text
                x={x + barWidth / 2}
                y={innerHeight + 18}
                fontSize="10"
                textAnchor="middle"
                fill="#334155"
                transform={`rotate(20 ${x + barWidth / 2} ${innerHeight + 18})`}
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
