import React, { useContext } from "react";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";

const CustomVerticalStackedBarGraph = (props) => {

  const { globalContext } = useContext(GlobalContext);

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
            {payload[0].payload?.email ? (
              <span style={{ fontWeight: "400" }}>
                ({payload[0].payload?.email})
              </span>
            ) : (
              ""
            )}
          </p>
          {payload.map((entry, index) => (
            <>
              <p
                key={index}
                style={{
                  margin: 0,
                  color: "#666",
                }}
              >
                {entry.name}: {entry.value}
              </p>
            </>
          ))}
        </div>
      );
    }
    return null;
  };

  const CustomBarLabel = (e) => {
    const { x, y, width, value, name } = e;
    return (
      <text
        x={x + width / 2}
        y={y - 5}
        fill="#333"
        textAnchor="middle"
        fontSize="12px"
        fontWeight="bold"
      >
        {name}
      </text>
    );
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
          x={-25}
          y={-10}
          height="20px"
          width="20px"
        />
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart
        layout="vertical"
        data={props?.customData}
        margin={{ top: 20, right: 30, left: 40, bottom: 5 }}
      >
        <XAxis type="number" />
        interval={0}
        <YAxis
          dataKey="name"
          type="category"
          tick={<CustomYAxisTick />}
          interval={0}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Bar dataKey="Active Users" stackId="a" fill="#0062ff" barSize={30} />
        <Bar
          dataKey="In Active Users"
          stackId="a"
          fill="#AFDBF5"
          barSize={30}
        />
        <Bar dataKey="Guest Active Users" stackId="a" fill="#ffccc6" barSize={30} />
        <Bar dataKey="Guest In Active Users" stackId="a" fill="#fd5c63" barSize={30} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default CustomVerticalStackedBarGraph;
