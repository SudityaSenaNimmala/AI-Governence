import React from "react";
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

const CPVTrendLineChart = (props) => {
    const { graphData = [], customHeight = 220, customWidth = "100%" } = props;

    if (!graphData || graphData.length === 0) return null;

    const allValues = graphData.flatMap((d) => [Number(d.cpv), Number(d.targetCPV)]).filter((v) => !Number.isNaN(v));
    const minVal = allValues.length ? Math.min(...allValues) : 0;
    const maxVal = allValues.length ? Math.max(...allValues) : 100;
    const padding = Math.max(1, (maxVal - minVal) * 0.1) || 1;
    const domain = [Math.max(0, minVal - padding), maxVal + padding];

    return (
        <div style={{ width: customWidth, height: customHeight }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={graphData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={true} vertical={true} />
                    <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        axisLine={{ stroke: "#e2e8f0" }}
                        tickLine={false}
                    />
                    <YAxis
                        domain={domain}
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={{ stroke: "#e2e8f0" }}
                        width={40}
                        tickFormatter={(v) => v.toFixed(2)}
                    />
                    <Tooltip
                        formatter={(value, name) => [value != null ? Number(value).toFixed(2) : "—", name === "cpv" ? "Actual CPV" : "Target CPV"]}
                        labelFormatter={(label) => label}
                        contentStyle={{
                            borderRadius: "8px",
                            border: "1px solid #e2e8f0",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                        }}
                    />
                    <Legend
                        wrapperStyle={{ fontSize: "12px" }}
                        formatter={(value) => (value === "cpv" ? "Actual CPV" : "Target CPV")}
                    />
                    <Line
                        type="monotone"
                        dataKey="cpv"
                        name="cpv"
                        stroke="#0062ff"
                        strokeWidth={2}
                        dot={{ fill: "#0062ff", r: 4 }}
                        activeDot={{ r: 5 }}
                    />
                    <Line
                        type="monotone"
                        dataKey="targetCPV"
                        name="targetCPV"
                        stroke="#16a34a"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={{ fill: "#16a34a", r: 3 }}
                        activeDot={{ r: 4 }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default CPVTrendLineChart;
