import React, { useContext, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";

const CustomStakedBarGraph = (props) => {
  const [graphData, setGraphData] = useState([]);

  const {globalContext} = useContext(GlobalContext);

  const getCloudImageName = (providerName, externalProviderName) => {
    if (externalProviderName) {
      let cloud = globalContext?.cloudsList?.find(data => data?.externalProviderName === externalProviderName);
      if (cloud) {
        return cloud?.phoneNumber ? `https://cloudfuzehost.com/globalasserts/${cloud?.phoneNumber}` : cloudImageMapper(cloud?.providerName, cloud?.externalProviderName);
      } else {
        return cloudImageMapper(providerName, externalProviderName);
      }
    } else {
      return cloudImageMapper(providerName, externalProviderName);
    }
  }

  useEffect(() => {
    if (props?.graphData?.length > 0) {
      setGraphData(props?.graphData);
    }
  }, [props?.graphData]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div
          style={{
            backgroundColor: "white",
            padding: "10px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          }}
        >
          <p
            style={{
              margin: "0 0 5px 0",
              fontWeight: "bold",
              color: "#333",
            }}
          >
            {label?.includes("OTHERS")
              ? getCloudName(label?.split("|")[1])
              : getCloudName(label)}
          </p>
          <p
            style={{
              margin: 0,
              color: "#666",
            }}
          >
            Total Cost: $
            {(
              payload[0].value + payload[0]?.payload["Potential Cost Saving"]
            ).toFixed(2)}
          </p>
          <p
            style={{
              margin: 0,
              color: "#666",
            }}
          >
            Optimized Cost: $
            {payload[0].value ? payload[0].value?.toFixed(2) : 0}
          </p>
          <p
            style={{
              margin: 0,
              color: "#666",
            }}
          >
            Potential Cost Saving: $
            {payload[0]?.payload["Potential Cost Saving"]?.toFixed(2)}
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomYAxisTick = (e) => {
    const { x, y, payload } = e;
    return (
      <g transform={`translate(${x},${y})`}>
        <image
          href={
            payload.value?.includes("OTHERS")
              ? getCloudImageName(
                payload.value?.split("|")[0],
                payload.value?.split("|")[1]
              )
              : cloudImageMapper(payload.value)
          }
          x={-10}
          y={2}
          height="20px"
          width="20px"
        />
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart
        width={500}
        height={300}
        data={graphData}
        margin={{
          top: 20,
          right: 30,
          left: 20,
          bottom: 5,
        }}
      >
        <XAxis
          dataKey="name"
          type="category"
          tick={<CustomYAxisTick />}
          interval={0}
        />
        <YAxis tickFormatter={(v) => `$${v}`} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="Optimized Cost" stackId="a" fill="#0062ff" barSize={30} />
        <Bar
          // dataKey="potentialCostSaving"
          dataKey="Potential Cost Saving"
          stackId="a"
          fill="#AFDBF5"
          barSize={30}
        />
        <Legend />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default CustomStakedBarGraph;
