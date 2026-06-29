import moment from "moment";
import Popup from "../../../Resuables/Popup/Popup";
import SvgName from "../../../Testing/SvgName";
import CustomLineGraphs from "../../../Resuables/Charts/CustomLineGraphs";
import { Bot, Code } from "lucide-react";
import { getAIUsageInsights } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { useContext, useEffect, useState } from "react";
import {
  formatCurrencyShort,
  formatDataForGraph,
  formatDateForGraph,
} from "../../../helpers/utils";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";

const UserAIUsageInsights = ({
  selectedUser,
  setSelectedUser,
  isPageLoading,
  setIsPageLoading,
  customPage = false,
}) => {
  const [aiUsageInfo, setAIUsageInfo] = useState(null);
  const [isVisible, setIsVisible] = useState(true);
  const [graphData, setGraphData] = useState(null);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { memberId, providerName, usersCount, id } = {
    ...globalContext?.saasCloud,
  };
  const [topHeaders, setTopHeaders] = useState([
    {
      id: "linesAdded",
      title: "Lines Added Using AI",
      icon: <Code size={16} strokeWidth={2} color="#64748b" />,
      subtitle: "Total Lines Added In Last 10 Days",
      linesDeleted: 0,
      color: "#3b82f6",
    },
    {
      id: "tabsShown",
      title: "Tabs Shown Using AI",
      icon: <span style={{ color: "#64748b" }}>&#x2B7E;</span>,
      subtitle: "Total Tabs Shown In Last 10 Days",
      tabsAccepted: 0,
      color: "#001a6f",
    },
    {
      id: "mostUsedModels",
      title: "Most Used AI Model",
      icon: <Bot size={16} strokeWidth={2} color="#64748b" />,
      subtitle: "Most Used Model In Last 10 Days",
      color: "#f59e0b",
    },
    {
      id: "mostUsedLanguages",
      title: "Most Used Languages",
      icon: <Code size={16} strokeWidth={2} color="#64748b" />,
      subtitle: "Most Used Languages In Last 10 Days",
      color: "#22c55e",
    },
  ]);

  useEffect(() => {
    if (selectedUser?.id || selectedUser?.groupName) {
      getAIUsageInfo();
    } else {
      setIsVisible(false);
    }
  }, [selectedUser]);

  useEffect(() => {
    if (!isVisible) {
      if (!customPage) {
        setSelectedUser(null);
      }
    }
  }, [isVisible]);

  const getAIUsageInfo = async () => {
    setIsPageLoading(true);
    let res = await getAIUsageInsights(
      selectedUser?.adminCloudId || id,
      selectedUser?.email || selectedUser?.groupEmail
    );
    if (res?.status === "OK") {
      setAIUsageInfo(res?.res);

      setGraphData(formatDataForGraph(res?.res));

      let linesAdded = res?.res?.reduce((acc, curr) => {
        return acc + curr?.totalLinesAdded;
      }, 0);

      let linesDeleted = res?.res?.reduce((acc, curr) => {
        return acc + curr?.totalLinesDeleted;
      }, 0);

      let tabsShown = res?.res?.reduce((acc, curr) => {
        return acc + curr?.totalTabsShown;
      }, 0);

      let tabsAccepted = res?.res?.reduce((acc, curr) => {
        return acc + curr?.totalTabsAccepted;
      }, 0);

      let mostUsedLanguageMap = res?.res?.reduce((acc, curr) => {
        if (curr?.mostUsedLanguage) {
          acc[curr?.mostUsedLanguage] = (acc[curr?.mostUsedLanguage] || 0) + 1;
        }
        return acc;
      }, {});

      let mostUsedLanguage = "-";
      if (Object.keys(mostUsedLanguageMap)?.length > 0) {
        mostUsedLanguage = Object.keys(mostUsedLanguageMap)?.reduce((a, b) =>
          mostUsedLanguageMap[a] > mostUsedLanguageMap[b] ? a : b
        );
      }

      let mostUsedModelMap = res?.res?.reduce((acc, curr) => {
        if (curr?.mostUsedModel) {
          acc[curr?.mostUsedModel] = (acc[curr?.mostUsedModel] || 0) + 1;
        }
        return acc;
      }, {});

      let mostUsedModel = "-";
      if (Object.keys(mostUsedModelMap)?.length > 0) {
        mostUsedModel = Object.keys(mostUsedModelMap).reduce((a, b) =>
          mostUsedModelMap[a] > mostUsedModelMap[b] ? a : b
        );
      }

      topHeaders[0].value = linesAdded;

      if (linesDeleted > 0) {
        topHeaders[0].subValue = (
          <span
            style={{
              color: "rgb(235, 14, 73)",
              fontSize: "10px",
              fontWeight: "500",
              marginLeft: "10px",
            }}
          >
            {formatCurrencyShort(linesDeleted)} Deleted
          </span>
        );
      } else {
        topHeaders[0].subValue = null;
      }
      topHeaders[1].value = tabsShown;
      if (tabsAccepted > 0) {
        topHeaders[1].subValue = (
          <span
            style={{
              color: "#001a6f",
              fontSize: "10px",
              fontWeight: "500",
              marginLeft: "10px",
            }}
          >
            {formatCurrencyShort(tabsAccepted)} Accepted
          </span>
        );
      } else {
        topHeaders[1].subValue = null;
      }
      topHeaders[2].value = mostUsedModel;
      topHeaders[3].value = mostUsedLanguage;

      setTopHeaders(topHeaders);

      setIsPageLoading(false);
      setIsVisible(true);
    } else {
      setIsPageLoading(false);
      setIsVisible(false);
    }
  };

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: `${
          selectedUser?.firstName ||
          selectedUser?.email ||
          selectedUser?.groupName
        } Usage Insights`,
        popupWidth: "80%",
        type: "side",
        popupHeight: "calc(100% - 0px)",
        popupTop: "00px",
        maxHeight: "100%",
        overflowY: "auto",
        parentStyles: {
          justifyContent: "flex-end",
        },
        titleCustomStyles: {
          fontSize: "16px",
          fontWeight: "600",
        },
        titleDivStyles: {
          borderBottom: "1px solid #e2e8f0",
        },
      }}
      toggleOpen={setIsVisible}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "0 15px 15px 15px",
          height: "100%",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{
            padding: "0 5px",
            flexDirection: "column",
            height: "fit-content",
            position: "sticky",
            top: "0",
            zIndex: "99999999",
            backgroundColor: "#fff",
          }}
        >
          <div className="cf_new_dashboard_resourceApps_container">
            {topHeaders.map((header, index) => (
              <div className="cf_new_dashboard_info_pannel" key={index}>
                <div
                  className="cf_new_dashboard_info_pannel_title"
                  style={{ gap: "8px" }}
                >
                  <p>{header.title}</p>
                  <span style={{ marginLeft: "auto" }}></span>
                  {header?.icon}
                </div>
                <div className="cf_new_dashboard_info_pannel_body">
                  <p
                    className="cf_new_dashboard_Data"
                    style={{ color: header.color }}
                  >
                    {formatCurrencyShort(header?.value)}
                    {header?.subValue}
                  </p>
                  <p className="cf_new_dashboard_pannel_info">
                    {header?.subtitle}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div
            className="cf_border cf_border_radius cf_overflow_hidden"
            style={{
              backgroundColor: "rgb(255, 255, 255)",
              marginTop: "30px",
            }}
          >
            <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
              <p>AI-Usage Insights</p>
              <p className="cf_new_dashboard_pannel_info">
                Daywise Usage For last 10 days
              </p>
            </div>
            <CustomLineGraphs graphData={graphData} />
          </div>

          <div
            className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
            style={{
              paddingLeft: "0",
            }}
          >
            <p>Day Wise Usage</p>
          </div>
          <div
            className="cf_new_tables_div"
            style={{
              height: "fit-content",
              overflow: "visible",
              overflowX: "auto",
            }}
          >
            <table>
              <thead>
                <tr>
                  <th style={{ width: "150px" }}>Date</th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Lines Added
                  </th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Lines Deleted
                  </th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Tabs Shown
                  </th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Tabs Accepted
                  </th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Premium Requests
                  </th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Agent Requests
                  </th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Chat Requests
                  </th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Models
                  </th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Languages
                  </th>
                </tr>
              </thead>
              <tbody>
                {aiUsageInfo?.reverse()?.map((data, index) => (
                  <tr key={`${index}_usg`}>
                    <td className="cf_new_table_hide_text">
                      <p>{formatDateForGraph(data?.usageOn)}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.totalLinesAdded}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.totalLinesDeleted}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.totalTabsShown}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.totalTabsAccepted}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.premiumRequests}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.agentRequests}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.chatRequests}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.mostUsedModel || "-"}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ textAlign: "center" }}
                    >
                      <p>{data?.mostUsedLanguage || "-"}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Popup>
  );
};

export default UserAIUsageInsights;
