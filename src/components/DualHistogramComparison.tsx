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

  return (
    <div
      style={{
        width,
        maxWidth: "100%",
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 10,
      }}
    >
      {keys.map((key) => {
        const panelWidth = Math.max(180, Math.floor(width / 2) - 16);
        const panelHeight = Math.max(110, Math.floor(height / 5));
        const innerHeight = panelHeight - 34;
        const centerX = panelWidth / 2;
        const stepWidth = Math.max(14, Math.floor((panelWidth / 2 - 24) / levels.length));

        return (
          <div
            key={key}
            style={{
              padding: "8px 8px 10px",
              borderRadius: 14,
              border: "1px solid #e2e8f0",
              background: "#fff",
            }}
          >
            <div
              style={{
                marginBottom: 6,
                fontSize: 11,
                fontWeight: 700,
                color: "#334155",
                textAlign: "center",
              }}
            >
              {senses[key]}
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
                const y = 8 + index * ((innerHeight - 6) / levels.length);
                const barHeight = Math.max(8, (innerHeight - 12) / levels.length - 3);

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
                      y={y + barHeight - 1}
                      textAnchor="middle"
                      fontSize="8"
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
