import React from "react";
import {
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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

const NewCustomLineGraph = ({
  graphData,
  line1 = "AI-Assisted Lines Added",
  line2 = "Accepted Lines Added with AI",
  customHeight = 400,
  customWidth = "100%",
}) => {
  const applications = Array.from(
    new Set(graphData?.map((d) => d.Application))
  );

  const dates = Array.from(new Set(graphData?.map((d) => d.name)));
  const groupedData = dates.map((date) => {
    const entry = { name: date };
    applications.forEach((app) => {
      const appData = graphData?.find(
        (d) => d.name === date && d.Application === app
      );
      entry[`${app}_${line1}`] = appData ? appData[line1] : 0;
      // entry[`${app}_${line2}`] = appData ? appData[line2] : 0;
    });
    return entry;
  });

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div
          style={{
            background: "#fff",
            border: "1px solid #ccc",
            padding: "6px",
            borderRadius: "4px",
          }}
        >
          <p style={{ margin: "0 0 4px 0", fontWeight: "bold" }}>{label}</p>
          {payload.map((entry, index) => {
            const [app, metric] = entry.dataKey.split("_");
            return (
              <p key={index} style={{ color: entry.color, margin: 0 }}>
                {`${app} — ${metric}: ${entry.value}`}
              </p>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width={customWidth} height={customHeight}>
      <LineChart
        data={groupedData}
        margin={{ top: 20, right: 30, left: 20, bottom: 0 }}
      >
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        {applications?.map((app, idx) => (
          <React.Fragment key={app}>
            <Line
              type="monotone"
              dataKey={`${app}_${line1}`}
              name={app}
              stroke={getColor(idx)}
              strokeWidth={2}
              dot={false}
              connectNulls
              legendType="line"
              isAnimationActive={false}
            />
            {/* <Line
              type="monotone"
              dataKey={`${app}_${line2}`}
              name={app}
              stroke={getColor(idx)}
              strokeDasharray="5 5"
              strokeWidth={2}
              dot={false}
              connectNulls
              legendType="line"
              isAnimationActive={false}
            /> */}
          </React.Fragment>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

export default NewCustomLineGraph;
