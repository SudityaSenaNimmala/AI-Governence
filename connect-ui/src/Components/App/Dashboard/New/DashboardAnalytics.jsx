import { DollarSign, Info, Pencil, TrendingDown, Users } from "lucide-react";
import moment from "moment";
import React, { useEffect, useState } from "react";
import { getCloudName, getRandomArray } from "../../../helpers/helpers";
import {
  getPotentialCostSaving,
  makeDataForCalender,
  makeFirstLetterCapital,
  notifyToast,
} from "../../../helpers/utils";
import CustomToolTip from "../../../Resuables/CustomToolTip/CustomToolTip";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import Popup from "../../../Resuables/Popup/Popup";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import {
  fetchLicensedData,
  getSaaSCostingWithAppList,
  updateCostPerLicense,
  updateDomainLicense,
} from "../DashboardActions/DashboardActions";
import TextInputUpdate from "../../../Resuables/InputsComponents/TextInputUpdate";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../../Resuables/InputsComponents/TextInput";

const DashboardAnalytics = () => {
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [searchVal, setSearchVal] = useState("");
  const [totalBilling, setTotalBilling] = useState({});
  const [licenseData, setLicenseData] = useState(null);
  const [selectEditOption, setSelectEditOption] = useState(null);
  const [isUpdated, setIsUpdated] = useState(false);
  const [editLicense, setEditLicense] = useState({
    totalLicense: 0,
    costPerLicense: 0,
    currentIndex: 0,
    cloudName: "",
    memberId: "",
    domain: "sacontain",
    userId: "",
  });

  useEffect(() => {
    fetchSaaSCosting();
  }, []);
  const fetchSaaSCosting = async () => {
    setIsLoading(true);
    let res = await getSaaSCostingWithAppList();
    if (res?.status === "OK") {
      setIsLoading(false);
      if (res?.res?.userFinancialMetrics[0]?.vendorName) {
        let calData = makeDataForCalender(res?.res?.userFinancialMetrics);
        setTotalBilling({
          ...res?.res,
          calenderData: calData,
        });
      } else {
        notifyToast("error", "No Data Found");
        setTotalBilling([]);
      }
    } else {
      setIsLoading(false);
    }
  };

  const fetchLicenseData = async (memberId, vendorName) => {
    setLicenseData(null);
    setIsUpdated(false);
    setIsPageLoading(true);
    try {
      const response = await fetchLicensedData(memberId, vendorName);
      if (response.res) {
        setLicenseData(response.res);
      } else {
        setLicenseData(null);
      }
      setIsPageLoading(false);
    } catch (error) {
      setLicenseData(null);
      setIsPageLoading(false);
      notifyToast("error", "Failed to fetch license details");
    }
  };

  const updateCostInfo = async () => {
    setIsVisible(false);
    setIsPageLoading(true);
    if (licenseData?.licenses?.length > 0) {
      let res = await updateDomainLicense(licenseData);
      if (res?.status === "OK") {
        setIsPageLoading(false);
        notifyToast("success", "Domain License Updated Successfully");
      } else {
        setIsPageLoading(false);
        notifyToast("error", "Failed to update domain license");
      }
      return false;
    }
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

  const saveEditActions = (type, value, index) => {
    if (value === 0 && type === "totalLicenses") {
      return notifyToast("error", `${type} cannot be 0`);
    }
    let copyInfo = [...licenseData?.licenses];
    if (copyInfo[index][type] === value) {
      setSelectEditOption(null);
      return false;
    }
    copyInfo[index] = {
      ...copyInfo[index],
      [type]: value,
    };
    setIsUpdated(true);
    setSelectEditOption(null);
    setLicenseData({ ...licenseData, licenses: copyInfo });
  };

  return (
    <>
      <div className="cf_main_container" style={{ overflow: "hidden" }}>
        <SideNav activeTab="Dashboard" />
        <div className="cf_main_content_place">
          <TopNav pageName="App Insights" backLink="/Dashboard" />
          <div
            className="cf_saas_options"
            style={{ marginTop: "10px", height: "40px" }}
          >
            <span style={{ marginLeft: "auto" }}></span>
            <SearchComponent
              autoOpen={true}
              boxShadows={true}
              inputName="searchInput"
              customStyles={{ width: "350px", height: "40px" }}
              customButtonStyles={{
                background: "transparent",
                color: "rgb(255, 255, 255)",
                fontWeight: "bolder",
                height: "35px",
              }}
              inputPlaceHolder={`Search By Cloud Name`}
              onInputSearch={(e) => setSearchVal(e.searchInput)}
            />
          </div>
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
              className="cf_saas_cloudPlacer cf_saas_cloudPlacer_Analytics"
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
                                style={{ flexDirection: "column", gap: "4px" }}
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
                                style={{ flexDirection: "column", gap: "4px" }}
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
                                style={{ flexDirection: "column", gap: "4px" }}
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
                                style={{ fontSize: "14px", fontWeight: "400" }}
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
                                style={{ fontSize: "14px", fontWeight: "400" }}
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
                totalBilling?.userFinancialMetrics
                  ?.filter((data) =>
                    searchVal === ""
                      ? data
                      : getCloudName(data?.vendorName)
                          ?.toLowerCase()
                          ?.includes(searchVal?.toLowerCase())
                  )
                  ?.sort((a, b) => b["totalUserCount"] - a["totalUserCount"])
                  ?.sort((a, b) => b["totalCost"] - a["totalCost"])
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
                            <p className="cf_saas_menu_title_container_head">
                              {data?.vendorName === "OTHERS"
                                ? data?.externalProviderName
                                : getCloudName(data?.vendorName)}
                            </p>
                            {data?.memberId ? (
                              <div
                                className="cf_dashboard_analytics_edit CF_Pointer"
                                style={{ marginLeft: "auto" }}
                                onClick={() => {
                                  setIsVisible(true);
                                  setEditLicense({
                                    totalLicense: data?.totalLicense ?? 0,
                                    costPerLicense: data?.costPerLicense ?? 0,
                                    currentIndex: index,
                                    cloudName: data?.vendorName,
                                    memberId: data?.memberId,
                                  });
                                  setSelectEditOption("");
                                  fetchLicenseData(
                                    data?.memberId,
                                    data?.vendorName
                                  );
                                }}
                              >
                                <Pencil size={14} />
                              </div>
                            ) : (
                              ""
                            )}
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
                              <Users
                                size={20}
                                strokeWidth={2}
                                color="#001a6f"
                              />
                              <div
                                className="CF_d-flex"
                                style={{ flexDirection: "column", gap: "4px" }}
                              >
                                <p style={{ color: "#000" }}>Total Users</p>
                                <p
                                  className="cf_saas_menu_title_container_head"
                                  style={{
                                    fontSize: "22px",
                                    fontWeight: "500",
                                  }}
                                >
                                  {data?.totalUserCount}
                                </p>
                              </div>
                            </div>
                            <div
                              className="CF_d-flex ai-center"
                              style={{ gap: "10px" }}
                            >
                              <DollarSign
                                size={20}
                                strokeWidth={2}
                                color="#22c55e"
                              />
                              <div
                                className="CF_d-flex"
                                style={{ flexDirection: "column", gap: "4px" }}
                              >
                                <div
                                  className="CF_d-flex  ai-center"
                                  style={{ gap: "5px" }}
                                >
                                  <p style={{ color: "#000" }}>Total Cost</p>
                                  <CustomToolTip
                                    title={`This number does not account for all the unassigned licenses, as ${getCloudName(
                                      data?.vendorName
                                    )} is unable to provide this data. For accuracy, please use the edit option to input the total number of licenses and their associated cost.`}
                                  >
                                    <Info size={14} className="CF_Pointer" />
                                  </CustomToolTip>
                                </div>
                                <p
                                  className="cf_saas_menu_title_container_head"
                                  style={{
                                    fontSize: "22px",
                                    fontWeight: "500",
                                  }}
                                >
                                  ${data?.totalCost?.toFixed(2)}
                                </p>
                              </div>
                            </div>
                            <div
                              className="CF_d-flex ai-center"
                              style={{ gap: "10px" }}
                            >
                              <TrendingDown
                                size={20}
                                strokeWidth={2}
                                color="#ef4444"
                              />
                              <div
                                className="CF_d-flex"
                                style={{ flexDirection: "column", gap: "4px" }}
                              >
                                <p style={{ color: "#000" }}>
                                  Potential Savings
                                </p>
                                <p
                                  className="cf_saas_menu_title_container_head"
                                  style={{
                                    fontSize: "22px",
                                    fontWeight: "500",
                                  }}
                                >
                                  ${getPotentialCostSaving(data)?.toFixed(2)}
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
                                className="cf_saas_menu_title_container_head"
                                style={{ fontSize: "14px", fontWeight: "400" }}
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
                                style={{ justifyContent: "space-between" }}
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
                                style={{ fontSize: "14px", fontWeight: "400" }}
                              >
                                Cost Breakdown
                              </p>
                              <div
                                className="cf_new_dashboard_info_graph_container_bar"
                                style={{
                                  height: "10px",
                                  borderRadius: "9999px",
                                  background: `${
                                    data?.potentialCostSaving > 0
                                      ? "#ff4e4e6e"
                                      : `#00227033`
                                  }`,
                                }}
                              >
                                <div
                                  className="cf_new_dashboard_info_graph_container_bar_filler"
                                  style={{
                                    width: `${
                                      data?.totalCost === 0
                                        ? 0
                                        : Math.abs(
                                            (data?.totalCost -
                                              getPotentialCostSaving(data)) /
                                              data?.totalCost
                                          ) * 100
                                    }%`,
                                    background: "#6df09deb",
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
                                  }}
                                >
                                  Optimized Cost: $
                                  {(
                                    data?.totalCost -
                                    getPotentialCostSaving(data)
                                  )?.toFixed(2)}
                                </p>
                                <p
                                  style={{
                                    color: "#DC2626",
                                    fontWeight: "300",
                                    fontSize: "12px",
                                  }}
                                >
                                  Potential Savings: $
                                  {getPotentialCostSaving(data)?.toFixed(2)}
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
                              Last updated:{" "}
                              {moment(data?.lastUpdated).format(
                                "MMMM Do YYYY, h:mm:ss a"
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      </div>
      {isVisible && licenseData && !isPageLoading ? (
        <Popup
          options={{
            isOpen: isVisible,
            title: `License Details for ${getCloudName(
              editLicense?.cloudName
            )}`,
            popupWidth: "70%",
            popupHeight: "fit-content",
            popupTop: "150px",
            maxHeight: "400px",
            overflowY: "auto",
          }}
          toggleOpen={setIsVisible}
        >
          <div
            className="cf_popup_container_body"
            style={{
              padding: "20px",
              paddingBottom: !isUpdated ? "30px" : "30px",
            }}
          >
            <>
              <table className="cf_message_table">
                <thead>
                  <tr>
                    <th>
                      <span className="cf_mapping_email">Name</span>
                    </th>
                    <th>
                      <span className="cf_mapping_email">Total Licenses</span>
                    </th>
                    <th>
                      <span className="cf_mapping_email">
                        Cost Per Licenses
                      </span>
                    </th>
                    <th>
                      <span className="cf_mapping_email">
                        Consumed Licenses
                      </span>
                    </th>
                    <th>
                      <span className="cf_mapping_email">
                        Available Licenses
                      </span>
                    </th>
                    <th>
                      <span className="cf_mapping_email">Last Updated</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <>
                    {!licenseData ? (
                      <tr>
                        <td colSpan={6}>{getCFTextLoader()}</td>
                      </tr>
                    ) : (
                      ""
                    )}
                    {licenseData?.licenses?.map((license, index) => (
                      <tr
                        key={license?.skuId}
                        style={{ borderBottom: "1px solid #e5e7eb" }}
                      >
                        <td>
                          <span className="cf_mapping_email">
                            {makeFirstLetterCapital(
                              license?.skuName?.replaceAll("_", " ")
                            )}
                          </span>
                        </td>
                        <td style={{ position: "relative", height: "52.5px" }}>
                          {selectEditOption ===
                          `TOTAL_LICENSES_${license?.skuId}` ? (
                            <TextInputUpdate
                              inputType="number"
                              inputWidth="100px"
                              defaultVal={license?.totalLicenses}
                              closeAction={() => setSelectEditOption("")}
                              saveAction={(value) =>
                                saveEditActions("totalLicenses", +value, index)
                              }
                            />
                          ) : (
                            <div
                              className="CF_d-flex ai-center CF_Pointer"
                              style={{ gap: "5px" }}
                              onClick={() =>
                                setSelectEditOption(
                                  `TOTAL_LICENSES_${license?.skuId}`
                                )
                              }
                            >
                              <span className="cf_mapping_email cf_tableEdit_Option">
                                {license?.totalLicenses}
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={{ position: "relative" }}>
                          {selectEditOption ===
                          `COST_LICENSES_${license?.skuId}` ? (
                            <TextInputUpdate
                              inputType="number"
                              inputWidth="100px"
                              defaultVal={license?.costPerLicense}
                              closeAction={() => setSelectEditOption("")}
                              saveAction={(value) =>
                                saveEditActions("costPerLicense", +value, index)
                              }
                            />
                          ) : (
                            <div
                              className="CF_d-flex ai-center CF_Pointer"
                              style={{ gap: "5px" }}
                              onClick={() =>
                                setSelectEditOption(
                                  `COST_LICENSES_${license?.skuId}`
                                )
                              }
                            >
                              <span className="cf_mapping_email cf_tableEdit_Option">
                                {license?.costPerLicense}
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={{ position: "relative" }}>
                          {selectEditOption ===
                          `COST_PER_LICENSES_${license?.skuId}` ? (
                            <TextInputUpdate
                              inputType="number"
                              inputWidth="100px"
                              defaultVal={license?.consumedLicenses}
                              closeAction={() => setSelectEditOption("")}
                              saveAction={(value) =>
                                saveEditActions(
                                  "consumedLicenses",
                                  +value,
                                  index
                                )
                              }
                            />
                          ) : (
                            <div
                              className="CF_d-flex ai-center CF_Pointer"
                              style={{ gap: "5px" }}
                              onClick={() =>
                                setSelectEditOption(
                                  `COST_PER_LICENSES_${license?.skuId}`
                                )
                              }
                            >
                              <span className="cf_mapping_email cf_tableEdit_Option">
                                {license?.consumedLicenses}
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={{ position: "relative" }}>
                          {selectEditOption ===
                          `AVAILABLE_LICENSES_${license?.skuId}` ? (
                            <TextInputUpdate
                              inputType="number"
                              inputWidth="100px"
                              defaultVal={license?.availableLicenses}
                              closeAction={() => setSelectEditOption("")}
                              saveAction={(value) =>
                                saveEditActions(
                                  "availableLicenses",
                                  +value,
                                  index
                                )
                              }
                            />
                          ) : (
                            <div
                              className="CF_d-flex ai-center CF_Pointer"
                              style={{ gap: "5px" }}
                              onClick={() =>
                                setSelectEditOption(
                                  `AVAILABLE_LICENSES_${license?.skuId}`
                                )
                              }
                            >
                              <span className="cf_mapping_email cf_tableEdit_Option">
                                {license?.availableLicenses}
                              </span>
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="cf_mapping_email">
                            {moment(license?.lastUpdated).format(
                              "MMM DD, YYYY HH:mm"
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </>
                </tbody>
              </table>
            </>
          </div>
          {isUpdated ? (
            <div
              className="cf_popup_container_footer"
              style={{ padding: "0 20px", paddingBottom: "10px" }}
            >
              <ButtonComponent
                customstyles={{ marginLeft: "auto" }}
                inputWidth="100px"
                isLoading={false}
                isDisabled={false}
                buttonName="Save"
                buttonClickAction={() => updateCostInfo()}
              />
            </div>
          ) : (
            ""
          )}
        </Popup>
      ) : isVisible && !isPageLoading ? (
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
            style={{
              padding: "20px 10px",
              flexDirection: "column",
              gap: "30px",
            }}
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
      ) : (
        ""
      )}
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default DashboardAnalytics;
