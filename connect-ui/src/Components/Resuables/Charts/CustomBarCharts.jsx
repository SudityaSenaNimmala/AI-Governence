import React, { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Rectangle,
} from "recharts";

const CustomBarCharts = ({
  graphData,
  line1 = "Total Tabs Accepted",
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
      <BarChart
        width={500}
        height={300}
        data={data}
        margin={{
          top: 5,
          right: 30,
          left: 20,
          bottom: 5,
        }}
      >
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar
          dataKey={line1}
          fill="#0037a9"
          barSize={30}
          // activeBar={<Rectangle fill="pink" stroke="blue" />}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default CustomBarCharts;
