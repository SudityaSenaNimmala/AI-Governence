import moment from "moment";
import Popup from "../../../Resuables/Popup/Popup";
import SvgName from "../../../Testing/SvgName";
import CustomLineGraphs from "../../../Resuables/Charts/CustomLineGraphs";
import { AppWindowMac, Bot, Clock, Code, TrendingDown, TrendingUp } from "lucide-react";
import { getAIUsageInsights, getInsightFullAppUsageInsights } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { useContext, useEffect, useState } from "react";
import {
  formatCurrencyShort,
  formatDataForGraph,
  formatDateForGraph,
} from "../../../helpers/utils";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";

const InsightFullAppUsage = ({
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
  const [currentAppData, setCurrentAppData] = useState(null);
  const [lastAppData, setLastAppData] = useState(null);
  const [filterDays, setFilterDays] = useState(7);
  const [topHeaders, setTopHeaders] = useState([
    {
      id: "linesAdded",
      title: "Total Applications Used",
      icon: <AppWindowMac size={16} strokeWidth={2} color="#64748b" />,
      subtitle: `Total Applications Used In Last ${filterDays} Days`,
      linesDeleted: 0,
      color: "#3b82f6",
    },
    {
      id: "tabsShown",
      title: "Total Time Spent On Applications",
      icon: <Clock size={16} strokeWidth={2} color="#64748b" />,
      subtitle: `Total Time Spent On Applications In Last ${filterDays} Days`,
      tabsAccepted: 0,
      color: "#001a6f",
    },
    {
      id: "mostUsedModels",
      title: "Most Used Application",
      icon: <AppWindowMac size={16} strokeWidth={2} color="#64748b" />,
      subtitle: `Most Used Application In Last ${filterDays} Days`,
      color: "#f59e0b",
    }
  ]);
  const [searchValue, setSearchValue] = useState("");
  const [topHeadersLast, setTopHeadersLast] = useState([{
    id: "linesAdded",
  }, {
    id: "tabsShown",
  }, {
    id: "mostUsedModels",
  }])

  useEffect(() => {
    if (selectedUser?.id || selectedUser?.groupName) {
      getInsightFullAppUsage("initial");
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

  const msToHours = (ms) => {
    if (ms == null || ms < 0) return "0 Sec";
    const totalSeconds = Math.floor(ms / 1000);
    const totalMinutes = Math.floor(ms / 1000 / 60);
    if (totalMinutes < 1) return `${totalSeconds} Sec`;
    if (totalMinutes < 60) {
      const sec = totalSeconds % 60;
      return sec > 0 ? `${totalMinutes} Min ${sec} Sec` : `${totalMinutes} Min`;
    }
    const hours = (ms / 1000 / 60 / 60).toFixed(2);
    return `${hours} Hrs`;
  };


  const getTimeStamps = (time = 1) => {

    if (time === 1) {
      return {
        endDate: moment().format('YYYY-MM-DD'),
        startDate: moment().subtract(7, 'days').format('YYYY-MM-DD'),
      }
    } else {
      return {
        endDate: moment().subtract(7, 'days').format('YYYY-MM-DD'),
        startDate: moment().subtract(14, 'days').format('YYYY-MM-DD'),
      }
    }
  }

  const getInsightFullAppUsage = async (action = "initial") => {
    setIsPageLoading(true);
    let timeStamps = getTimeStamps(1);
    if (action === "last") {
      timeStamps = getTimeStamps(2);
    }
    console.log(timeStamps);
    let res = await getInsightFullAppUsageInsights(
      selectedUser?.adminCloudId || id,
      selectedUser?.memberId,
      new Date(timeStamps?.startDate).getTime(),
      new Date(timeStamps?.endDate).getTime()
    );
    if (res?.status === "OK") {
      if (res?.res?.apps?.length > 0) {
        let appMap = res?.res?.apps?.reduce((acc, curr) => {
          return {
            ...acc,
            [curr?.appName]: curr?.usage,
          }
        }, {});
        let totalHoursUsed = res?.res?.totalUsage ? msToHours(res?.res?.totalUsage) : 0;
        if (action !== "last") {
          topHeaders[0].value = res?.res?.apps?.length;
          topHeaders[1].value = totalHoursUsed;
          topHeaders[2].value = res?.res?.apps[0]?.appName;
          setTopHeaders(topHeaders);
          setCurrentAppData({ ...res?.res, appMap: appMap });
        } else {
          topHeadersLast[0].finalValue = res?.res?.apps?.length;
          topHeadersLast[1].finalValue = totalHoursUsed;
          // topHeadersLast[2].finalValue = res?.res?.apps[0]?.appName;
          setTopHeadersLast(topHeadersLast);
          setLastAppData({ ...res?.res, appMap: appMap });
        }
      } else {
        if (action !== "last") {
          setCurrentAppData(0);
        } else {
          setLastAppData(0);
        }
      }

      if (action !== "last") {
        getInsightFullAppUsage("last");
      }

      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
      setIsVisible(false);
    }
  };

  const trendTooltipText = `Compared with the previous ${filterDays} days.`;

  const trendGraphData = (data) => {
    const currentUsage = data?.usage ?? 0;
    const lastUsage = lastAppData?.appMap?.[data?.appName];
    if (lastUsage == null || lastUsage === 0) return null;
    const percentChange = ((currentUsage - lastUsage) / lastUsage) * 100;
    const trendUp = percentChange >= 0;
    const trendColor = trendUp ? "#22c55e" : "#ef4444";
    return (
      <div title={trendTooltipText} className="CF_d-flex" style={{ gap: "6px", alignItems: "center", marginTop: "2px" }}>
        {trendUp ? (
          <TrendingUp size={18} strokeWidth={2.5} color={trendColor} />
        ) : (
          <TrendingDown size={18} strokeWidth={2.5} color={trendColor} />
        )}
        <span style={{ fontWeight: 500, color: trendColor, fontSize: "12px" }}>
          {Math.abs(percentChange).toFixed(1)} %
        </span>
      </div>
    );
  };

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: `${selectedUser?.firstName ||
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
          <div className="cf_new_dashboard_resourceApps_container" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            {topHeaders.map((header, index) => {
              const isFirstTwo = index < 2;
              const currentNum = isFirstTwo
                ? (index === 0 ? Number(header?.value) ?? 0 : parseFloat(String(header?.value).replace(/[^\d.-]/g, "")) || 0)
                : 0;
              const lastNum = isFirstTwo && topHeadersLast[index]?.finalValue != null
                ? (index === 0 ? Number(topHeadersLast[index]?.finalValue) ?? 0 : parseFloat(String(topHeadersLast[index]?.finalValue).replace(/[^\d.-]/g, "")) || 0)
                : 0;
              const percentChange = isFirstTwo && lastNum !== 0
                ? ((currentNum - lastNum) / lastNum) * 100
                : null;
              const trendUp = percentChange != null && percentChange >= 0;
              const trendColor = percentChange == null ? "#94a3b8" : trendUp ? "#22c55e" : "#ef4444";
              return (
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
                    <div className="CF_d-flex" style={{ gap: "6px" }}>
                      <p
                        className="cf_new_dashboard_Data"
                        style={{ color: header.color }}
                      >
                        {index === 1 && typeof header?.value === "string" ? header.value : formatCurrencyShort(header?.value)}
                        {/* {header?.subValue} */}
                      </p>
                      {isFirstTwo && (
                        <div
                          className="CF_d-flex"
                          style={{ gap: "5px", alignItems: "flex-end", paddingBottom: "4px" }}
                          title={trendTooltipText}
                        >
                          {percentChange != null && (
                            <span style={{ display: "flex", alignItems: "center" }}>
                              {trendUp ? (
                                <TrendingUp size={20} strokeWidth={2.5} color={trendColor} />
                              ) : (
                                <TrendingDown size={20} strokeWidth={2.5} color={trendColor} />
                              )}
                            </span>
                          )}
                          {percentChange != null && (
                            <p
                              className="cf_new_dashboard_pannel_info"
                              style={{
                                marginTop: 0,
                                fontWeight: 600,
                                color: trendColor,
                                fontSize: "12px",
                              }}
                            >
                              {Math.abs(percentChange).toFixed(1)}%
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="cf_new_dashboard_pannel_info">
                      {header?.subtitle}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment"
            style={{
              paddingLeft: "0",
            }}
          >
            <p>Applications Usage Insights(Last {filterDays} Days)</p>
          </div>
          <SearchComponent
            inputPlaceHolder="Search By Application Name"
            value={searchValue}
            autoOpen={true}
            onInputSearch={(e) => setSearchValue(e?.searchInput)}
          />
          {console.log(searchValue)}
          <div
            className="cf_new_tables_div"
            style={{
              height: "fit-content",
              overflow: "visible",
              overflowX: "auto",
              marginTop: "10px"
            }}
          >
            <table>
              <thead>
                <tr>
                  <th style={{ width: "80%" }}>
                    Application Name
                  </th>
                  <th style={{ width: "20%" }}>
                    Time Spent
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentAppData?.apps?.filter((data) => {
                  if (searchValue) {
                    return data?.appName?.toLowerCase().includes(searchValue?.toLowerCase());
                  } else {
                    return true;
                  }
                })?.map((data, index) => (
                  <tr key={`${index}_usg`}>
                    <td
                      className="cf_new_table_hide_text"
                    >
                      <p>{data?.appName}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                    >
                      <div className="CF_d-flex" style={{ gap: "6px", alignItems: "center" }}>
                        <p style={{ width: "fit-content" }}>{msToHours(data?.usage)}</p>
                        {trendGraphData(data)}
                      </div>
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

export default InsightFullAppUsage;
