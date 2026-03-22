import * as d3 from "d3";
import { useEffect, useId, useRef } from "react";

const MAX_CHART_SIZE = 230;
const extraMargin = 12;

type DistributionBucket = { count?: number; percent?: number };
type DistributionByTaste = Partial<
  Record<string, Record<string, DistributionBucket>>
>;
type OutliersByTaste = Partial<Record<string, number[]>>;
type MeansByTaste = Partial<Record<string, number>>;

type OutlierRadarChartProps = {
  outliers?: OutliersByTaste;
  showOutliers?: boolean;
  distribution?: DistributionByTaste;
  meanValues?: MeansByTaste;
  senses: Record<string, string>;
  size?: number;
  showLabels?: boolean;
  valueRange?: { min: number; max: number };
};

export default function OutlierRadarChart({
  outliers = {},
  showOutliers = false,
  distribution = {},
  meanValues = {},
  senses,
  size = MAX_CHART_SIZE,
  showLabels = true,
  valueRange,
}: OutlierRadarChartProps) {
  const keys = Object.keys(senses);
  const labels = keys.map((k) => senses[k]);
  const uid = useId();
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const hasDistribution = keys.some(
    (k) => Object.keys(distribution[k] ?? {}).length > 0,
  );

  useEffect(() => {
    if (tooltipRef.current) {
      tooltipRef.current.remove();
      tooltipRef.current = null;
    }

    if (!hasDistribution) return;

    const el = document.createElement("div");
    el.className = "plotchart-tooltip";
    el.style.position = "absolute";
    el.style.visibility = "hidden";
    el.style.background = "white";
    el.style.padding = "6px 10px";
    el.style.border = "1px solid #ccc";
    el.style.borderRadius = "4px";
    el.style.fontSize = "12px";
    el.style.whiteSpace = "nowrap";
    el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
    el.style.zIndex = "1000";
    document.body.appendChild(el);

    tooltipRef.current = el;

    return () => {
      el.remove();
      tooltipRef.current = null;
    };
  }, [hasDistribution]);

  const radius = size / 2;
  const labelRadius = radius + (showLabels ? Math.max(2, Math.min(5, size * 0.03)) : 0);
  const labelFontSize = showLabels ? Math.max(8, Math.min(11, size * 0.07)) : 0;
  const totalDimensions = labels.length;
  const sliceAngle = totalDimensions ? (2 * Math.PI) / totalDimensions : 0;
  const wedgeGap = 0.03;

  const inferredLevels = keys.flatMap((k) =>
    Object.keys(distribution[k] ?? {})
      .map((lvl) => Number(lvl))
      .filter((n) => Number.isFinite(n)),
  );
  const inferredMeans = keys
    .map((k) => Number(meanValues[k]))
    .filter((n) => Number.isFinite(n));
  const inferredOutliers = keys.flatMap((k) =>
    (outliers[k] ?? []).filter((n) => Number.isFinite(n)),
  );
  const inferredAll = [...inferredLevels, ...inferredMeans, ...inferredOutliers];
  const inferredMin = inferredAll.length ? Math.min(...inferredAll) : 0;
  const inferredMax = inferredAll.length ? Math.max(...inferredAll) : 5;
  const minValue = Number.isFinite(valueRange?.min) ? valueRange!.min : inferredMin;
  const maxValue = Number.isFinite(valueRange?.max) ? valueRange!.max : inferredMax;
  const safeMax = maxValue > minValue ? maxValue : minValue + 1;
  const ringCount = Math.max(1, Math.min(12, Math.ceil(safeMax - minValue)));
  const scaleRadius = d3
    .scaleLinear()
    .domain([minValue, safeMax])
    .range([0, radius])
    .clamp(true);

  function buildArcPath(
    startAngle: number,
    endAngle: number,
    innerR: number,
    outerR: number,
  ) {
    return d3
      .arc()
      .innerRadius(innerR)
      .outerRadius(outerR)
      .startAngle(startAngle)
      .endAngle(endAngle)({} as d3.DefaultArcObject);
  }

  function renderDistributionArcs() {
    return keys.flatMap((key, i) => {
      const dist = distribution[key] || {};
      const outLevels = outliers[key] || [];

      const numericLevels = Object.entries(dist).filter(
        ([level]) => !Number.isNaN(Number(level)),
      );

      const total = numericLevels.reduce(
        (sum, [, entry]) => sum + (entry?.count ?? 0),
        0,
      );

      const angleStart = i * sliceAngle + wedgeGap / 2;
      const angleEnd = (i + 1) * sliceAngle - wedgeGap / 2;

      return numericLevels.map(([level, entry]) => {
        const countVal = entry?.count ?? 0;
        const opacity = total > 0 ? countVal / total : 0;

        const ringStart = scaleRadius(Number(level));
        const ringEnd = scaleRadius(Number(level) + 1);

        const isOutlier = showOutliers && outLevels.includes(Number(level));
        const color = isOutlier ? "#0044ff" : "#FFA500";

        const pathData = buildArcPath(angleStart, angleEnd, ringStart, ringEnd);

        return (
          <path
            key={`${key}-${level}`}
            d={pathData ?? ""}
            fill={color}
            fillOpacity={opacity}
            stroke="#F8F9FA"
            strokeWidth={1}
            onMouseOver={() => {
              const mean = meanValues[key] ?? 0;
              const votesLines = numericLevels
                .map(([lvl, ent]) => `${lvl}: ${ent.count ?? 0} votes`)
                .join("<br>");

              const tip = tooltipRef.current;
              if (!tip) return;

              tip.style.visibility = "visible";
              tip.innerHTML = `<strong>${senses[key]}</strong><br>
                  Mean: ${mean.toFixed(2)}<br>
                  ${votesLines}`;
            }}
            onMouseMove={(event) => {
              const tip = tooltipRef.current;
              if (!tip) return;

              tip.style.left = `${event.pageX + 12}px`;
              tip.style.top = `${event.pageY + 12}px`;
            }}
            onMouseLeave={() => {
              if (tooltipRef.current)
                tooltipRef.current.style.visibility = "hidden";
            }}
            style={{ cursor: "pointer" }}
          />
        );
      });
    });
  }

  function renderCurvedLabels() {
    return labels.map((label, i) => {
      const angleStart = (i + 1) * sliceAngle - wedgeGap;
      const angleEnd = i * sliceAngle + wedgeGap;

      const arcPath = buildArcPath(
        angleEnd - 0.34,
        angleStart + 0.1,
        labelRadius,
        labelRadius,
      );
      const arcId = `${uid}-labelArc-${i}`;

      if (!showLabels) return null;

      return (
        <g key={`label-${i}`}>
          <defs>
            <path id={arcId} d={arcPath ?? ""} fill="none" />
          </defs>
          <text fontSize={labelFontSize} fill="#333">
            <textPath href={`#${arcId}`} startOffset="30%" textAnchor="middle">
              {label}
            </textPath>
          </text>
        </g>
      );
    });
  }

  function renderOutline() {
    const pathElements: React.ReactElement[] = [];

    keys.forEach((key, i) => {
      const mean = meanValues[key] ?? minValue;
      const r = scaleRadius(mean);
      const angleStart = i * sliceAngle;
      const angleEnd = (i + 1) * sliceAngle;

      const arcPath = d3
        .arc()
        .innerRadius(r)
        .outerRadius(r)
        .startAngle(angleStart)
        .endAngle(angleEnd)({} as d3.DefaultArcObject);

      pathElements.push(
        <path
          key={`arc-${i}`}
          d={arcPath ?? ""}
          stroke="red"
          strokeWidth={2}
          fill="none"
        />,
      );

      const nextKey = keys[(i + 1) % keys.length];
      const nextMean = meanValues[nextKey] ?? minValue;
      const rNext = scaleRadius(nextMean);
      const angleOffset = 11;
      const dividerAngle = (i + 1) * sliceAngle + angleOffset;

      const x1 = r * Math.cos(dividerAngle);
      const y1 = r * Math.sin(dividerAngle);
      const x2 = rNext * Math.cos(dividerAngle);
      const y2 = rNext * Math.sin(dividerAngle);

      pathElements.push(
        <line
          key={`divider-${i}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="red"
          strokeWidth={2}
        />,
      );
    });

    return <g>{pathElements}</g>;
  }

  return (
    <div style={{ textAlign: "center", padding: "0px" }}>
      <svg
        width={size + extraMargin * 2}
        height={size + extraMargin * 2}
        viewBox={`-${labelRadius + extraMargin} -${labelRadius + extraMargin} ${
          (labelRadius + extraMargin) * 2
        } ${(labelRadius + extraMargin) * 2}`}
      >
        {renderDistributionArcs()}
        {Array.from({ length: ringCount }, (_, idx) => {
          const r = ((idx + 1) / ringCount) * radius;
          const circlePath = d3
            .arc()
            .innerRadius(r)
            .outerRadius(r)
            .startAngle(0)
            .endAngle(2 * Math.PI)({} as d3.DefaultArcObject);
          return (
            <path
              key={`grid-${idx}`}
              d={circlePath ?? ""}
              stroke="#999"
              strokeOpacity={0.2}
              fill="none"
            />
          );
        })}
        {renderOutline()}
        {renderCurvedLabels()}
      </svg>
    </div>
  );
}
