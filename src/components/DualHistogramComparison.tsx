import type { DistributionByTaste } from "../lib/types";

type Props = {
  senses: Record<string, string>;
  populationA: {
    label: string;
    distribution: DistributionByTaste;
  };
  populationB: {
    label: string;
    distribution: DistributionByTaste;
  };
  width?: number;
  height?: number;
  valueRange?: { min: number; max: number };
};

export default function DualHistogramComparison({
  senses,
  populationA,
  populationB,
  width = 560,
  height = 340,
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
      levels.flatMap((level) => [
        populationA.distribution[key]?.[String(level)]?.percent ?? 0,
        populationB.distribution[key]?.[String(level)]?.percent ?? 0,
      ]),
    ),
  );
  const columns = Math.min(5, Math.max(2, keys.length >= 5 ? 5 : keys.length));
  const rows = Math.ceil(keys.length / columns);
  const gap = 10;
  const panelWidth = Math.max(100, Math.floor((width - gap * (columns - 1)) / columns));
  const targetPanelHeight = Math.floor((height - gap * Math.max(rows - 1, 0)) / rows);
  const panelHeight = Math.max(44, Math.min(82, targetPanelHeight));
  const innerHeight = Math.max(22, panelHeight - 18);
  const centerX = panelWidth / 2;
  const shortLabels = width <= 180;

  return (
    <div
      style={{
        width,
        maxWidth: "100%",
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
              width: panelWidth,
              padding: "6px 6px 8px",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "#fff",
              justifySelf: "center",
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
            <svg width="100%" height={panelHeight} viewBox={`0 0 ${panelWidth} ${panelHeight}`}>
              <line
                x1={centerX}
                y1={6}
                x2={centerX}
                y2={innerHeight + 10}
                stroke="#cbd5e1"
                strokeDasharray="3 3"
              />
              {levels.map((level, index) => {
                const leftPercent =
                  populationA.distribution[key]?.[String(level)]?.percent ?? 0;
                const rightPercent =
                  populationB.distribution[key]?.[String(level)]?.percent ?? 0;
                const leftWidth = (leftPercent / maxPercent) * (panelWidth / 2 - 20);
                const rightWidth = (rightPercent / maxPercent) * (panelWidth / 2 - 20);
                const y = 4 + index * ((innerHeight - 4) / levels.length);
                const barHeight = Math.max(4, (innerHeight - 6) / levels.length - 2);

                return (
                  <g key={`${key}-${level}`}>
                    <rect
                      x={centerX - leftWidth}
                      y={y}
                      width={leftWidth}
                      height={barHeight}
                      rx={3}
                      fill="#94a3b8"
                    />
                    <rect
                      x={centerX}
                      y={y}
                      width={rightWidth}
                      height={barHeight}
                      rx={3}
                      fill="#ea580c"
                    />
                    <text
                      x={centerX}
                      y={y + barHeight - 0.5}
                      textAnchor="middle"
                      fontSize="6.5"
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
