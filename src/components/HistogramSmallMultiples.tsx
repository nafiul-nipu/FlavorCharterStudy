import type { DistributionByTaste } from "../lib/types";

type Props = {
  senses: Record<string, string>;
  distribution: DistributionByTaste;
  width?: number;
  height?: number;
  valueRange?: { min: number; max: number };
};

export default function HistogramSmallMultiples({
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
  const maxPercent = Math.max(
    1,
    ...keys.flatMap((key) =>
      levels.map((level) => distribution[key]?.[String(level)]?.percent ?? 0),
    ),
  );
  const columns = Math.min(5, Math.max(2, keys.length >= 5 ? 5 : keys.length));
  const rows = Math.ceil(keys.length / columns);
  const gap = 10;
  const panelViewWidth = width <= 180 ? 78 : width <= 320 ? 88 : 96;
  const targetPanelHeight = Math.floor((height - gap * Math.max(rows - 1, 0)) / rows);
  const panelHeight = Math.max(42, Math.min(82, targetPanelHeight));
  const innerHeight = Math.max(20, panelHeight - 18);
  const chartLeft = 0;
  const barGap = 0;
  const usableWidth = panelViewWidth;
  const barWidth = Math.max(
    4,
    Math.floor((usableWidth - barGap * (levels.length - 1)) / levels.length),
  );
  const shortLabels = width <= 180;

  return (
    <div
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap,
      }}
    >
      {keys.map((key) => {
        return (
          <div
            key={key}
            style={{
              width: "100%",
              minWidth: 0,
              padding: "2px 0 4px",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "#fff",
            }}
          >
            <div
              style={{
                marginBottom: 2,
                fontSize: 8,
                fontWeight: 700,
                color: "#334155",
                textAlign: "center",
                lineHeight: 1.15,
              }}
            >
              {shortLabels ? senses[key].slice(0, 3) : senses[key]}
            </div>
            <svg
              width="100%"
              height={panelHeight}
              viewBox={`0 0 ${panelViewWidth} ${panelHeight}`}
              preserveAspectRatio="none"
            >
              {levels.map((level, index) => {
                const percent = distribution[key]?.[String(level)]?.percent ?? 0;
                const barHeight = (percent / maxPercent) * innerHeight;
                const x = chartLeft + index * (barWidth + barGap);
                const y = innerHeight - barHeight + 2;
                return (
                  <g key={`${key}-${level}`}>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      rx={2}
                      fill="#0f766e"
                      fillOpacity={0.82}
                    />
                    <text
                      x={x + barWidth / 2}
                      y={panelHeight - 2}
                      textAnchor="middle"
                      fontSize="5.5"
                      fill="#475569"
                    >
                      {level}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
