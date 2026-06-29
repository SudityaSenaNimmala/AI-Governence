import { DollarSign, Users } from "lucide-react";
import moment from "moment";
import React, { useContext, useEffect, useState } from "react";
import { SET_BILLING_SUMMARY } from "../../../../../GlobalContext/action.types";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { getCloudName, getRandomArray } from "../../../../helpers/helpers";
import {
  categorizedAppsNames,
  combinationTypes,
  getCategoryForCloud,
  makeDataForCalender,
  notifyToast,
} from "../../../../helpers/utils";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../../../Resuables/InputsComponents/TextInput";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import Popup from "../../../../Resuables/Popup/Popup";
import {
  getSaaSCostingWithAppList,
  updateCostPerLicense,
} from "../../DashboardActions/DashboardActions";

const AppConsolidationReports = () => {
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [searchVal, setSearchVal] = useState("");
  const [totalBilling, setTotalBilling] = useState({});
  const { dispatch } = useContext(GlobalContext);
  const [optimizationSuggestions, setOptimizationSuggestions] = useState([]);
  const [editLicense, setEditLicense] = useState({
    totalLicense: 0,
    costPerLicense: 0,
    currentIndex: 0,
    cloudName: "",
    memberId: "",
  });

  useEffect(() => {
    fetchSaaSCosting();
    // getOptimizationReport();
  }, []);

  const fetchSaaSCosting = async () => {
    setIsLoading(true);
    let mondifiedVendors = [];
    try {
      let res = await getSaaSCostingWithAppList();
      if (res?.status === "OK") {
        if (res?.res?.userFinancialMetrics[0]?.vendorName) {
          let calData = makeDataForCalender(res?.res?.userFinancialMetrics);
          mondifiedVendors = res?.res?.userFinancialMetrics?.map((data) => {
            return {
              ...data,
              costPerUser:
                data?.totalCost && data?.billableUserCount
                  ? Math.round(data?.totalCost / data?.billableUserCount)
                  : 0,
              tagName: getCategoryForCloud(data?.vendorName),
            };
          });
          setTotalBilling({
            ...res?.res,
            userFinancialMetrics: mondifiedVendors,
          });
          dispatch({
            type: SET_BILLING_SUMMARY,
            payload: { ...res?.res, calenderData: calData },
          });
        } else {
          notifyToast("error", "No Data Found");
          setTotalBilling({});
        }
      }

      // let suggestion = await getOptimizationSuggestion();
    } catch (e) {
    } finally {
      setIsLoading(false);
    }
  };

  const updateCostInfo = async () => {
    setIsVisible(false);
    setIsPageLoading(true);
    let res = await updateCostPerLicense(
      editLicense?.memberId,
      editLicense?.cloudName,
      editLicense?.costPerLicense,
      editLicense?.totalLicense
    );
    if (res?.status === "OK") {
      setIsPageLoading(false);
      notifyToast("success", "Cost Per License Updated Successfully");
      let copyInfo = [...totalBilling?.userFinancialMetrics];
      totalBilling?.userFinancialMetrics?.map((data, index) => {
        if (data?.memberId === editLicense?.memberId) {
          copyInfo[index] = {
            ...copyInfo[index],
            ...res?.res,
          };
        }
      });
      setTotalBilling({ ...totalBilling, userFinancialMetrics: copyInfo });
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Error Updating Cost Per License");
    }
  };

  const getSuggestionsText = (type) => {
    let leastCost = 0;
    let leastCostCloud = "";
    let highestCost = 0;
    let highestCostCloud = "";
    totalBilling?.userFinancialMetrics
      ?.filter((res) => res?.tagName === type)
      .map((data) => {
        if (data?.totalCost && data?.billableUserCount) {
          if (leastCost === 0) {
            leastCost = data?.costPerUser;
            leastCostCloud = data?.vendorName;
          } else if (leastCost > data?.costPerUser) {
            leastCost = data?.costPerUser;
            leastCostCloud = data?.vendorName;
          }
          if (highestCost === 0) {
            highestCost = data?.costPerUser;
            highestCostCloud = data?.vendorName;
          } else if (highestCost < data?.costPerUser) {
            highestCost = data?.costPerUser;
            highestCostCloud = data?.vendorName;
          }
        }
      });

    let billingMapper = {};

    totalBilling?.userFinancialMetrics
      ?.filter((data) => {
        return data?.tagName === type && data?.vendorName !== leastCostCloud;
      })
      ?.map((res) => {
        billingMapper = {
          ...billingMapper,
          [res?.vendorName]: {
            totalBilling: res?.totalCost,
            billingUsersCount: res?.billableUserCount,
          },
        };
      });

    let billingMapperValues = Object.values(billingMapper);
    let savingAmount = 0;

    billingMapperValues?.map((data) => {
      if (data?.totalBilling && data?.billingUsersCount) {
        let newCost = data?.totalBilling - data?.billingUsersCount * leastCost;
        savingAmount += newCost;
      }
    });

    return `${getCloudName(
      leastCostCloud
    )} is the affordable platform to use with $${leastCost} per user so migrating users to ${getCloudName(
      leastCostCloud
    )} will save you $${savingAmount}`;
  };

  const getCostPerUser = (data) => {
    if (data?.costPerUser === "Infinity") return 0;
    if (data?.costPerUser)
      return data?.costPerUser;
    return data?.costPerUser === 0
      ? isNaN(data?.totalCost / data?.activeUserCount)
        ? "0"
        : (data?.totalCost / data?.activeUserCount)?.toString() !== "Infinity"
        ? (data?.totalCost / data?.activeUserCount)?.toFixed(2)
        : "0"
      : "0";
  };

  return (
    <>
      <div className="cf_main_container" style={{ overflow: "hidden" }}>
        <SideNav activeTab="Dashboard" />
        <div className="cf_main_content_place">
          <TopNav
            pageName="App Consolidation Report"
            backLink="/Integrations/Manage"
          />

          <div
            className="cf_main_content_place_main"
            style={{
              padding: "10px 0",
              flexDirection: "column",
              gap: "15px",
              height: "calc(100vh - 135px)",
            }}
          >
            <div
              className="cf_saas_cloudPlacer cf_saas_cloudPlacer_Analytics_Insightes"
              style={{ marginTop: "0" }}
            >
              {isLoading ? (
                <>
                  {getRandomArray(2)?.map((data) => {
                    return (
                      <div
                        key={`{tes_${data}}`}
                        className="cf_new_dashboard_info_pannel cf_main_saas_selector"
                        style={{
                          paddingLeft: "0",
                          paddingRight: "0",
                        }}
                      >
                        <div style={{ padding: "0 1.5rem 0 1.5rem" }}>
                          <div className="cf_main_saas_selector_img_container ai-center">
                            <div
                              className={`cf_main_saas_selector_img_35 bg_35- skeletonDataNew`}
                            ></div>
                            <p className="cf_saas_menu_title_container_head skeletonDataNew">
                              Box Business
                            </p>
                          </div>
                          <div
                            className="cf_saas_menu_title_container CF_d-flex ai-center"
                            style={{
                              justifyContent: "space-between",
                              width: "90%",
                              paddingTop: "1rem",
                            }}
                          >
                            <div
                              className="CF_d-flex ai-center"
                              style={{ gap: "10px" }}
                            >
                              <div
                                className="skeletonDataNew"
                                style={{ width: "20px", height: "20px" }}
                              ></div>
                              <div
                                className="CF_d-flex"
                                style={{
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                <p
                                  style={{
                                    color: "#000",
                                    width: "fit-content",
                                  }}
                                  className="skeletonDataNew"
                                >
                                  Total Users
                                </p>
                                <p
                                  className="cf_saas_menu_title_container_head skeletonDataNew"
                                  style={{
                                    fontSize: "22px",
                                    fontWeight: "500",
                                    width: "fit-content",
                                  }}
                                >
                                  150
                                </p>
                              </div>
                            </div>
                            <div
                              className="CF_d-flex ai-center"
                              style={{ gap: "10px" }}
                            >
                              <div
                                className="skeletonDataNew"
                                style={{ width: "20px", height: "20px" }}
                              ></div>
                              <div
                                className="CF_d-flex"
                                style={{
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                <p
                                  style={{
                                    color: "#000",
                                    width: "fit-content",
                                  }}
                                  className="skeletonDataNew"
                                >
                                  Total Cost
                                </p>
                                <p
                                  className="cf_saas_menu_title_container_head skeletonDataNew"
                                  style={{
                                    fontSize: "22px",
                                    fontWeight: "500",
                                    width: "fit-content",
                                  }}
                                >
                                  4500
                                </p>
                              </div>
                            </div>
                            <div
                              className="CF_d-flex ai-center"
                              style={{ gap: "10px" }}
                            >
                              <div
                                className="skeletonDataNew"
                                style={{ width: "20px", height: "20px" }}
                              ></div>
                              <div
                                className="CF_d-flex"
                                style={{
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                <p
                                  style={{ color: "#000" }}
                                  className="skeletonDataNew"
                                >
                                  Potential Savings
                                </p>
                                <p
                                  className="cf_saas_menu_title_container_head skeletonDataNew"
                                  style={{
                                    fontSize: "22px",
                                    fontWeight: "500",
                                  }}
                                >
                                  $300
                                </p>
                              </div>
                            </div>
                          </div>
                          <div
                            className="cf_saas_menu_title_container CF_d-flex ai-center"
                            style={{
                              justifyContent: "space-between",
                              width: "100%",
                              flexDirection: "column",
                              paddingTop: "1rem",
                            }}
                          >
                            <div
                              className="CF_d-flex"
                              style={{
                                flexDirection: "column",
                                width: "100%",
                                gap: "5px",
                              }}
                            >
                              <p
                                className="cf_saas_menu_title_container_head skeletonDataNew"
                                style={{
                                  fontSize: "14px",
                                  fontWeight: "400",
                                }}
                              >
                                User Activity
                              </p>
                              <div className="cf_new_dashboard_info_graph_container_bar">
                                <div
                                  className="cf_new_dashboard_info_graph_container_bar_filler skeletonData"
                                  style={{
                                    width: `100%`,
                                  }}
                                ></div>
                              </div>
                              <div
                                className="CF_d-flex"
                                style={{ justifyContent: "space-between" }}
                              >
                                <p
                                  style={{
                                    color: "#71717A",
                                    fontWeight: "300",
                                    fontSize: "12px",
                                  }}
                                  className="skeletonDataNew"
                                >
                                  Active: 128
                                </p>
                                <p
                                  style={{
                                    color: "#71717A",
                                    fontWeight: "300",
                                    fontSize: "12px",
                                  }}
                                  className="skeletonDataNew"
                                >
                                  Inactive: 22
                                </p>
                              </div>
                            </div>
                          </div>
                          <div
                            className="cf_saas_menu_title_container CF_d-flex ai-center"
                            style={{
                              justifyContent: "space-between",
                              width: "100%",
                              flexDirection: "column",
                              paddingTop: "1rem",
                            }}
                          >
                            <div
                              className="CF_d-flex"
                              style={{
                                flexDirection: "column",
                                width: "100%",
                                gap: "5px",
                              }}
                            >
                              <p
                                className="cf_saas_menu_title_container_head skeletonDataNew"
                                style={{
                                  fontSize: "14px",
                                  fontWeight: "400",
                                }}
                              >
                                Cost Breakdown
                              </p>
                              <div
                                className="cf_new_dashboard_info_graph_container_bar"
                                style={{
                                  height: "10px",
                                  borderRadius: "9999px",
                                }}
                              >
                                <div
                                  className="cf_new_dashboard_info_graph_container_bar_filler skeletonData"
                                  style={{
                                    width: `100%`,
                                    background: "#22C55E",
                                  }}
                                ></div>
                              </div>
                              <div
                                className="CF_d-flex"
                                style={{ justifyContent: "space-between" }}
                              >
                                <p
                                  style={{
                                    color: "#22C55E",
                                    fontWeight: "300",
                                    fontSize: "12px",
                                    width: "fit-content",
                                  }}
                                  className="skeletonDataNew"
                                >
                                  Optimized Cost: $4500
                                </p>
                                <p
                                  style={{
                                    color: "#DC2626",
                                    fontWeight: "300",
                                    fontSize: "12px",
                                    width: "fit-content",
                                  }}
                                  className="skeletonDataNew"
                                >
                                  Potential Savings: $300
                                </p>
                              </div>
                            </div>
                          </div>
                          <div style={{ padding: "12px 0" }}>
                            <p
                              style={{
                                color: "#71717A",
                                fontWeight: "400",
                                fontSize: "12px",
                                width: "fit-content",
                              }}
                              className="skeletonDataNew"
                            >
                              Last updated: October 30, 2024 at 01:43 PM
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  {combinationTypes?.map((cloudTypes) => {
                    return totalBilling?.userFinancialMetrics.filter((res) => {
                      return res?.tagName === categorizedAppsNames(cloudTypes);
                    })?.length > 1 ? (
                      <div className="cf_saas_cloudPlacer_WithTag_Container">
                        <div className="cf_saas_cloudPlacer_WithTag_Header">
                          <div>
                            <p className="cf_saas_cloudPlacer_WithTag_Header_Title">
                              {categorizedAppsNames(cloudTypes)}
                            </p>
                            {/* <p className="cf_saas_cloudPlacer_WithTag_Header_subTitle">
                              {messageMigrationErrorMessages(cloudTypes)}
                            </p> */}
                          </div>
                          <div
                            style={{ marginLeft: "auto" }}
                            className="cf_saas_consoladitionReport_Count_Info"
                          >
                            <div className="cf_saas_consoladitionReport_Count_Info_Item">
                              <Users size={14} />
                              <p
                                style={{ fontSize: "12px", fontWeight: "600" }}
                              >
                                {totalBilling?.userFinancialMetrics
                                  .filter((res) => {
                                    return (
                                      res?.tagName ===
                                      categorizedAppsNames(cloudTypes)
                                    );
                                  })
                                  ?.reduce(
                                    (a, b) => a + b?.totalUserCount,
                                    0
                                  )}{" "}
                                Total Users
                              </p>
                            </div>
                            <div className="cf_saas_consoladitionReport_Count_Info_Item">
                              <DollarSign size={14} />
                              <p
                                style={{ fontSize: "12px", fontWeight: "600" }}
                              >
                                {totalBilling?.userFinancialMetrics
                                  .filter((res) => {
                                    return (
                                      res?.tagName ===
                                      categorizedAppsNames(cloudTypes)
                                    );
                                  })
                                  ?.reduce((a, b) => a + b?.totalCost, 0)
                                  .toFixed(2)}{" "}
                                Total Cost
                              </p>
                            </div>
                          </div>
                        </div>
                        {optimizationSuggestions
                          ?.filter((res) => {
                            return (
                              res?.tagName === categorizedAppsNames(cloudTypes)
                            );
                          })
                          ?.map((data) => {
                            return "";
                          })}
                        <div className="cf_saas_cloudPlacer_WithTag">
                          {totalBilling?.userFinancialMetrics
                            .filter((res) => {
                              return (
                                res?.tagName ===
                                categorizedAppsNames(cloudTypes)
                              );
                            })
                            ?.sort(
                              (a, b) =>
                                b["totalUserCount"] - a["totalUserCount"]
                            )
                            ?.sort((a, b) => b["totalCost"] - a["totalCost"])
                            ?.sort((a, b) => {
                              if (a["costPerUser"] === 0 || a["costPerUser"] === "Infinity") return 1;
                              if (b["costPerUser"] === 0 || b["costPerUser"] === "Infinity") return -1;
                              return a["costPerUser"] - b["costPerUser"];
                            })
                            ?.map((data, index) => {
                              return (
                                <div
                                  key={`${data?.vendorName}_${index}`}
                                  className="cf_new_dashboard_info_pannel cf_main_saas_selector"
                                  style={{
                                    paddingLeft: "0",
                                    paddingRight: "0",
                                    animationDelay: `${index * 0.1}s`,
                                  }}
                                >
                                  <div style={{ padding: "0 1.5rem 0 1.5rem" }}>
                                    <div className="cf_main_saas_selector_img_container ai-center">
                                      <div
                                        className={`cf_main_saas_selector_img_35 bg_35-${data?.vendorName}`}
                                      ></div>
                                      <div
                                        className="CF_d-flex"
                                        style={{
                                          flexDirection: "column",
                                          gap: "4px",
                                        }}
                                      >
                                        <p className="cf_saas_menu_title_container_head">
                                          {data?.vendorName === "OTHERS"
                                            ? data?.externalProviderName
                                            : getCloudName(
                                                data?.vendorName
                                              )}{" "}
                                        </p>
                                      </div>
                                      <div
                                        className="cf_saas_menu_title_container_head"
                                        style={{ marginLeft: "auto" }}
                                      >
                                        <p
                                          style={{
                                            fontWeight: "500",
                                            textAlign: "right",
                                          }}
                                        >
                                          ${data?.totalCost?.toFixed(2)}
                                        </p>
                                        {data?.totalCost &&
                                        data?.totalUserCount ? (
                                          <p
                                            style={{
                                              fontWeight: "400",
                                              fontSize: "14px",
                                              color: "#71717A",
                                            }}
                                          >
                                            {/* ${data?.costPerUser?.toFixed(2)} */}
                                            ${getCostPerUser(data)}
                                            /User
                                          </p>
                                        ) : (
                                          <p
                                            style={{
                                              fontWeight: "400",
                                              fontSize: "14px",
                                              color: "#71717A",
                                            }}
                                          >
                                            ${getCostPerUser(data)}
                                            /User
                                          </p>
                                        )}
                                      </div>
                                    </div>

                                    <div
                                      className="cf_saas_menu_title_container CF_d-flex ai-center"
                                      style={{
                                        justifyContent: "space-between",
                                        width: "100%",
                                        flexDirection: "column",
                                        paddingTop: "1rem",
                                      }}
                                    >
                                      <div
                                        className="CF_d-flex"
                                        style={{
                                          flexDirection: "column",
                                          width: "100%",
                                          gap: "5px",
                                        }}
                                      >
                                        <p
                                          className="cf_saas_menu_title_container_head"
                                          style={{
                                            fontSize: "14px",
                                            fontWeight: "400",
                                          }}
                                        >
                                          User Activity
                                        </p>
                                        <div className="cf_new_dashboard_info_graph_container_bar">
                                          <div
                                            className="cf_new_dashboard_info_graph_container_bar_filler"
                                            style={{
                                              width: `${Math.abs(
                                                (data?.activeUserCount /
                                                  data?.totalUserCount) *
                                                  100
                                              ).toFixed(0)}%`,
                                            }}
                                          ></div>
                                        </div>
                                        <div
                                          className="CF_d-flex"
                                          style={{
                                            justifyContent: "space-between",
                                          }}
                                        >
                                          <p
                                            style={{
                                              color: "#71717A",
                                              fontWeight: "300",
                                              fontSize: "12px",
                                            }}
                                          >
                                            Active: {data?.activeUserCount}
                                          </p>
                                          <p
                                            style={{
                                              color: "#71717A",
                                              fontWeight: "300",
                                              fontSize: "12px",
                                            }}
                                          >
                                            Inactive: {data?.inactiveUserCount}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                    <div style={{ padding: "12px 0" }}>
                                      <p
                                        style={{
                                          color: "#71717A",
                                          fontWeight: "400",
                                          fontSize: "12px",
                                        }}
                                      >
                                        {data?.lastUpdated
                                          ? `Last updated:
                                          ${moment(data?.lastUpdated).format(
                                            "MMMM Do YYYY, h:mm:ss a"
                                          )}`
                                          : ""}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    ) : (
                      ""
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <Popup
        options={{
          isOpen: isVisible,
          title: `Edit Cost Per License for ${getCloudName(
            editLicense?.cloudName
          )}`,
          popupWidth: "30%",
          popupHeight: `250px`,
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{ padding: "20px 10px", flexDirection: "column", gap: "30px" }}
        >
          <TextInput
            type="number"
            autoFocus={isVisible}
            inputWidth="100%"
            defaultValue={editLicense?.totalLicense}
            inputName="domainName"
            placeHolder="Total Licenses *"
            getInputText={(val) =>
              setEditLicense({ ...editLicense, totalLicense: val })
            }
          />
          <TextInput
            type="number"
            autoFocus={isVisible}
            inputWidth="100%"
            defaultValue={editLicense?.costPerLicense}
            inputName="domainName"
            placeHolder="Cost Per License *"
            getInputText={(val) =>
              setEditLicense({ ...editLicense, costPerLicense: val })
            }
          />
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={
              editLicense?.totalLicense === 0 ||
              editLicense?.costPerLicense === 0 ||
              editLicense?.costPerLicense === ""
            }
            buttonName="Save"
            buttonClickAction={() => updateCostInfo()}
          />
        </div>
      </Popup>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default AppConsolidationReports;
