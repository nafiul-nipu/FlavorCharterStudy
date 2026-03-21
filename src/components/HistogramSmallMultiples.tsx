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
        const panelHeight = Math.max(110, Math.floor(height / 5));
        const innerHeight = panelHeight - 34;
        const barWidth = Math.max(10, Math.floor((width / 2 - 34) / levels.length) - 4);

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
            <svg width="100%" height={panelHeight} viewBox={`0 0 ${barWidth * levels.length + 36} ${panelHeight}`}>
              {levels.map((level, index) => {
                const percent = distribution[key]?.[String(level)]?.percent ?? 0;
                const barHeight = (percent / maxPercent) * innerHeight;
                const x = 24 + index * barWidth;
                const y = innerHeight - barHeight + 8;
                return (
                  <g key={`${key}-${level}`}>
                    <rect
                      x={x + 2}
                      y={y}
                      width={barWidth - 4}
                      height={barHeight}
                      rx={4}
                      fill="#0f766e"
                      fillOpacity={0.82}
                    />
                    <text
                      x={x + barWidth / 2}
                      y={panelHeight - 6}
                      textAnchor="middle"
                      fontSize="9"
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
