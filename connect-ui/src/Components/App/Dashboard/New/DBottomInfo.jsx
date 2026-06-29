import { Calendar, ChartColumnIncreasing, ChartPie, Database, FileText, Puzzle } from "lucide-react";
import React, { useContext, useEffect, useState } from "react";
import { SET_CLOUDS_LIST, SET_SELECTED_SOURCE_CLOUD } from "../../../../GlobalContext/action.types";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
  collaboratorsCloudsList,
  getCloudName,
} from "../../../helpers/helpers";
import {
  categorizedApps,
  getCloudsList,
  getPotentialCostSaving,
} from "../../../helpers/utils";
import CustomStakedBarGraph from "../../../Resuables/Charts/CustomStakedBarGraph";
import CustomVerticalStakedBarGraph from "../../../Resuables/Charts/CustomVerticalStakedBarGraph";
import PiCharts from "../../../Resuables/Charts/PiCharts";
import { getDepartMentCategoryList, getOrgChart } from "../../UserManagement/UserManagementActions/UserManagementActions";

const DBottomInfo = (props) => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [appData, setAppData] = useState([]);
  const [stackData, setStackData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [categorizedData, setCategorizedData] = useState(null);
  const [billGraph, setBillGraph] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("category");
  const [departmentData, setDepartmentData] = useState([]);
  const [orgChartData, setOrgChartData] = useState([]);
  const [orgPiChart, setOrgPiChart] = useState([]);
  const [activeGraph, setActiveGraph] = useState("TOP_10");
  const [reNewData] = useState([
    {
      cost: "4000",
      appName: "GOOGLE_WORKSPACE",
      active: "108",
      total: "150",
      renews: "10/01/2025",
    },
    {
      cost: "700",
      appName: "BOX_BUSINESS",
      active: "23",
      total: "30",
      renews: "12/02/2025",
    },
    {
      cost: "800",
      appName: "DROPBOX_BUSINESS",
      active: "50",
      total: "80",
      renews: "04/01/2025",
    },
    {
      cost: "1600",
      total: "150",
      active: "140",
      appName: "SLACK",
      renews: "15/04/2025",
    },
  ]);

  useEffect(() => {
    if (props?.billingInfo?.userFinancialMetrics?.length > 0) {
      let newArr = [];
      props?.billingInfo?.userFinancialMetrics
        ?.sort((a, b) => b?.totalCost - a?.totalCost)
        ?.map((data) => {
          let newData = {
            externalProviderName: data?.externalProviderName,
            name:
              data?.vendorName === "OTHERS"
                ? `OTHERS|${data?.externalProviderName}`
                : data?.vendorName,
            "Optimized Cost": data?.totalCost - getPotentialCostSaving(data),
            "Potential Cost Saving": isNaN(getPotentialCostSaving(data))
              ? 0
              : getPotentialCostSaving(data),
          };
          return newData["Optimized Cost"] > 0 ? newArr.push(newData) : "";
        });
      setBillGraph(newArr);
    } else if (props?.billingInfo?.userFinancialMetrics?.length === 0) {
      setBillGraph([]);
    }
  }, [props?.billingInfo]);

  const fetchData = async () => {
    let newArr = [];
    let clouds = await getCloudsList();
    let graphData = [];
    if (clouds?.res?.length > 0) {
      clouds?.res
        ?.filter((data) => {
          return data?.providerName !== "";
        })
        ?.sort((a, b) => b?.provisionedClouds - a?.provisionedClouds)
        ?.map((data, index) => {
          let newData = {
            name:
              data?.providerName === "OTHERS"
                ? `OTHERS|${data?.externalProviderName}`
                : data?.providerName,
            email: data?.adminEmail,
            "Active Users": (() => {
              const v = (data?.activeUsers ?? data?.provisionedClouds) - (data?.guestActiveUsers ?? 0);
              return Number.isFinite(v) ? v : 0;
            })(),
            "In Active Users": (() => {
              const v = (data?.inActiveUSers ?? data?.notProvisioned) - (data?.guestInActiveUSers ?? 0);
              return Number.isFinite(v) ? v : 0;
            })(),
            "Guest Active Users": data?.guestActiveUsers ?? 0,
            "Guest In Active Users": data?.guestInActiveUSers ?? 0,
          };
          return data?.providerName && newData["Active Users"] > 0
            ? graphData.push(newData)
            : "";
        });

      setStackData(
        graphData?.sort((a, b) => b["Active Users"] - a["Active Users"])
      );
      clouds?.res?.map((data) => {
        let newData = {
          ...data,
          name: getCloudName(data?.cloudName ?? data?.providerName),
          tag: collaboratorsCloudsList.includes(data?.providerName)
            ? "Collaborators"
            : "",
          "Active Users": (() => {
            const v = (data?.activeUsers ?? data?.provisionedClouds) - (data?.guestActiveUsers ?? 0);
            return Number.isFinite(v) ? v : 0;
          })(),
          "In Active Users": (() => {
            const v = (data?.inActiveUSers ?? data?.notProvisioned) - (data?.guestInActiveUSers ?? 0);
            return Number.isFinite(v) ? v : 0;
          })(),
          "Guest Active Users": data?.guestActiveUsers ?? 0,
          "Guest In Active Users": data?.guestInActiveUSers ?? 0,
          "Total Groups": 0,
          "Total Resource Apps": 0,
        };
        return newArr.push(newData);
      });
      newArr = newArr.sort((a, b) => b["Active Users"] - a["Active Users"]);
      dispatch({
        type: SET_CLOUDS_LIST,
        payload: newArr,
      });
      setAppData(newArr);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let selectedCategory = localStorage.getItem("selectedCategory");
    if (selectedCategory) {
      setSelectedCategory(selectedCategory);
    }
    let departmentData = localStorage.getItem("departmentData");
    if (departmentData) {
      setDepartmentData(JSON.parse(departmentData));
    }
    fetchData();
    if (globalContext?.cloudsList?.length > 0) {
      setIsLoading(false);
      let graphData = [];
      globalContext?.cloudsList
        ?.filter((data) => {
          return data?.providerName !== "";
        })
        ?.sort((a, b) => b?.provisionedClouds - a?.provisionedClouds)
        ?.map((data, index) => {
          let newData = {
            name: data?.providerName,
            email: data?.adminEmail,
            "Active Users": ((data?.activeUsers ?? data?.provisionedClouds) - (data?.guestActiveUsers ?? 0)) || 0,
            "In Active Users": ((data?.inActiveUSers ?? data?.notProvisioned) - (data?.guestInActiveUSers ?? 0)) || 0,
            "Guest Active Users": data?.guestActiveUsers ?? 0,
            "Guest In Active Users": data?.guestInActiveUSers ?? 0,
          };
          return data?.providerName && newData["Active Users"] > 0
            ? graphData.push(newData)
            : "";
        });

      setStackData(
        graphData?.sort((a, b) => b["Active Users"] - a["Active Users"])
      );
      setAppData(globalContext?.cloudsList);
    } else {
      setIsLoading(true);
    }
  }, []);

  useEffect(() => {
    if (appData?.length > 0) {
      let newArr = [];
      let mapper = {};
      appData?.map((data) => {
        categorizedApps?.MARKETING?.includes(data?.providerName)
          ? (mapper["MARKETING"] = (mapper["MARKETING"] || 0) + 1)
          : categorizedApps?.HR_EMPLOYEE_ENGAGEMENT?.includes(
            data?.providerName
          )
            ? (mapper["HR_EMPLOYEE_ENGAGEMENT"] =
              (mapper["HR_EMPLOYEE_ENGAGEMENT"] || 0) + 1)
            : categorizedApps?.COLLABORATION_COMMUNICATION?.includes(
              data?.providerName
            )
              ? (mapper["COLLABORATION_COMMUNICATION"] =
                (mapper["COLLABORATION_COMMUNICATION"] || 0) + 1)
              : categorizedApps?.PROJECT_MANAGEMENT?.includes(data?.providerName)
                ? (mapper["PROJECT_MANAGEMENT"] =
                  (mapper["PROJECT_MANAGEMENT"] || 0) + 1)
                : categorizedApps?.SCHEDULING?.includes(data?.providerName)
                  ? (mapper["SCHEDULING"] = (mapper["SCHEDULING"] || 0) + 1)
                  : categorizedApps?.NETWORKING_SOFTWARE?.includes(data?.providerName)
                    ? (mapper["NETWORKING_SOFTWARE"] =
                      (mapper["NETWORKING_SOFTWARE"] || 0) + 1)
                    : categorizedApps?.INFRASTRUCTURE_AS_CODE?.includes(
                      data?.providerName
                    )
                      ? (mapper["INFRASTRUCTURE_AS_CODE"] =
                        (mapper["INFRASTRUCTURE_AS_CODE"] || 0) + 1)
                      : categorizedApps?.VIDEO_CONFERENCING?.includes(data?.providerName)
                        ? (mapper["VIDEO_CONFERENCING"] =
                          (mapper["VIDEO_CONFERENCING"] || 0) + 1)
                        : categorizedApps?.AI_ASSISTANT?.includes(data?.providerName)
                          ? (mapper["AI_ASSISTANT"] = (mapper["AI_ASSISTANT"] || 0) + 1)
                          : categorizedApps?.LEARNING_MANAGEMENT_SYSTEM?.includes(
                            data?.providerName
                          )
                            ? (mapper["LEARNING_MANAGEMENT_SYSTEM"] =
                              (mapper["LEARNING_MANAGEMENT_SYSTEM"] || 0) + 1)
                            : categorizedApps?.ASSEMENTS_INTERVIEW?.includes(data?.providerName)
                              ? (mapper["ASSEMENTS_INTERVIEW"] =
                                (mapper["ASSEMENTS_INTERVIEW"] || 0) + 1)
                              : categorizedApps?.DESING?.includes(data?.providerName)
                                ? (mapper["DESING"] = (mapper["DESING"] || 0) + 1)
                                : categorizedApps?.CLOUD_COMPUTING?.includes(data?.providerName)
                                  ? (mapper["CLOUD_COMPUTING"] = (mapper["CLOUD_COMPUTING"] || 0) + 1)
                                  : categorizedApps?.FILE_STORAGE_SHARING?.includes(data?.providerName)
                                    ? (mapper["FILE_STORAGE_SHARING"] =
                                      (mapper["FILE_STORAGE_SHARING"] || 0) + 1)
                                    : categorizedApps?.ASSEMENTS_INTERVIEW?.includes(data?.providerName)
                                      ? (mapper["ASSEMENTS_INTERVIEW"] =
                                        (mapper["ASSEMENTS_INTERVIEW"] || 0) + 1)
                                      : categorizedApps?.IDENTITY_PROVIDER?.includes(data?.providerName)
                                        ? (mapper["IDENTITY_PROVIDER"] =
                                          (mapper["IDENTITY_PROVIDER"] || 0) + 1)
                                        : categorizedApps?.EMPLOYEE_MONITORING_AND_TIME_TRACKING?.includes(
                                          data?.providerName
                                        )
                                          ? (mapper["EMPLOYEE_MONITORING_AND_TIME_TRACKING"] =
                                            (mapper["EMPLOYEE_MONITORING_AND_TIME_TRACKING"] || 0) + 1)
                                          : categorizedApps?.AI_POWERED_CODE_EDITOR?.includes(
                                            data?.providerName
                                          )
                                            ? (mapper["AI_POWERED_CODE_EDITOR"] =
                                              (mapper["AI_POWERED_CODE_EDITOR"] || 0) + 1)
                                            : categorizedApps?.PASSWORD_MANAGER?.includes(data?.providerName)
                                              ? (mapper["PASSWORD_MANAGER"] = (mapper["PASSWORD_MANAGER"] || 0) + 1)
                                              : categorizedApps?.HR_AND_PAYROLL?.includes(data?.providerName)
                                                ? (mapper["HR_AND_PAYROLL"] = (mapper["HR_AND_PAYROLL"] || 0) + 1)
                                                : categorizedApps?.VISUAL_ANALYTICS_PLATFORM?.includes(
                                                  data?.providerName
                                                )
                                                  ? (mapper["VISUAL_ANALYTICS_PLATFORM"] =
                                                    (mapper["VISUAL_ANALYTICS_PLATFORM"] || 0) + 1)
                                                  : categorizedApps?.OTHERS?.includes(data?.providerName)
                                                    ? (mapper["OTHERS"] = (mapper["OTHERS"] || 0) + 1)
                                                    : "";
        return "";
      });
      Object.keys(mapper).map((data) => {
        return newArr.push({
          name: data,
          y: mapper[data],
          // color: getRandomArray(),
        });
      });
      setCategorizedData(newArr);
    } else {
      setCategorizedData([]);
    }
  }, [appData]);


  useEffect(() => {
    if (selectedCategory === "department" || selectedCategory === "orgchart") {
      getDepartmentData();
      // getOrgChartData();
    }
  }, [selectedCategory]);

  const getDepartmentData = async () => {
    let primaryApplication = globalContext?.cloudsList?.find((data) => data?.primaryApp);
    setIsLoading(true);
    let res = await getDepartMentCategoryList(primaryApplication?.id);
    if (res?.status === "OK") {
      if (res?.res?.departMents) {
        if (selectedCategory === "orgchart") {
          let mapper = orgChartData?.orgData?.reduce((acc, org) => {
            acc[org?.parentDepartment] = org?.subDepartments;
            return acc;
          }, {});

          dispatch({
            type: SET_SELECTED_SOURCE_CLOUD,
            payload: mapper,
          })
          let mapper2 = {}
          Object.keys(mapper).map((data) => {
            mapper2[data] = res?.res?.departMents[data];
            mapper[data].map((oor) => {
              mapper2[data] = (res?.res?.departMents[oor] || 0) + mapper2[data];
            })
          })

          let lister = Object.keys(mapper2).map((data) => {
            if (data) {
              return {
                name: `${data}`,
                y: mapper2[data],
                originalName: data,
              }
            } else {
              return "";
            }
          });
          setOrgPiChart(lister);

        } else {
          let lister = Object.keys(res?.res?.departMents).map((data) => {
            if (data) {
              return {
                name: `${data}`,
                y: res?.res?.departMents[data],
                originalName: data,
              }
            } else {
              return "";
            }
          });
          setDepartmentData(lister);
          localStorage.setItem("departmentData", JSON.stringify(lister));
        }
        setIsLoading(false);
      } else {
        setDepartmentData([]);
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    getOrgChartData();
  }, []);

  const getOrgChartData = async () => {
    if (localStorage.getItem("orgChartData") !== "" && localStorage.getItem("orgChartData") !== null && localStorage.getItem("orgChartData") !== "undefined") {
      setOrgChartData(JSON.parse(localStorage.getItem("orgChartData")));
      return;
    }
    let res = await getOrgChart();
    if (res?.status === "OK") {
      if (res?.res) {
        localStorage.setItem("orgChartData", JSON.stringify(res?.res));
        setOrgChartData(res?.res);
      }
    } else {
      setOrgChartData([]);
    }
  }
  return (
    <>
      <div
        className="cf_dBottom_Info_2Pannel"
        style={{
          // gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          justifyContent: "space-between",
        }}
      >
        <div
          className="cf_border cf_border_radius cf_overflow_hidden"
          style={{ backgroundColor: "#fff" }}
        >
          <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexDirection: "row" }}>
            <div>
              <p>{selectedCategory === "category" ? "Apps Based On Category" : "Users Based On Department"}</p>
              <p className="cf_new_dashboard_pannel_info">
                {selectedCategory === "category" ? "Number of applications in each category" : selectedCategory === "orgchart" ? "Number of users in each Org Hierarchy" : "Number of users in each department"}
              </p>
            </div>
            {
              globalContext?.cloudsList?.find((data) => data?.primaryApp)?.id ?
                <div>
                  <select className="cf_new_dashboard_info_pannel_title_select" value={selectedCategory} onChange={(e) => {
                    localStorage.setItem("selectedCategory", e.target.value);
                    setSelectedCategory(e.target.value)
                  }}>
                    <option value="category">Category</option>
                    {
                      orgChartData?.id ?
                        <option value="orgchart">Org View</option>
                        : ""
                    }
                    <option value="department">Department</option>
                  </select></div> : ""
            }
          </div>
          <div>
            {categorizedData?.length > 0 || departmentData?.length > 0 ? (
              <PiCharts
                title={``}
                options={{
                  // customWidth: 690,
                  // customHeight: 340,
                  customWidth: null,
                  customHeight: null,
                  dataLabels: "true",
                  showInLegend: "false",
                }}
                viewType={selectedCategory}
                graphData={selectedCategory === "orgchart" ? orgPiChart : selectedCategory === "category" ? categorizedData : departmentData}
              />
            ) : (categorizedData?.length === 0 || departmentData?.length === 0 || orgPiChart?.length === 0) && !isLoading ? (
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
                  <p style={{ fontSize: "14px" }}>{selectedCategory === "category" ? "No Applications Found" : selectedCategory === "orgchart" ? "No Org Chart Found" : "No Departments Found"}</p>
                </div>
              </div>
            ) : (
              ""
            )}
          </div>
        </div>
        <div className="cf_border cf_border_radius cf_overflow_hidden">
          <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p>{activeGraph === "TOP_10" ? "Top 10 Highest-Spend Applications" : "Cost Breakdown of All Applications"}</p>
              <p className="cf_new_dashboard_pannel_info">
                Organization-Wide Total Cost Breakdown
              </p>
            </div>
            <div class="cf_graph_toggler">
              <div className={`cf_graph_toggler_item ${activeGraph === "TOP_10" ? "cf_graph_toggler_item_active" : ""}`} onClick={() => setActiveGraph("TOP_10")}>
                <ChartColumnIncreasing size={14} color="#64748b" />
                <p style={{ fontSize: "12px" }}>Top 10</p>
              </div>
              <div className={`cf_graph_toggler_item ${activeGraph === "ALL_APPS" ? "cf_graph_toggler_item_active" : ""}`} onClick={() => setActiveGraph("ALL_APPS")}>
                <ChartPie size={14} color="#64748b" />
                <p style={{ fontSize: "12px" }}>All Apps</p>
              </div>
            </div>
          </div>
          <div>
            {billGraph?.length > 0 ? (
              activeGraph === "TOP_10" ? (
                <CustomStakedBarGraph graphData={billGraph?.slice(0, 11)} />
              ) : (
                <PiCharts
                  title={``}
                  options={{
                    customWidth: null,
                    customHeight: null,
                    dataLabels: "true",
                    showInLegend: "false",
                  }}
                  customLink={false}
                  viewType="ALL_APPS"
                  graphData={billGraph?.reduce((acc, data) => {
                    acc.push({
                      name: data?.name?.includes("|") ? data?.name?.split("|")[1] : data?.name,
                      y: data?.["Optimized Cost"] + data?.["Potential Cost Saving"],
                    });
                    return acc;
                  }, [])}
                />
              )
            ) : billGraph?.length === 0 && billGraph !== null ? (
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
                    <Database size={50} color="#64748b" />
                  </div>
                  <p style={{ fontSize: "14px" }}>No data available</p>
                </div>
              </div>
            ) : (
              ""
            )}
          </div>
        </div>
      </div>
      <div
        className="cf_dBottom_Info"
        style={{
          gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
          paddingBottom: "10px",
        }}
      >
        <div className="cf_dBottom_Info_Graph">
          <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
            {/* <p>License Utilization</p> */}
            <p>Top 10 Applications by Active and Inactive Users</p>
            {/* Active users vs total licenses per application */}
            <p className="cf_new_dashboard_pannel_info">
              Active Users vs In Active Users
            </p>
          </div>
          <div
            className="cf_new_dashboard_info_graph_pannel_body"
            style={{
              minHeight: "370px",
              height: "auto",
              maxHeight: "max-content",
            }}
          >
            {stackData?.length > 0 && !isLoading ? (
              <CustomVerticalStakedBarGraph
                customData={stackData?.slice(0, 11)}
              />
            ) : stackData?.length === 0 && !isLoading ? (
              <div className="cf_new_dashboard_info_graph_container">
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
                    <FileText size={50} color="#64748b" />
                  </div>
                  <p style={{ fontSize: "14px" }}>
                    No data available to track license utilization.
                  </p>
                </div>
              </div>
            ) : isLoading ? (
              reNewData.map((data, index) => {
                return (
                  <div
                    className="cf_new_dashboard_info_graph_container"
                    key={data?.appName + index}
                  >
                    <div className="cf_new_dashboard_info_graph_container_details">
                      <div>
                        <p
                          className="cf_new_dashboard_info_graph_container_details_app_name skeletonData"
                          style={{ width: "fit-content" }}
                        >
                          {data?.appName}
                        </p>
                        <p style={{ height: "5px", visibility: "hidden" }}>
                          sdada
                        </p>
                        <p
                          className="cf_new_dashboard_info_graph_container_details_app_licensesInfo skeletonData"
                          style={{ width: "fit-content" }}
                        >
                          {0} active / {0} total
                        </p>
                      </div>
                      <p
                        className="cf_new_dashboard_info_graph_container_details_app_licensesInfo skeletonData"
                        style={{ fontWeight: "500" }}
                      >
                        99%
                      </p>
                    </div>
                    <div className="cf_new_dashboard_info_graph_container_bar">
                      <div
                        className="cf_new_dashboard_info_graph_container_bar_filler skeletonData"
                        style={{
                          width: `${Math.abs(
                            (data["Active Users"] / data["Total Users"]) * 100
                          ).toFixed(0)}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                );
              })
            ) : (
              ""
            )}
          </div>
        </div>
        <div className="cf_dBottom_Info_Renewals" style={{ display: "none" }}>
          <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment">
            <p>Upcoming Renewals</p>
            <p className="cf_new_dashboard_pannel_info">
              Next subscription renewal dates
            </p>
          </div>
          <div className="cf_new_dashboard_info_graph_pannel_body">
            {!isLoading && appData?.length === 0 ? (
              <div className="cf_new_dashboard_info_graph_container">
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
                    <Calendar size={50} color="#64748b" />
                  </div>
                  <p style={{ fontSize: "14px" }}>No renewals scheduled</p>
                </div>
              </div>
            ) : (
              ""
            )}
            {isLoading
              ? reNewData.map((data, index) => {
                return (
                  <div
                    className="cf_new_dashboard_info_graph_container"
                    key={`TEST_${data?.appName}_${index}`}
                    style={{ height: "60px" }}
                  >
                    <div className="cf_new_dashboard_info_graph_container_details">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "15px",
                        }}
                      >
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            display: "flex",
                            alignItems: "center",
                            borderRadius: "0.5rem",
                            justifyContent: "center",
                            backgroundColor: "#0022701a",
                          }}
                          className="skeletonData"
                        >
                          {/* <Calendar size={16} strokeWidth={2} color="#001a6f" /> */}
                        </div>
                        <div>
                          <p
                            className="cf_new_dashboard_info_graph_container_details_app_name skeleton"
                            style={{ height: "15px", width: "fit-content" }}
                          >
                            {getCloudName(data?.appName)}
                          </p>
                          <p
                            style={{
                              height: "5px",
                              visibility: "hidden",
                              width: "fit-content",
                            }}
                          >
                            sdada
                          </p>
                          <p
                            className="cf_new_dashboard_info_graph_container_details_app_licensesInfo skeleton"
                            style={{ height: "15px", width: "fit-content" }}
                          >
                            Renews on 21/04/1998
                          </p>
                        </div>
                      </div>
                      <div>
                        <p
                          className="cf_new_dashboard_info_graph_container_details_app_name skeletonData"
                          style={{
                            textAlign: "right",
                            height: "15px",
                            width: "fit-content",
                            marginLeft: "auto",
                          }}
                        >
                          ${data?.cost ?? "000"}
                        </p>
                        <p style={{ height: "5px", visibility: "hidden" }}>
                          sdada
                        </p>
                        <p
                          className="cf_new_dashboard_info_graph_container_details_app_licensesInfo skeletonData"
                          style={{ fontWeight: "400", height: "15px" }}
                        >
                          Annual cost
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
              : ""}
            {appData?.map((data, index) => {
              return data?.providerName ? (
                <div
                  className="cf_new_dashboard_info_graph_container"
                  key={`${index}_TEST_${data?.cloudName ?? data?.providerName}`}
                  style={{ height: "60px", animationDelay: `${index * 0.15}s` }}
                >
                  <div className="cf_new_dashboard_info_graph_container_details">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "15px",
                      }}
                    >
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          display: "flex",
                          alignItems: "center",
                          borderRadius: "0.5rem",
                          justifyContent: "center",
                          backgroundColor: "#0022701a",
                        }}
                      >
                        <Calendar size={16} strokeWidth={2} color="#001a6f" />
                      </div>
                      <div>
                        <p className="cf_new_dashboard_info_graph_container_details_app_name">
                          {getCloudName(data?.cloudName ?? data?.providerName)}
                        </p>
                        <p className="cf_new_dashboard_info_graph_container_details_app_licensesInfo">
                          Renews on {data?.renews}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p
                        className="cf_new_dashboard_info_graph_container_details_app_name"
                        style={{ textAlign: "right" }}
                      >
                        ${data?.cost ?? 0}
                      </p>
                      <p
                        className="cf_new_dashboard_info_graph_container_details_app_licensesInfo"
                        style={{ fontWeight: "400" }}
                      >
                        Annual cost
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                ""
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};

export default DBottomInfo;
