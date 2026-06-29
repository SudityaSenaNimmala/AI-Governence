import React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const getShortDay = (dayOfWeek) => {
    if (!dayOfWeek) return "";
    const d = String(dayOfWeek).slice(0, 3);
    return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
};

const DEFAULT_HANDOFF_THRESHOLD = 12; // above this show red, else green

const DailyUsagePatternBarChart = ({
    graphData = [],
    customHeight = 260,
    customWidth = "100%",
    handoffThreshold = DEFAULT_HANDOFF_THRESHOLD,
    showMetricCards = false,
}) => {
    if (!graphData?.length) {
        return (
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "280px",
                    color: "#0062ff",
                    fontSize: "14px",
                }}
            >
                No data available
            </div>
        );
    }

    const chartData = graphData.map((item) => ({
        ...item,
        shortDay: item.shortDay || getShortDay(item.dayOfWeek) || "",
    }));

    return (
        <>
            <div style={{ width: customWidth, height: customHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis
                            dataKey="shortDay"
                            tick={{ fontSize: 12, fill: "#64748b" }}
                            axisLine={{ stroke: "#e2e8f0" }}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fontSize: 12, fill: "#0062ff" }}
                            axisLine={false}
                            tickLine={{ stroke: "#e2e8f0" }}
                            width={36}
                        />
                        <Tooltip
                            formatter={(value, name) => [
                                value,
                                name === "totalInteractions" ? "Interactions" : name,
                            ]}
                            labelFormatter={(label) => label}
                            contentStyle={{
                                borderRadius: "8px",
                                border: "1px solid #e2e8f0",
                                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                            }}
                        />
                        <Bar
                            dataKey="totalInteractions"
                            fill="#0062ff"
                            radius={[4, 4, 0, 0]}
                            barSize={32}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {showMetricCards && (
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "10px",
                        marginTop: "16px",
                    }}
                >
                    {chartData.map((day, i) => (
                        <div
                            key={day.shortDay || day.dayOfWeek || i}
                            style={{
                                flex: "1 1 80px",
                                minWidth: "72px",
                                padding: "10px 12px",
                                borderRadius: "8px",
                                backgroundColor: "#f8fafc",
                            }}
                        >
                            <div style={{ fontSize: "11px", color: "#0062ff", marginBottom: "4px" }}>
                                {day.shortDay || getShortDay(day.dayOfWeek)}
                            </div>
                            <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
                                SAR: {Number(day.sar).toFixed(1)}%
                            </div>
                            <div
                                style={{
                                    fontSize: "12px",
                                    fontWeight: 500,
                                    color:
                                        (day.handoffRate || 0) > handoffThreshold
                                            ? "#dc2626"
                                            : "#16a34a",
                                }}
                            >
                                Handoff: {Number(day.handoffRate).toFixed(1)}%
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
};

export default DailyUsagePatternBarChart;
