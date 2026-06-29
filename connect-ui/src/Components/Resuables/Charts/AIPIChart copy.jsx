import React from "react";
import {
  PieChart,
  Pie,
  Tooltip,
  Cell,
  Legend,
  ResponsiveContainer,
} from "recharts";

const COLOR_PALETTE = [
  "#0062ff",
  "#ff834e",
  "#2ec971",
  "#a259ff",
  "#ffb800",
  "#ff4f81",
];

const getColor = (idx) => COLOR_PALETTE[idx % COLOR_PALETTE.length];

const AIPIChart = ({ data, customHeight = 400, customWidth = "100%" }) => {
  return (
    <ResponsiveContainer width={customWidth} height={customHeight}>
      <PieChart>
        <Pie
          data={data}
          dataKey="linesOfCodeAdded"
          nameKey="language"
          cx="50%"
          cy="50%"
          outerRadius={100}
          fill="#8884d8"
          label={({ language, percent }) =>
            `${language} ${(percent * 100).toFixed(1)}%`
          }
        >
          {data?.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getColor(index)} />
          ))}
        </Pie>
        <Tooltip formatter={(value, name) => [`${value}`, `${name}`]} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default AIPIChart;
