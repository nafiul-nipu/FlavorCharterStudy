import * as d3 from "d3";
import { useEffect, useRef } from "react";

const extraMargin = 20;

type Means = Partial<Record<string, number>>;
type Stdevs = Partial<Record<string, number>>;

type ZGlyphProps = {
  senses: Record<string, string>;
  baselineMean?: Means;
  baselineStDev?: Stdevs;
  compareMean?: Means;
  size?: number;
};

export default function ZGlyph({
  senses,
  baselineMean = {},
  baselineStDev = {},
  compareMean = {},
  size = 200,
}: ZGlyphProps) {
  const keys = Object.keys(senses);
  const labels = keys.map((k) => senses[k]);

  const radius = size / 2;
  const levels = 5;
  const totalDimensions = keys.length;
  const sliceAngle = totalDimensions ? (2 * Math.PI) / totalDimensions : 0;
  const wedgeGap = 0;

  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
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
  }, []);

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

  function renderCurvedLabels() {
    const labelRadius = radius + 5;
    return labels.map((label, i) => {
      const angleStart = (i + 1) * sliceAngle - wedgeGap;
      const angleEnd = i * sliceAngle + wedgeGap;
      const arcPath = buildArcPath(
        angleEnd - 0.1,
        angleStart + 0.1,
        labelRadius,
        labelRadius,
      );
      const arcId = `zglyph-labelArc-${i}`;

      return (
        <g key={`label-${i}`}>
          <defs>
            <path id={arcId} d={arcPath ?? ""} fill="none" />
          </defs>
          <text fontSize="12" fill="#333">
            <textPath href={`#${arcId}`} startOffset="30%" textAnchor="middle">
              {label}
            </textPath>
          </text>
        </g>
      );
    });
  }

  function renderZPoints() {
    const baselineLevel = 4;
    const minLevel = 3;
    const maxLevel = 5;
    const levelRadius = (lvl: number) => (lvl / levels) * radius;
    const maxDeviation = 3;

    return keys.map((key, i) => {
      const base = baselineMean[key] ?? 0;
      const comp = compareMean[key] ?? 0;
      const sd = baselineStDev[key] ?? 1;
      const z = sd !== 0 ? (comp - base) / sd : 0;

      const clamped = Math.max(-maxDeviation, Math.min(maxDeviation, z));
      const t = clamped / maxDeviation;
      const targetLevel = baselineLevel + t;
      const finalLevel = Math.max(minLevel, Math.min(maxLevel, targetLevel));

      const r = levelRadius(finalLevel);
      const angle = i * sliceAngle + sliceAngle / 2 + 11;
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);

      return (
        <circle
          key={`zpoint-${i}`}
          cx={x}
          cy={y}
          r={3}
          fill={t >= 0 ? "#d9534f" : "#0275d8"}
          onMouseOver={() => {
            const tip = tooltipRef.current;
            if (!tip) return;
            tip.style.visibility = "visible";
            tip.innerHTML = `<strong>${senses[key]}</strong><br>
    Baseline: ${base.toFixed(2)}<br>
    Group: ${comp.toFixed(2)}<br>
    Δ: ${(comp - base).toFixed(2)}<br>
    z: ${z.toFixed(2)}`;
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
  }

  function renderZCurve() {
    const baselineLevel = 4;
    const minLevel = 3;
    const maxLevel = 5;
    const levelRadius = (lvl: number) => (lvl / levels) * radius;
    const maxDeviation = 3;

    const points: [number, number][] = keys.map((key, i) => {
      const base = baselineMean[key] ?? 0;
      const comp = compareMean[key] ?? 0;
      const sd = baselineStDev[key] ?? 1;
      const z = sd !== 0 ? (comp - base) / sd : 0;

      const clamped = Math.max(-maxDeviation, Math.min(maxDeviation, z));
      const t = clamped / maxDeviation;
      const targetLevel = baselineLevel + t;
      const finalLevel = Math.max(minLevel, Math.min(maxLevel, targetLevel));
      const r = levelRadius(finalLevel);
      const angle = i * sliceAngle + sliceAngle / 2 + 11;

      return [r * Math.cos(angle), r * Math.sin(angle)];
    });

    const lineGen = d3
      .line<[number, number]>()
      .curve(d3.curveCardinalClosed.tension(0.1));
    const pathData = lineGen(points) ?? "";

    return (
      <path
        d={pathData}
        fill="none"
        stroke="#444"
        strokeWidth={1}
        opacity={0.9}
      />
    );
  }

  function renderZFill() {
    const baselineLevel = 4;
    const baselineR = (baselineLevel / levels) * radius;
    const maxDeviation = 3;
    const levelRadius = (lvl: number) => (lvl / levels) * radius;

    const segments = keys.map((key, i) => {
      const base = baselineMean[key] ?? 0;
      const comp = compareMean[key] ?? 0;
      const sd = baselineStDev[key] ?? 1;
      const z = sd !== 0 ? (comp - base) / sd : 0;

      const clamped = Math.max(-maxDeviation, Math.min(maxDeviation, z));
      const t = clamped / maxDeviation;

      const finalLevel = baselineLevel + t;
      const r = levelRadius(finalLevel);
      const angle = i * sliceAngle + sliceAngle / 2;

      return { angle, r };
    });

    const area = d3
      .areaRadial<{ angle: number; r: number }>()
      .curve(d3.curveCardinalClosed.tension(0.1))
      .angle((d) => d.angle);

    const positivePath =
      area.innerRadius(baselineR).outerRadius((d) => Math.max(d.r, baselineR))(
        segments,
      ) ?? "";

    const negativePath =
      area.innerRadius((d) => Math.min(d.r, baselineR)).outerRadius(baselineR)(
        segments,
      ) ?? "";

    return (
      <>
        <path d={positivePath} fill="rgba(220,60,60,0.25)" stroke="none" />
        <path d={negativePath} fill="rgba(50,100,220,0.25)" stroke="none" />
      </>
    );
  }

  return (
    <div style={{ textAlign: "center" }}>
      <svg
        width={size + extraMargin * 2}
        height={size + extraMargin * 2}
        viewBox={`-${radius + extraMargin} -${radius + extraMargin} ${
          size + extraMargin * 2
        } ${size + extraMargin * 2}`}
      >
        {Array.from({ length: levels }, (_, idx) => {
          if (idx < 2) return null;
          const r = ((idx + 1) / levels) * radius;
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
        {renderZFill()}
        {renderZCurve()}
        {renderZPoints()}
        {renderCurvedLabels()}
      </svg>
    </div>
  );
}
