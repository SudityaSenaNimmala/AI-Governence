import React, { useRef } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { PieChartDescriptor } from "@cloudfuze/shared";

const COLORS = ["#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe", "#dbeafe", "#eff6ff"];

interface Props { descriptor: PieChartDescriptor; expanded?: boolean }

// Group tiny slices (< 2%) into "Others" so the chart stays readable
function mergeSmallSlices(data: { name: string; value: number }[]) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const big: typeof data = [];
  let othersVal = 0;
  for (const d of data) {
    if (total > 0 && d.value / total < 0.02) othersVal += d.value;
    else big.push(d);
  }
  if (othersVal > 0) big.push({ name: "Others", value: othersVal });
  return { slices: big, total };
}

export default function PieChartWidget({ descriptor, expanded }: Props) {
  const { config } = descriptor;
  const containerRef = useRef<HTMLDivElement>(null);
  const { slices, total } = mergeSmallSlices(config.data ?? []);
  const height = expanded ? 220 : 170;
  const innerR = expanded ? 55 : 40;
  const outerR = expanded ? 90 : 65;

  return (
    <div style={{ padding: "10px 12px 12px" }}>
      <div ref={containerRef} style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {/* Donut */}
        <div style={{ flexShrink: 0 }}>
          <ResponsiveContainer width={expanded ? 200 : 150} height={height}>
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                innerRadius={innerR}
                outerRadius={outerR}
                paddingAngle={2}
                label={false}
                labelLine={false}
              >
                {slices.map((entry, i) => (
                  <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value.toLocaleString()} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
                  name,
                ]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #dbeafe" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend with values */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, overflowY: "auto", maxHeight: height }}>
          {slices.map((entry, i) => {
            const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0";
            return (
              <div key={entry.name} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#374151", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.name.replace(/_/g, " ")}
                  </div>
                  <div style={{ fontSize: 10, color: "#9ca3af" }}>
                    {entry.value.toLocaleString()} · {pct}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
