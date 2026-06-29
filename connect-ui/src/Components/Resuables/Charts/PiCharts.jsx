import React, { useEffect, useRef } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { getCloudName } from "../../helpers/helpers";
import { useNavigate } from "react-router-dom";

const PiCharts = (props) => {
  const navigate = useNavigate();
  const { title, graphData, options, viewType, customLink = true } = props;
  const graphRef = useRef();

  useEffect(() => {
    const handleResize = () => {
      if (graphRef?.current) {
        graphRef?.current?.chart?.reflow();
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const chartConfiguration = {
    chart: {
      renderTo: "container",
      type: "pie",
      // height: options?.customHeight || 350,
      // width: options?.customWidth || 470,
      height: options?.customHeight === null ? null : 350,
      width: options?.customWidth === null ? null : 470,
    },
    title: {
      text: title ?? "Title Missing 😊",
    },
    plotOptions: {
      pie: {
        allowPointSelect: true,
        cursor: "pointer",
        dataLabels: {
          enabled: options?.dataLabels === "true",
          formatter: function () {
            const label = getCloudName(this.point.name);
            const valuePart = viewType === "TOOL_USAGE"
              ? ` ${this.point.y}%`
              : viewType === "ALL_APPS"
                ? ""
                : viewType !== "category"
                  ? ` (${this.point.y})`
                  : "";
            return customLink
              ? `<p class="cf_chart_link" data-name="${this.point.name}">${label}${valuePart}</p>`
              : viewType === "TOOL_USAGE"
                ? `<p style="font-weight: 500; color: #64748b;">${label}${valuePart}</p>`
                : `<p style="font-weight: bold;">${label}${valuePart}</p>`;
          },
          useHTML: true,
        },
        showInLegend: options?.showInLegend !== "false",
        point: {
          events: {
            click: function () {
              if (!customLink) {
                return;
              }
              navigate(viewType === "category" ? `/AppCategory?type=${this.name}` : `/DepartmentCategory?type=${encodeURIComponent(this.name)}&usersCount=${this.y}`);
            },
          },
        },
      },
    },
    series: [
      {
        innerSize: "80%",
        data: graphData ?? [
          {
            name: "Apps With Scopes",
            y: 50,
            color: "#72F4A6",
          },
          {
            name: "Apps Without Scopes",
            y: 100,
            color: "#EB73FF",
          },
        ],
      },
    ],
    credits: {
      enabled: false,
    },
    tooltip: {
      followPointer: true,
      backgroundColor: "rgba(0,0,0,0.5)",
      style: {
        color: "#fff",
        fontWeight: "bold",
      },
      borderRadius: 2,
      formatter: function () {
        if (viewType === "TOOL_USAGE") return `${getCloudName(this.key)}: ${this.y}%`;
        if (viewType === "ALL_APPS") return `${getCloudName(this.key)}: $${(this.y)}`;
        if (viewType === "category") return `${getCloudName(this.key)}: ${this.y}`;
        return `${this.key}`;
      },
    },
  };
  return (
    <>
      <HighchartsReact
        highcharts={Highcharts}
        options={chartConfiguration}
        ref={graphRef}
      />
    </>
  );
};

export default PiCharts;
