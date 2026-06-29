import { ChevronDown, ChevronRight } from "lucide-react";
import React, { useContext, useEffect, useRef, useState } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
  cloudImageMapper,
  getCloudName,
  getRandomArray,
} from "../../../helpers/helpers";
import {
  downloadGlobalCSV,
  getMaxChar,
  notifyToast
} from "../../../helpers/utils";
import CustomToolTip from "../../../Resuables/CustomToolTip/CustomToolTip";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import {
  getDownloadSaaSReport,
  getDownloadStatus,
  getVendorSearch,
} from "../../SaaSManagement/SaaSActions/SaaSActions";
import {
  getLicenseSubscriptionsByEmail,
  getUniqueUsersList
} from "../DashboardActions/DashboardActions";
import "../New/CSS/DashBoardNew.css";
import "../../Demos/Demos.css";
import LicenseHarverster from "./LicenseHarverster";
import DemoTabSwitcher from "../../Demos/DemoTabSwitcher";
import Popup from "../../../Resuables/Popup/Popup";

const USERS_VIEW_TABS = [
  { key: "ALL_USERS", value: "Users" },
];


const UsersLicenseHarvest = () => {
  const [downloadStatus, setDownloadStatus] = useState({});
  const [isPageLoading, setIsPageLoading] = useState(false);
  const { globalContext } = useContext(GlobalContext);
  const [activeCloudFilter, setActiveCloudFilter] = useState("");
  const [filters, setFilters] = useState({ key: "ALL", value: "All" });
  const [isLoading, setIsLoading] = useState(true);
  const [usersList, setUsersList] = useState([]);
  const [expandedRowKey, setExpandedRowKey] = useState(null);
  const [subscriptionData, setSubscriptionData] = useState({});
  const [loadingSubscriptionEmail, setLoadingSubscriptionEmail] = useState(null);
  const [currentHarvest, setCurrentHarvest] = useState(null);
  const [activeUsersTab, setActiveUsersTab] = useState(USERS_VIEW_TABS[0]);
  const [showAppsList, setShowAppsList] = useState(null);
  const [pagination, setPagination] = useState({
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });

  useEffect(() => {
    // fetchSaaSCosting();
    fetchUniqueUsersList();
    // getCSVStatus();
    // fetchSaaSUsersList();
  }, [filters]);

  // const fetchSaaSCosting = async () => {
  //   let res = await getSaaSCostingWithAppList();
  //   if (res?.status === "OK") {
  //     setPagination({
  //       totalDocuments: res?.res?.totalUniqueUserCount,
  //       currentPage: 1,
  //       pageSize: 100,
  //       totalPages: Math.ceil(res?.res?.totalUniqueUserCount / 100),
  //     });
  //   }
  // };

  const fetchUniqueUsersList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    cloudName = filters?.key
  ) => {
    setUsersList([]);
    setIsLoading(true);
    let res = await getUniqueUsersList(pageNo, pageSize, "MICROSOFT_OFFICE_365");
    if (res?.status === "OK") {
      setIsLoading(false);
      setUsersList(res?.res?.data);
      if (pageNo === 1) {
        setPagination({
          totalDocuments: res?.res?.totalDocuments,
          currentPage: 1,
          pageSize: pageSize,
          totalPages: Math.ceil(res?.res?.totalDocuments / pageSize),
        });
      }
    } else {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchUniqueUsersList(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchUniqueUsersList(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const searchDebounce = useRef(null);
  const searchUsersList = async (e) => {
    setActiveCloudFilter(e);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        searchUsers(e);
      }, 500);
    } else {
      fetchUniqueUsersList();
    }
  };

  const searchUsers = async (searchValue) => {
    setIsPageLoading(true);
    let res = await getVendorSearch(
      "UNIQUUSERSSEARCH",
      "unqusers",
      searchValue?.trim(),
      false,
      filters?.key
    );
    if (res?.status === "OK") {
      if (res?.res !== "No Data Found") {
        setIsPageLoading(false);
        setUsersList(res?.res?.data);
        setPagination({
          totalDocuments: res?.res?.totalDocuments,
          currentPage: 1,
          pageSize: 100,
          totalPages: Math.ceil(res?.res?.totalDocuments / 100),
        });
      } else {
        setIsPageLoading(false);
        notifyToast("error", res?.res);
      }
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
    }
  };

  const getCSVStatus = async () => {
    setIsPageLoading(true);
    let res = await getDownloadStatus("UNIQUUSERSSEARCH", "unqusers");
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setDownloadStatus({ ...res?.res });
      if (res?.res?.status === "PROCESSED") {
        downloadSaaSReport("users");
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const downloadSaaSReport = async (action) => {
    setIsPageLoading(true);
    let res = await getDownloadSaaSReport("UNIQUUSERSSEARCH", "unqusers");
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.headers["content-type"] === "text/csv") {
        downloadGlobalCSV(res?.res, `UniqueUsersList`);
        setDownloadStatus({
          ...downloadStatus,
          status: "Downloaded",
        });
      } else {
        setDownloadStatus({
          ...downloadStatus,
          status: "IN_PROGRESS",
        });
      }
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed Downloading CSV");
    }
  };

  const getApplicationsForUser = (user) => {
    const clouds = user?.vendorAdminCloudId || [];
    const types = ["Enterprise", "Pro", "Business+", "Professional"];
    return clouds.map((cloud, i) => {
      const name = getCloudName(cloud?.split(":")[0]);
      const type = types[i % types.length];
      return { id: cloud, name, type };
    });
  };

  const getUserInitials = (res) => {
    if (res?.firstName && res?.lastName) return `${(res.firstName)[0] || ""}${(res.lastName)[0] || ""}`.toUpperCase();
    if (res?.firstName) return res.firstName.slice(0, 2).toUpperCase();
    const email = res?.email || "";
    const parts = email.split("@")[0]?.split(/[._-]/) || [];
    if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
    return email.slice(0, 2).toUpperCase() || "—";
  };

  const getDisplayName = (res) => {
    if (res?.firstName && res?.lastName) return `${res.firstName} ${res.lastName}`;
    if (res?.firstName) return res.firstName;
    return (res?.email || "").split("@")[0] || "—";
  };

  const normalizeSubscriptions = (res, cloudsList = []) => {
    let inCloudsList = res?.res?.filter((item) => cloudsList?.some((cloud) => cloud?.id === item?.adminCloudId));
    let listLic = inCloudsList?.reduce((acc, item) => {
      if (acc[item?.adminCloudId]) {
        acc[item?.adminCloudId].push(item);
      } else {
        acc[item?.adminCloudId] = [item];
      }
      return acc;
    }, {})

    let fnlData = Object.keys(listLic)?.map((key) => {
      return {
        adminCloudId: key,
        vendorName: cloudsList?.find((cloud) => cloud?.id === key)?.providerName ?? "-",
        currentVendorLicesnes: listLic[key],
      }
    })
    console.log(fnlData)
    return fnlData;
  };


  const fetchSubscriptionsForEmail = async (emailId) => {
    if (!emailId) return;
    setLoadingSubscriptionEmail(emailId);
    const res = await getLicenseSubscriptionsByEmail(emailId);
    setLoadingSubscriptionEmail(null);
    if (res?.status === "OK") {
      const groups = normalizeSubscriptions(res, globalContext?.cloudsList ?? []);
      setSubscriptionData((prev) => ({ ...prev, [emailId]: groups }));
    } else {
      setSubscriptionData((prev) => ({ ...prev, [emailId]: [] }));
      notifyToast("error", res?.res ?? "Failed to load subscriptions");
    }
  };

  const toggleExpanded = (key, emailId) => {
    const nextExpanded = expandedRowKey === key ? null : key;
    setExpandedRowKey(nextExpanded);
    if (nextExpanded && emailId && !subscriptionData[emailId]) {
      fetchSubscriptionsForEmail(emailId);
    }
  };


  const refreshSubscriptions = async (emailId) => {
    if (!emailId) return;
    let del = { ...subscriptionData }
    delete del[emailId];
    setSubscriptionData(del);
    fetchSubscriptionsForEmail(emailId);
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Dashboard" />
        <div className="cf_main_content_place">
          <TopNav pageName="Users List" backLink="/Dashboard" />
          <div
            className="cf_saas_options"
            style={{ marginTop: "10px", height: "40px" }}
          >
            <DemoTabSwitcher
              tabs={USERS_VIEW_TABS}
              currentTab={activeUsersTab}
              setCurrentTab={setActiveUsersTab}
            />
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
              inputPlaceHolder={`Search By User Email or Name`}
              onInputSearch={(e) => searchUsersList(e.searchInput)}
            />
            {/* <span style={{ marginLeft: "auto" }}></span> */}
            {/* <ActionButton
              customClass="CF_d-flex ai-center"
              customStyles={{
                backgroundColor: "#f2f2f2",
                height: "40px",
              }}
              buttonType="button"
              buttonClickAction={() =>
                downloadStatus?.status === "IN_PROGRESS"
                  ? getCSVStatus()
                  : downloadSaaSReport("users")
              }
            >
              {downloadStatus?.status === "IN_PROGRESS" ? (
                <RotateCw size={18} strokeWidth={2} title="Check Status" />
              ) : (
                <FileDown size={18} strokeWidth={2} />
              )}
            </ActionButton> */}
          </div>
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{
              padding: "10px 0 0 0",
              flexDirection: "column",
              height: "calc(100vh - 130px)",
            }}
          >
            <div
              className="cf_new_tables_div cf_users_license_table_card"
              style={{ height: "calc(100% - 50px)" }}
            >
              <table className="cf_users_license_table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Apps</th>
                    {/* <th>Spend</th> */}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <>
                      <tr>
                        <td colSpan={4}>{getCFTextLoader()}</td>
                      </tr>
                    </>
                  ) : (
                    usersList?.map((res, index) => {
                      const rowKey = res?.email || res?.firstName || index;
                      const isExpanded = expandedRowKey === rowKey;
                      const isLoadingSubs = loadingSubscriptionEmail === res?.email;
                      const applicationGroups = isLoadingSubs
                        ? []
                        : (subscriptionData[res?.email] ?? [{ vendorName: "-", currentVendorLicesnes: getApplicationsForUser(res) }]);
                      const apps = res?.vendorAdminCloudId || [];
                      return (
                        <React.Fragment key={rowKey}>
                          <tr
                            className={index % 2 === 1 ? "cf_users_license_row_alt" : ""}
                          >
                            <td style={{ width: "50%" }}>
                              <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                                <ActionButton
                                  buttonType="button"
                                  buttonClickAction={() => toggleExpanded(rowKey, res?.email)}
                                  customClass="CF_Pointer CF_d-flex ai-center jc-center"
                                  customStyles={{ border: "none", background: "none", color: "#6c757d", padding: 0 }}
                                  title={isExpanded ? "Collapse" : "Expand"}
                                >
                                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </ActionButton>
                                <div
                                  className="cf_users_avatar"
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: "50%",
                                    background: "#e2e8f0",
                                    color: "#0062ff",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    flexShrink: 0,
                                  }}
                                >
                                  <span className="CF_d-flex ai-center jc-center">
                                    {getUserInitials(res)}
                                  </span>
                                </div>
                                <div>
                                  <div style={{ fontWeight: 600, color: "#212529", fontSize: 14 }}>
                                    {getDisplayName(res)}
                                  </div>
                                  <div style={{ fontSize: 12, color: "#6c757d" }}>
                                    {getMaxChar(res?.email || "—", 32)}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="cf_users_license_apps_cell" style={{ width: "40%" }}>
                              <div className="CF_d-flex ai-center" style={{ gap: "6px", flexWrap: "wrap" }}>
                                {apps.slice(0, 5).map((cloud) => cloud?.split(":")[0] ? (
                                  <CustomToolTip key={cloud} title={getCloudName(cloud?.split(":")[0])}>
                                    <div
                                      className="cf_users_app_icon CF_Pointer"
                                      style={{
                                        width: 30,
                                        height: 30,
                                        borderRadius: "50%",
                                        border: "1px solid #e2e8f0",
                                        background: "#f8fafc",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        overflow: "hidden",
                                      }}
                                    >
                                      <img
                                        src={cloudImageMapper(cloud?.split(":")[0])}
                                        alt=""
                                        style={{ width: 20, height: 20, objectFit: "contain" }}
                                      />
                                    </div>
                                  </CustomToolTip>
                                ) : "")}
                                {apps.length > 5 && (
                                  <div
                                    className="cf_users_app_icon CF_Pointer"
                                    style={{
                                      width: 30,
                                      height: 30,
                                      borderRadius: "50%",
                                      border: "1px solid #e2e8f0",
                                      background: "#f8fafc",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      overflow: "hidden",
                                    }}
                                    onClick={() => setShowAppsList({
                                      email: res?.email,
                                      apps: apps
                                    })}
                                  >
                                    <span style={{ fontSize: 12, color: "#6c757d" }}>+{apps.length - 5}</span>
                                  </div>
                                )}
                                {apps.length === 0 && <span style={{ color: "#6c757d" }}>—</span>}
                              </div>
                            </td>
                            {/* <td>
                              <span style={{ fontWeight: 600, color: "#212529" }}>$0</span>
                              <span style={{ color: "#6c757d", fontSize: 12 }}>/mo</span>
                              <span
                                style={{
                                  marginLeft: 6,
                                  padding: "2px 6px",
                                  borderRadius: 10,
                                  background: "#ffe5cc",
                                  color: "#ff9933",
                                  fontSize: 10,
                                  fontWeight: 500,
                                }}
                              >
                                EST
                              </span>
                            </td> */}
                            <td>
                              <span
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: 12,
                                  background: "#d4edda",
                                  color: "#28a745",
                                  fontSize: 12,
                                  fontWeight: 500,
                                }}
                              >
                                Active
                              </span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className={index % 2 === 1 ? "cf_users_license_row_alt" : ""}>
                              <td colSpan={4} style={{ padding: 0, verticalAlign: "top", borderTop: "none" }}>
                                <div
                                  className="CF_d-flex"
                                  style={{
                                    gap: "24px",
                                    padding: "16px 16px 20px",
                                    background: "#f8fafc",
                                    borderBottom: "1px solid #e2e8f0",
                                  }}
                                >
                                  {isLoadingSubs ? (
                                    <div className="CF_d-flex ai-center jc-center" style={{ flex: 1, minHeight: 120 }}>
                                      {getCFTextLoader()}
                                    </div>
                                  ) : (
                                    <>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, marginBottom: 12, color: "#334155" }}>
                                          Licenses Harvest
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                          {subscriptionData[rowKey]?.length > 0 ? subscriptionData[rowKey]?.map((group, gIdx) => {
                                            const count = group?.currentVendorLicesnes?.length;
                                            return (
                                              <div
                                                key={group?.adminCloudId ?? gIdx}
                                                className="CF_d-flex ai-center cf_license_harvest_card"
                                                style={{
                                                  justifyContent: "space-between",
                                                  padding: "8px 10px",
                                                  background: "#fff",
                                                  borderRadius: 8,
                                                  border: "1px solid #e2e8f0",
                                                }}
                                              >
                                                <div className="CF_d-flex ai-center" style={{ gap: 10 }}>
                                                  {group?.vendorName && group?.vendorName !== "-" && (
                                                    <div className="cf_cloudImageCloadDiv" style={{ width: 28, height: 28 }}>
                                                      <img
                                                        src={cloudImageMapper(group?.vendorName)}
                                                        alt=""
                                                        style={{ width: "80%", height: "80%", objectFit: "contain" }}
                                                      />
                                                    </div>
                                                  )}
                                                  <span style={{ fontSize: 13, fontWeight: 500, color: "#334155" }}>
                                                    {getCloudName(group?.vendorName)}
                                                  </span>
                                                  <span
                                                    style={{
                                                      padding: "2px 8px",
                                                      background: "#eef2ff",
                                                      borderRadius: 6,
                                                      fontSize: 12,
                                                      color: "#4338ca",
                                                      fontWeight: 500,
                                                    }}
                                                  >
                                                    {count} license{count !== 1 ? "s" : ""}
                                                  </span>
                                                </div>
                                                <span className="cf_license_harvest_btn">
                                                  <ActionButton
                                                    buttonType="button"
                                                    buttonClickAction={() => { setCurrentHarvest({ ...group, email: res?.email }); }}
                                                    customStyles={{
                                                      padding: "6px 12px",
                                                      borderRadius: 6,
                                                      border: "1px solid #dc3545",
                                                      background: "#ffe3ee",
                                                      fontSize: 12,
                                                      cursor: "pointer",
                                                      color: "#dc3545",
                                                      fontWeight: 500,
                                                    }}
                                                  >
                                                    Remove License
                                                  </ActionButton>
                                                  <ActionButton
                                                    buttonType="button"
                                                    buttonClickAction={() => { setCurrentHarvest({ ...group, email: res?.email }); }}
                                                    customStyles={{
                                                      padding: "6px 12px",
                                                      borderRadius: 6,
                                                      border: "1px solid #4338ca",
                                                      background: "#eef2ff",
                                                      fontSize: 12,
                                                      cursor: "pointer",
                                                      color: "#4338ca",
                                                      fontWeight: 500,
                                                    }}
                                                  >
                                                    Harvest
                                                  </ActionButton>
                                                </span>
                                              </div>
                                            );
                                          }) : (
                                            <span style={{ fontSize: 13, color: "#64748b" }}>No applications</span>
                                          )}
                                        </div>
                                        <div className="CF_d-flex" style={{ gap: 8, marginTop: 14 }}>
                                        </div>
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }} />
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="cf_new_tables_footer">
              <span>Total: {pagination?.totalDocuments} </span>
              <span style={{ marginLeft: "auto" }}></span>
              <span style={{ opacity: "0.5" }}>
                Showing {pagination?.currentPage} of{" "}
                {pagination?.totalPages ? pagination?.totalPages : 1} Page
              </span>
              <span>
                Showing :{" "}
                <select
                  className="cf_message_pagination_select"
                  name="pageSize"
                  value={pagination?.pageSize}
                  onChange={handlePagination}
                >
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="300">300</option>
                  <option value="400">400</option>
                  <option value="500">500</option>
                </select>
                &nbsp;Rows
              </span>
              <span>
                Go to:{" "}
                <select
                  className="cf_message_pagination_select"
                  name="currentPage"
                  value={pagination?.currentPage}
                  onChange={handlePagination}
                >
                  {getRandomArray(pagination?.totalPages)?.map((data) => {
                    return (
                      <option value={data} key={`${data}_DMS`}>
                        {data}
                      </option>
                    );
                  })}
                </select>
              </span>
            </div>
          </div>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
      {showAppsList && (
        <Popup
          options={{
            isOpen: showAppsList,
            title: `Apps List for ${showAppsList?.email}`,
            popupWidth: "30%",
            type: "side",
            popupHeight: "calc(100% - 0px)",
            popupTop: "0px",
            maxHeight: "100%",
            overflowY: "auto",
            parentStyles: {
              justifyContent: "flex-end",
            },
          }}
          toggleOpen={setShowAppsList}
        >
          <div
            className="cf_popup_container_body"
            style={{
              padding: "15px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              justifyContent: "flex-start",
              height: "100%"
            }}
          >

            <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              {(showAppsList?.apps || []).length === 0 ? (
                <span style={{ fontSize: 13, color: "#64748b" }}>No apps assigned</span>
              ) : (
                (showAppsList?.apps || []).map((cloud) => {
                  const provider = cloud?.split(":")[0];
                  const appName = getCloudName(provider);
                  return provider ? (
                    <div
                      key={cloud}
                      className="CF_d-flex ai-center"
                      style={{
                        gap: 12,
                        padding: "10px 12px",
                        background: "#f8fafc",
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                        width: "100%"
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          border: "1px solid #e2e8f0",
                          background: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          flexShrink: 0,
                        }}
                      >
                        <img
                          src={cloudImageMapper(provider)}
                          alt=""
                          style={{ width: 18, height: 18, objectFit: "contain" }}
                        />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#334155" }}>{appName || "—"}</span>
                    </div>
                  ) : "";
                })
              )}
            </div>
          </div>
        </Popup>
      )}
      {
        currentHarvest && (
          <LicenseHarverster licenseInfo={currentHarvest} setCurrentHarvest={setCurrentHarvest} refreshSubscriptions={refreshSubscriptions} />
        )
      }
    </>
  );
};

export default UsersLicenseHarvest;
