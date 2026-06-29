import React, { useRef } from "react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

const formatShortDate = (dateStr) => {
    if (!dateStr) return "";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[d.getMonth()]} ${d.getDate()}`;
    } catch {
        return dateStr;
    }
};

const formatLongDate = (dateStr) => {
    if (!dateStr) return "";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    } catch {
        return dateStr;
    }
};

const formatYAxisTick = (value) => {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(value);
};

const formatActiveUsers = (value) => {
    return Number(value).toLocaleString();
};

const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length || !label) return null;
    const value = payload[0]?.value;
    return (
        <div
            style={{
                backgroundColor: "#001a6f",
                color: "#fff",
                padding: "10px 14px",
                borderRadius: "8px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                minWidth: "140px",
            }}
        >
            <div style={{ fontSize: "13px", marginBottom: "4px" }}>{formatLongDate(label)}</div>
            <div style={{ fontSize: "14px", fontWeight: 700 }}>
                Active Users: {formatActiveUsers(value)}
            </div>
        </div>
    );
};

const UsageTrendAreaChart = (props) => {
    const {
        graphData = [],
        dataKey = "activeUserCount",
        customHeight = 260,
        customWidth = "100%",
        /** When true, height follows parent flex (use with wrapper flex:1; minHeight:0). */
        fillContainer = false,
        fillMinHeight = 280,
    } = props;

    const gradientId = useRef(`usage-trend-fill-${Math.random().toString(36).slice(2)}`).current;

    if (!graphData || graphData.length === 0) {
        return null;
    }

    const values = graphData.map((d) => Number(d[dataKey]) ?? 0).filter((v) => !Number.isNaN(v));
    const minVal = values.length ? Math.min(...values) : 0;
    const maxVal = values.length ? Math.max(...values) : 100;
    const padding = Math.max(20, (maxVal - minVal) * 0.1) || 20;
    const domain = [Math.max(0, minVal - padding), maxVal + padding];

    const wrapperStyle = fillContainer
        ? {
              width: customWidth,
              height: "100%",
              minHeight: fillMinHeight,
              flex: 1,
              minWidth: 0,
          }
        : { width: customWidth, height: customHeight };

    return (
        <div style={wrapperStyle}>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={graphData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                >
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0062ff" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#0062ff" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" stroke="#e2e8f0" horizontal={true} vertical={false} />
                    <XAxis
                        dataKey="date"
                        tickFormatter={formatShortDate}
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        axisLine={{ stroke: "#e2e8f0" }}
                        tickLine={false}
                    />
                    <YAxis
                        domain={domain}
                        tickFormatter={formatYAxisTick}
                        tick={{ fontSize: 12, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={{ stroke: "#e2e8f0" }}
                        width={40}
                    />
                    <Tooltip
                        content={<CustomTooltip />}
                        cursor={{ stroke: "#0062ff", strokeWidth: 1, strokeDasharray: "4 4" }}
                    />
                    <Area
                        type="monotone"
                        dataKey={dataKey}
                        stroke="#0062ff"
                        strokeWidth={2}
                        fill={`url(#${gradientId})`}
                        dot={{ fill: "#0062ff", stroke: "none", r: 3 }}
                        activeDot={{ fill: "#fff", stroke: "#0062ff", strokeWidth: 2, r: 5 }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

export default UsageTrendAreaChart;
