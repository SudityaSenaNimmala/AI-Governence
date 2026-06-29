import _React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { LineChartDescriptor } from "@cloudfuze/shared";

const COLORS = ["#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd"];

interface Props { descriptor: LineChartDescriptor; expanded?: boolean }

export default function LineChartWidget({ descriptor, expanded }: Props) {
  const { config } = descriptor;
  const { series } = config;
  const height = expanded ? 280 : 160;

  const xValues = [...new Set(series.flatMap((s) => s.data.map((p) => p.x)))].sort();
  const data = xValues.map((x) => {
    const point: Record<string, unknown> = { x };
    series.forEach((s) => {
      const found = s.data.find((p) => p.x === x);
      point[s.name] = found?.y;
    });
    return point;
  });

  return (
    <div style={{ padding: "10px 12px 12px" }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="x" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          {expanded && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => (
            <Line key={s.name} type="monotone" dataKey={s.name}
              stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
