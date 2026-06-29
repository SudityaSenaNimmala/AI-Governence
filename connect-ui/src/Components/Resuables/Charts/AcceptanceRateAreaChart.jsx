import React, { useRef } from "react";
import {
    Area,
    AreaChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

const AcceptanceRateAreaChart = (props) => {
    const {
        graphData = [],
        dataKey = "sar",
        options = {},
        customHeight = 220,
        customWidth = "100%",
    } = props;

    const gradientId = useRef(`sar-area-fill-${Math.random().toString(36).slice(2)}`).current;

    if (!graphData || graphData.length === 0) {
        return null;
    }

    const values = graphData.map((d) => Number(d[dataKey]) ?? 0).filter((v) => !Number.isNaN(v));
    const minVal = values.length ? Math.min(...values) : 0;
    const maxVal = values.length ? Math.max(...values) : 100;
    const domain = [
        Math.max(0, minVal - 5),
        Math.min(100, maxVal + 5),
    ];

    return (
        <div style={{ width: options?.customWidth ?? customWidth, height: options?.customHeight ?? customHeight }}>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={graphData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0062ff" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#0062ff" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        axisLine={{ stroke: "#e2e8f0" }}
                        tickLine={false}
                    />
                    <YAxis
                        domain={domain}
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={{ stroke: "#e2e8f0" }}
                        width={36}
                    />
                    <Tooltip
                        formatter={(value) => [`${Number(value).toFixed(1)}%`, "Acceptance Rate"]}
                        labelFormatter={(label) => label}
                        contentStyle={{
                            borderRadius: "8px",
                            border: "1px solid #e2e8f0",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                        }}
                    />
                    <Area
                        type="monotone"
                        dataKey={dataKey}
                        stroke="#0062ff"
                        strokeWidth={2}
                        fill={`url(#${gradientId})`}
                        dot={{ fill: "#fff", stroke: "#0062ff", strokeWidth: 2, r: 4 }}
                        activeDot={{ fill: "#fff", stroke: "#0062ff", strokeWidth: 2, r: 5 }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

export default AcceptanceRateAreaChart;
