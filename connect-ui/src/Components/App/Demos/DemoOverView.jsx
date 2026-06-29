import { useContext, useEffect, useState } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { formatDateForGraph } from "../../helpers/utils";
import CustomBarCharts from "../../Resuables/Charts/CustomBarCharts";
import CustomLineGraphs from "../../Resuables/Charts/CustomLineGraphs";
import { getAIUsageInfo, getAIUsageInsight, getAIUsageInsights, getClaudCodeUsage } from "../SaaSManagement/SaaSActions/SaaSActions";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import { Puzzle } from "lucide-react";

const DemoOverView = () => {
  const { globalContext } = useContext(GlobalContext);
  const { memberId, providerName, usersCount, id } = {
    ...globalContext?.saasCloud,
  };
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [aiUsage, setAIUsage] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [barGraphData, setBarGraphData] = useState(null);
  const [agentRequestsData, setAgentRequestsData] = useState(null);
  const [claudCodeUsage, setClaudCodeUsage] = useState(null);
  const getAIUsage = async () => {
    setIsPageLoading(true);
    if (providerName === "CLAUDE") {
      getAIAssestedTab();
    }

    let res = await getAIUsageInfo(id, providerName === "CLAUDE" ? "30D" : "6D");
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (providerName === "CLAUDE") {
        let grphData = res?.res?.reduce((acc, data) => {
          return [
            ...acc,
            {
              name: formatDateForGraph(data?.usageOn ?? data?.usegeOn),
              // "AI-Assisted Lines Added": data?.totalLinesAdded,
              "Accepted Lines Added with AI": data?.acceptedLinesAdded,
            },
          ];
        }, []);
        setGraphData(grphData);
      } else {

        let grphData = res?.res?.reduce((acc, data) => {
          return [
            ...acc,
            {
              name: formatDateForGraph(data?.usageOn ?? data?.usegeOn),
              "AI-Assisted Lines Added": data?.totalLinesAdded,
              "Accepted Lines Added with AI": data?.acceptedLinesAdded,
            },
          ];
        }, []);

        let barGraphData = res?.res?.reduce((acc, data) => {
          return [
            ...acc,
            {
              name: formatDateForGraph(data?.usageOn ?? data?.usegeOn),
              "AI-Suggested Tabs Accepted": data?.totalTabsAccepted,
            },
          ];
        }, []);
        setGraphData(grphData);
        setBarGraphData(barGraphData);
        setAIUsage(res?.res);
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const getAIAssestedTab = async () => {
    fetchClaudeCodeUsage();
    let res = await getAIUsageInsight(id);
    if (res?.status === "OK") {
      if (res?.res?.length > 0) {
        let barGraphData = res?.res?.reduce((acc, data) => {
          return [
            ...acc,
            {
              name: formatDateForGraph(data?.usageOn ?? data?.usegeOn),
              "AI-Suggested Tabs": data?.totalTabsShown,
              "AI-Suggested Tabs Accepted": data?.totalTabsAccepted,
            },
          ];
        }, []);

        let agentRequestsData = res?.res?.reduce((acc, data) => {
          return [
            ...acc,
            {
              name: formatDateForGraph(data?.usageOn ?? data?.usegeOn),
              "Agent Requests": data?.agentRequests,
            },
          ];
        }, []);
        setBarGraphData(barGraphData);
        setAgentRequestsData(agentRequestsData);
      }
    }
  };

  const fetchClaudeCodeUsage = async () => {
    let res = await getClaudCodeUsage(id);
    if (res?.status === "OK") {
      setClaudCodeUsage(res?.res);
    }
  };


  useEffect(() => {
    getAIUsage();
  }, []);

  return (
    <>
      <div className="cf_dBottom_Info_2Pannel" style={{ gap: "2rem 7rem" }}>
        <div
          className="cf_border cf_border_radius cf_overflow_hidden"
          style={{
            height: "fit-content",
            paddingBottom: providerName === "CLAUDE" ? "0px" : "20px",
            gap: "20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
            <p>AI-Assisted Line Changes</p>
            <p className="cf_new_dashboard_pannel_info">
              Daily AI-Assisted Line Changes (Last {providerName === "CLAUDE" ? "30" : "10"} Days)
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
            <CustomLineGraphs
              graphData={graphData}
              line1={providerName === "CLAUDE" ? null : "AI-Assisted Lines Added"}
              line2="Accepted Lines Added with AI"
              customHeight={250}
              customWidth={600}
              providerName={providerName}
            />
          )}
        </div>
        <div
          className="cf_border cf_border_radius cf_overflow_hidden"
          style={{
            height: "fit-content",
            paddingBottom: providerName === "CLAUDE" ? "0px" : "20px",
            gap: "20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
            <p>AI-Assisted Tabs Accepted</p>
            <p className="cf_new_dashboard_pannel_info">
              Daily AI-Assisted Tabs Accepted (Last {providerName === "CLAUDE" ? "30" : "10"} Days)
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
            providerName === "CLAUDE" ? <CustomLineGraphs
              graphData={barGraphData}
              line1="AI-Suggested Tabs"
              line2="AI-Suggested Tabs Accepted"
              customHeight={250}
              customWidth={600}
            // providerName={providerName}
            /> :
              <CustomBarCharts
                graphData={barGraphData}
                line1="AI-Suggested Tabs Accepted"
                customHeight={250}
                customWidth={600}
              />

          )}
        </div>
        {
          providerName === "CLAUDE" &&
          <>
            <div
              className="cf_border cf_border_radius cf_overflow_hidden"
              style={{
                height: "fit-content",
                marginBottom: "20px",
                gap: "20px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
                <p>Agent Requests</p>
                <p className="cf_new_dashboard_pannel_info">
                  Daily Agent Requests (Last 30 Days)
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

                <CustomBarCharts
                  graphData={agentRequestsData}
                  line1="Agent Requests"
                  customHeight={250}
                  customWidth={600}
                />

              )}
            </div>
          </>
        }
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default DemoOverView;
