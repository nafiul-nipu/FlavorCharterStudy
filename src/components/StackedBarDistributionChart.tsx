import type { DistributionByTaste } from "../lib/types";

type Props = {
  senses: Record<string, string>;
  distribution: DistributionByTaste;
  width?: number;
  height?: number;
  valueRange?: { min: number; max: number };
};

const LEVEL_COLORS = [
  "#fef3c7",
  "#fde68a",
  "#fcd34d",
  "#f59e0b",
  "#d97706",
  "#92400e",
];

export default function StackedBarDistributionChart({
  senses,
  distribution,
  width = 560,
  height = 320,
  valueRange = { min: 0, max: 5 },
}: Props) {
  const keys = Object.keys(senses);
  const levels = Array.from(
    { length: valueRange.max - valueRange.min + 1 },
    (_, index) => valueRange.min + index,
  );
  const margin = {
    top: 8,
    right: 0,
    bottom: 8,
    left: width <= 180 ? 42 : width <= 260 ? 54 : 72,
  };
  const innerWidth = width - margin.left - margin.right;
  const rowHeight = Math.max(
    8,
    Math.floor((height - margin.top - margin.bottom) / keys.length),
  );
  const labelSize = width <= 180 ? 6.5 : width <= 260 ? 7.5 : 9;
  const shortLabels = width <= 180;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-label="Stacked distribution bars"
    >
      <g transform={`translate(${margin.left},${margin.top})`}>
        {keys.map((key, rowIndex) => {
          const y = rowIndex * rowHeight;
          let currentX = 0;

          return (
            <g key={key}>
              <text
                x={-6}
                y={y + rowHeight * 0.62}
                textAnchor="end"
                fontSize={labelSize}
                fill="#334155"
              >
                {shortLabels ? senses[key].slice(0, 3) : senses[key]}
              </text>
              {levels.map((level) => {
                const percent = distribution[key]?.[String(level)]?.percent ?? 0;
                const segmentWidth = (percent / 100) * innerWidth;
                const rect = (
                  <rect
                    key={`${key}-${level}`}
                    x={currentX}
                    y={y + 1}
                    width={segmentWidth}
                    height={Math.max(6, rowHeight - 2)}
                    fill={LEVEL_COLORS[level] ?? LEVEL_COLORS[LEVEL_COLORS.length - 1]}
                    stroke="rgba(255,255,255,0.8)"
                    strokeWidth={0.8}
                  />
                );
                currentX += segmentWidth;
                return rect;
              })}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
