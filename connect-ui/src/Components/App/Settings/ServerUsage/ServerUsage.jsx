import React from "react";
import { IoMdClose } from "react-icons/io";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
const ServerUsage = (props) => {
  const data = [
    {
      name: "2024-08-13T12:00:00Z",
      cpu_usage_percent: 25.5,
    },
    {
      name: "2024-08-13T12:15:00Z",
      cpu_usage_percent: 0,
    },
    {
      name: "2024-08-13T12:30:00Z",
      cpu_usage_percent: 22,
    },
    {
      name: "2024-08-13T12:45:00Z",
      cpu_usage_percent: 50.8,
    },
    {
      name: "2024-08-13T13:00:00Z",
      cpu_usage_percent: 45.3,
    },
  ];
  const memory = [
    {
      name: "2024-08-13T00:00:00Z",
      total_memory_gb: 32,
      used_memory_gb: 24,
      free_memory_gb: 8,
      percentage_used: 35,
    },
    {
      name: "2024-08-13T01:00:00Z",
      total_memory_gb: 32,
      used_memory_gb: 23.5,
      free_memory_gb: 8.5,
      percentage_used: 45,
    },
    {
      name: "2024-08-13T02:00:00Z",
      total_memory_gb: 32,
      used_memory_gb: 24.2,
      free_memory_gb: 7.8,
      percentage_used: 55.4,
    },
    {
      name: "2024-08-13T03:00:00Z",
      total_memory_gb: 32,
      used_memory_gb: 25,
      free_memory_gb: 7,
      percentage_used: 48,
    },
    {
      name: "2024-08-13T04:00:00Z",
      total_memory_gb: 32,
      used_memory_gb: 26,
      free_memory_gb: 6,
      percentage_used: 81.2,
    },
  ];
  return (
    <div className="cf_usermanagement_container">
      <div className="cf_usermanagement_container_title">
        <h2>Monitor Server Usage</h2>
        <div
          className="cf_usermanagement_close"
          onClick={() => props?.changeClick("")}
        >
          <IoMdClose />
        </div>
      </div>
      <div
        className="cf_usermanagement_container_body"
        style={{
          background: "#f0f0f0",
          padding: "10px",
          justifyContent: "space-between",
        }}
      >
        <div className="cf_server_usage_pannel">
          <div className="cf_server_usage_pannel_title">CPU utilization</div>
          <div className="cf_server_usage_pannel_body">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                width={730}
                height={250}
                data={data}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorUv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorPv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#82ca9d" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" />
                <YAxis />
                {/* <CartesianGrid strokeDasharray="3 3" />  */}
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="cpu_usage_percent"
                  stroke="#8884d8"
                  fillOpacity={1}
                  fill="url(#colorUv)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="cf_server_usage_pannel">
          <div className="cf_server_usage_pannel_title">Memory utilization</div>
          <div className="cf_server_usage_pannel_body">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                width={730}
                height={250}
                data={memory}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorUv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorPv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#82ca9d" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" />
                <YAxis />
                {/* <CartesianGrid strokeDasharray="3 3" />  */}
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="percentage_used"
                  stroke="#8884d8"
                  fillOpacity={1}
                  fill="url(#colorUv)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServerUsage;
