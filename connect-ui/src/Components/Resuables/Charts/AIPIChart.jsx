import React, { useEffect, useRef } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { useNavigate } from "react-router-dom";

const AIPIChart = (props) => {
  const navigate = useNavigate();
  const { title, graphData, customHeight, customWidth, options } = props;
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

  const pieData =
    graphData?.map((item) => ({
      name: item.language,
      y: item.linesOfCodeAdded,
    })) ?? [];

  const chartConfiguration = {
    chart: {
      type: "pie",
      height: customHeight ?? 350,
      width: customWidth ?? 470,
      backgroundColor: "transparent",
    },
    title: {
      text: title ?? "",
    },
    plotOptions: {
      pie: {
        allowPointSelect: true,
        cursor: "pointer",
        dataLabels: {
          enabled: true,
          formatter: function () {
            return `<p class="cf_chart_link" data-name="${this.point.name}">
                      ${this.point.name}
                    </p>`;
          },
          useHTML: true,
        },
        showInLegend: options?.showInLegend !== "false",
        point: {
          events: {
            click: function () {
              // Navigate using language name as query param
              navigate(`/AppCategory?type=${this.name}`);
            },
          },
        },
      },
    },
    series: [
      {
        innerSize: "80%",
        data: pieData.length ? pieData : [],
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
        return `${this.key}: ${this.y}`;
      },
    },
  };

  return (
    <HighchartsReact
      highcharts={Highcharts}
      options={chartConfiguration}
      ref={graphRef}
    />
  );
};

export default AIPIChart;
