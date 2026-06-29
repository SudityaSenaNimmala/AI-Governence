import { Puzzle } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { formatDateForGraph } from "../../helpers/utils";
import CustomBarCharts from "../../Resuables/Charts/CustomBarCharts";
import CustomLineGraphs from "../../Resuables/Charts/CustomLineGraphs";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import { getAIUsageInfo } from "../SaaSManagement/SaaSActions/SaaSActions";
import { getCloudName } from "../../helpers/helpers";
import NewCustomLineGraph from "../../Resuables/Charts/NewCustomLineGraph";
import AIPIChart from "../../Resuables/Charts/AIPIChart";

const AIBottomDashboard = ({ aiInsightsList }) => {
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [aiUsage, setAIUsage] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [barGraphData, setBarGraphData] = useState(null);

  useEffect(() => {
    if (aiInsightsList?.length > 0) {
      setAIUsage(aiInsightsList);
      makeDataForGraph();
    }
  }, [aiInsightsList]);

  const makeDataForGraph = () => {
    let grphData = aiInsightsList?.reduce((acc, data) => {
      return [
        ...acc,
        {
          name: formatDateForGraph(data?.usageOn ?? data?.usegeOn),
          Application: getCloudName(data?.vendorName),
          "AI-Assisted Lines Added": data?.totalLinesAdded,
          "Accepted Lines Added with AI": data?.acceptedLinesAdded,
        },
      ];
    }, []);

    let barGraphData = aiInsightsList?.reduce((acc, data) => {
      return [
        ...acc,
        {
          name: formatDateForGraph(data?.usageOn ?? data?.usegeOn),
          "AI-Suggested Tabs Accepted": data?.totalTabsAccepted,
        },
      ];
    }, []);

    const resultMap = {};

    aiInsightsList?.forEach((item) => {
      const language = item?.mostUsedLanguage || "Others";

      if (!resultMap[language]) {
        resultMap[language] = {
          language,
          linesOfCodeAdded: 0,
        };
      }

      resultMap[language].linesOfCodeAdded += item.totalLinesAdded;
    });

    console.log(Object.values(resultMap));
    setGraphData(grphData);
    setBarGraphData(Object.values(resultMap));
  };

  return (
    <>
      <div className="cf_dBottom_Info_2Pannel" style={{ gap: "7rem" }}>
        <div
          className="cf_border cf_border_radius cf_overflow_hidden"
          style={{
            height: "fit-content",
            paddingBottom: "20px",
            gap: "20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
            <p>AI-Assisted Line Changes</p>
            <p className="cf_new_dashboard_pannel_info">
              Daily AI-Assisted Line Changes (Last 10 Days)
            </p>
          </div>
          {!isPageLoading && graphData?.length === 0 ? (
            <div
              className="cf_new_dashboard_info_graph_container"
              style={{ height: "370px", padding: "10px 1.5rem" }}
            >
              <div
                className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
                style={{
                  alignItems: "center",
                  height: "350px",
                  border: "1px dotted #ddd",
                  justifyContent: "center",
                  borderRadius: "0.75rem",
                }}
              >
                <div>
                  <Puzzle size={50} color="#64748b" />
                </div>
                <p style={{ fontSize: "14px" }}>No data available</p>
              </div>
            </div>
          ) : (
            <NewCustomLineGraph
              graphData={graphData}
              line1="AI-Assisted Lines Added"
              line2="Accepted Lines Added with AI"
              customHeight={350}
              customWidth={600}
            />
          )}
        </div>
        <div
          className="cf_border cf_border_radius cf_overflow_hidden"
          style={{
            height: "fit-content",
            paddingBottom: "20px",
            gap: "20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
            <p>Top Languages for Accepted AI Code Completions</p>
            <p className="cf_new_dashboard_pannel_info">
            Language Breakdown of AI-Assisted Code Completion Acceptances (Last 10 Days)
            </p>
          </div>
          {!isPageLoading && barGraphData?.length === 0 ? (
            <div
              className="cf_new_dashboard_info_graph_container"
              style={{ height: "370px", padding: "10px 1.5rem" }}
            >
              <div
                className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
                style={{
                  alignItems: "center",
                  height: "350px",
                  border: "1px dotted #ddd",
                  justifyContent: "center",
                  borderRadius: "0.75rem",
                }}
              >
                <div>
                  <Puzzle size={50} color="#64748b" />
                </div>
                <p style={{ fontSize: "14px" }}>No data available</p>
              </div>
            </div>
          ) : (
            // <CustomBarCharts
            //   graphData={barGraphData}
            //   line1="AI-Suggested Tabs Accepted"
            //   customHeight={250}
            //   customWidth={600}
            // />
            <AIPIChart
              graphData={barGraphData}
              line1="AI-Suggested Tabs Accepted"
              customHeight={350}
              customWidth={680}
            />
          )}
        </div>
      </div>
      {/* {isPageLoading ? getCFLoader() : ""} */}
    </>
  );
};

export default AIBottomDashboard;
