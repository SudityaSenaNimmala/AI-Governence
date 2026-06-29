import React, { useEffect, useState } from "react";
import {
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CustomLineGraphs = ({
  graphData,
  providerName,
  line1 = "AI-Assisted Lines Added",
  line2 = "AI-Suggested Tabs Accepted",
  customHeight = 400,
  customWidth = "100%",
}) => {
  const [data, setData] = useState([]);

  useEffect(() => {
    if (graphData?.length > 0) {
      setData(graphData);
    }
  }, [graphData]);

  return (
    <ResponsiveContainer width={customWidth} height={customHeight}>
      <LineChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 0 }}
      >
        {/* <CartesianGrid strokeDasharray="3 3" /> */}
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey={line2}
          stroke="#ff834e"
          strokeWidth={2}
        />
        {
          providerName !== "CLAUDE" && (
            <Line
              type="monotone"
              dataKey={line1}
              stroke="#0062ff"
              strokeWidth={2}
            />
          )
        }
      </LineChart>
    </ResponsiveContainer>
  );
};

export default CustomLineGraphs;
