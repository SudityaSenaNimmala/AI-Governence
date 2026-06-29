import React, { useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { BarChartDescriptor } from "@cloudfuze/shared";

const COLORS = ["#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];

interface Props { descriptor: BarChartDescriptor; expanded?: boolean }

export default function BarChartWidget({ descriptor, expanded }: Props) {
  const { config, stacked } = descriptor;
  const { categories, series } = config;
  const height = expanded ? 280 : 160;
  const containerRef = useRef<HTMLDivElement>(null);

  const data = categories.map((cat, i) => {
    const point: Record<string, unknown> = { name: cat };
    series.forEach((s) => { point[s.name] = (s.data as number[])[i]; });
    return point;
  });

  return (
    <div style={{ padding: "10px 12px 12px" }}>
      <div ref={containerRef}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            {expanded && series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]}
                stackId={stacked ? "stack" : undefined} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
