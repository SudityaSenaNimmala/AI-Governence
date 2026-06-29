import { Check, X } from "lucide-react";
import moment from "moment";
import React, { useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import CustomToolTip from "../../../../Resuables/CustomToolTip/CustomToolTip";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../../Resuables/Loaders/Loaders";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import { cloudImageMapper, getRandomArray } from "../../../../helpers/helpers";
import {
  downloadGlobalCSV,
  getMaxChar,
  notifyToast,
} from "../../../../helpers/utils";
import {
  getDownloadSaaSReport,
  getDownloadStatus,
  getResourceAppsPagination,
  getSaaSAppsData,
  getVendorSearch,
} from "../../SaaSActions/SaaSActions";
import { SET_RESOURCE_APP_SUMMARY } from "../../../../../GlobalContext/action.types";

const ResourceAppsListNew = () => {
  const navigate = useNavigate();
  const [pagination, setPagination] = useState({
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [appsList, setAppsList] = useState([]);
  const [scopesList, setScopesList] = useState([]);
  const [downloadStatus, setDownloadStatus] = useState({});
  const [activeCloudFilter, setActiveCloudFilter] = useState("");
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { memberId, providerName } = { ...globalContext?.saasCloud };

  const [headersNotRequired] = useState({
    organization: ["SLACK", "GOOGLE_WORKSPACE", "CONFLUENCE", "ATLASSIAN"],
    createdAt: ["SLACK", "GOOGLE_WORKSPACE", "CONFLUENCE", "ATLASSIAN"],
    appType: ["SLACK", "CONFLUENCE", "ATLASSIAN"],
    scopes: ["SLACK", "CONFLUENCE", "ATLASSIAN"],
  });

  useEffect(() => {
    if (globalContext?.resourceAppsSummary?.totalApps) {
      setPagination({
        ...pagination,
        totalPages: Math.ceil(
          globalContext?.resourceAppsSummary?.totalApps / 100
        ),
        totalDocuments: globalContext?.resourceAppsSummary?.totalApps,
      });
    } else {
      getSaasSummary();
    }
    getAppsList();
  }, [globalContext?.saasCloud]);

  const getSaasSummary = async () => {
    let res = await getResourceAppsPagination(memberId, providerName);
    if (res?.status === "OK" && res?.res) {
      dispatch({
        type: SET_RESOURCE_APP_SUMMARY,
        payload: res?.res,
      });
      setPagination({
        ...pagination,
        totalPages: Math.ceil(res?.res?.totalApps / 100),
        totalDocuments: res?.res?.totalApps,
      });
    }
  };

  const getAppsList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize
  ) => {
    setIsLoading(true);
    let res = await getSaaSAppsData(
      memberId,
      providerName,
      pageNo - 1,
      pageSize
    );
    if (res?.status === "OK" && res?.res) {
      setIsLoading(false);
      setAppsList(res?.res);
    } else {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      getAppsList(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      getAppsList(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const displayScopes = (scopes) => {
    return scopes
      ?.filter((res) => res?.scopeName || res?.scopeAccess !== "")
      .map((data, index) => {
        return (index === 0 || index === 1) &&
          (data?.scopeName || data?.scopeAccess) ? (
          <div
            className="cf_new_unverified_div CF_ChangeColor"
            key={`${index}_scopes_${
              providerName === "ONEDRIVE_BUSINESS_ADMIN" ||
              providerName === "MICROSOFT_TEAMS" ||
              providerName === "MICROSOFT_OFFICE_365"
                ? data?.scopeAccess
                : data?.scopeName
            }`}
          >
            <CustomToolTip
              title={
                providerName === "ONEDRIVE_BUSINESS_ADMIN" ||
                providerName === "MICROSOFT_TEAMS" ||
                providerName === "MICROSOFT_OFFICE_365"
                  ? data?.scopeAccess
                  : data?.scopeName
              }
            >
              <p style={{ color: "#000" }}>
                {getMaxChar(
                  providerName === "ONEDRIVE_BUSINESS_ADMIN" ||
                    providerName === "MICROSOFT_TEAMS" ||
                    providerName === "MICROSOFT_OFFICE_365"
                    ? data?.scopeAccess
                    : data?.scopeName,
                  15
                )}
              </p>
            </CustomToolTip>
          </div>
        ) : index === 2 ? (
          <div
            className="cf_new_unverified_div CF_Pointer CF_ChangeColor"
            onClick={() => setScopesList(scopes)}
          >
            <CustomToolTip title="Click To View The Scopes">
              <p style={{ color: "#000", zIndex: "-1" }}>
                + {scopes?.length - 2}
              </p>
            </CustomToolTip>
          </div>
        ) : (
          ""
        );
      });
  };

  const searchDebounce = useRef(null);
  const searchAppsList = async (e) => {
    setActiveCloudFilter(e);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    if (e.length > 3) {
      searchDebounce.current = setTimeout(async () => {
        searchApps(e);
      }, 500);
    } else if (!e) {
      getAppsList(pagination?.currentPage, pagination?.pageSize);
    }
  };

  const searchApps = async (searchValue) => {
    setIsPageLoading(true);
    let res = await getVendorSearch(
      memberId,
      "apps",
      searchValue,
      false,
      providerName
    );
    if (res?.status === "OK") {
      if (res?.res !== "No Data Found") {
        setIsPageLoading(false);
        setAppsList(res?.res);
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
    let res = await getDownloadStatus(memberId, "apps");
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setDownloadStatus({ ...res?.res });
      if (res?.res?.status === "PROCESSED") {
        downloadSaaSReport("apps");
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const downloadSaaSReport = async (action) => {
    setIsPageLoading(true);
    let res = await getDownloadSaaSReport(memberId, action);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.headers["content-type"] === "text/csv") {
        downloadGlobalCSV(res?.res, `${providerName}_${memberId}_${action}`);
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

  return (
    <>
      <div className="cf_main_container" style={{ overflow: "hidden" }}>
        <SideNav activeTab="SaaS Management" />
        <div className="cf_main_content_place" style={{ overflow: "hidden" }}>
          <TopNav
            pageName="Connected Apps List"
            backLink="/SaaS/ConnectedApps/New"
          />
          <div
            className="cf_saas_options"
            style={{ marginTop: "10px", height: "40px" }}
          >
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
              inputPlaceHolder={`Search By App Name`}
              onInputSearch={(e) => searchAppsList(e.searchInput)}
            />
            <span style={{ marginLeft: "auto" }}></span>
          </div>
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{
              gap: "10px",
              padding: "10px 0 0 0",
              height: "calc(100% - 100px)",
            }}
          >
            <div
              className="cf_main_content_place_main CF_d-flex"
              style={{
                padding: "0 0 10px 0",
                flexDirection: "column",
                height: "calc(100%)",
                width: scopesList?.length === 0 ? "100%" : "70%",
              }}
            >
              <div
                className="cf_new_tables_div"
                style={{
                  height: "calc(100% - 50px)",
                }}
              >
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "200px" }}>App Name</th>
                      {headersNotRequired?.organization?.includes(
                        providerName
                      ) ? (
                        ""
                      ) : (
                        <th style={{ width: "200px" }}>Organization</th>
                      )}
                      {headersNotRequired?.createdAt?.includes(providerName) ? (
                        ""
                      ) : (
                        <th style={{ width: "200px" }}>Created At</th>
                      )}
                      {headersNotRequired?.appType?.includes(providerName) ? (
                        ""
                      ) : (
                        <th style={{ width: "200px" }}>App Type</th>
                      )}
                      {headersNotRequired?.scopes?.includes(providerName) ? (
                        ""
                      ) : (
                        <th style={{ width: "200px" }}>Scopes</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <>
                        <tr>
                          <td colSpan={6}>{getCFTextLoader()}</td>
                        </tr>
                        <tr style={{ visibility: "hidden" }}>
                          <td className="cf_new_table_hide_text">
                            <div className="cf_ManageClouds_table_image_container">
                              <img
                                src={cloudImageMapper(providerName)}
                                alt="SLACK"
                              />
                              <p>Omnichannel for C...RM ClientApp Primary</p>
                            </div>
                          </td>
                          <td className="cf_new_table_hide_text">
                            <p>AzureADandPersonalMicrosoftAccount</p>
                          </td>

                          <td className="cf_new_table_hide_text">
                            <p>21st Jan 2025</p>
                          </td>
                          <td className="cf_new_table_hide_text">
                            <p>OAUTH2</p>
                          </td>
                          <td
                            className="cf_new_table_hide_text"
                            style={{ width: "15%" }}
                          >
                            <div className="cf_new_unverified_div">
                              <p>Unverified</p>
                            </div>
                          </td>
                          {/* <td
                            className="cf_new_table_hide_text"
                            style={{ width: "15%" }}
                          >
                            <div className="cf_new_unverified_div">
                              <p>Unverified</p>
                            </div>
                          </td> */}
                        </tr>
                      </>
                    ) : (
                      appsList?.map((data, index) => {
                        return (
                          <tr
                            style={{ animationDelay: `${index * 0.02}s` }}
                            key={`${index}_${
                              data?.appName || data?.displayName
                            }`}
                          >
                            <td className="cf_new_table_hide_text">
                              <div className="cf_ManageClouds_table_image_container">
                                <img
                                  src={
                                    data?.logoUrl
                                      ? data?.logoUrl
                                      : cloudImageMapper(providerName)
                                  }
                                  alt="SLACK"
                                />
                                <p>
                                  {getMaxChar(
                                    data?.appName || data?.displayName,
                                    40
                                  )}
                                </p>
                              </div>
                            </td>
                            {headersNotRequired?.organization?.includes(
                              providerName
                            ) ? (
                              ""
                            ) : (
                              <td className="cf_new_table_hide_text">
                                <p>
                                  {data?.signIn || data?.signInAudience || "-"}
                                </p>
                              </td>
                            )}
                            {headersNotRequired?.createdAt?.includes(
                              providerName
                            ) ? (
                              ""
                            ) : (
                              <td className="cf_new_table_hide_text">
                                <p>
                                  {data?.createdTime
                                    ? moment(data?.createdTime).format(
                                        "Do MMM YYYY"
                                      )
                                    : "-"}
                                </p>
                              </td>
                            )}

                            {headersNotRequired?.appType?.includes(
                              providerName
                            ) ? (
                              ""
                            ) : (
                              <td className="cf_new_table_hide_text">
                                <p>{data?.oauth2 ? "OAUTH2" : "-"}</p>
                              </td>
                            )}

                            {headersNotRequired?.scopes?.includes(
                              providerName
                            ) ? (
                              ""
                            ) : (
                              <td className="cf_new_table_hide_text">
                                <div
                                  className="CF_d-flex"
                                  style={{ gap: "5px" }}
                                >
                                  {data?.scopes?.length > 0
                                    ? displayScopes(data?.scopes)
                                    : "-"}
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div
                className={
                  activeCloudFilter?.length > 0
                    ? "cf_new_tables_footer cf_disabled"
                    : "cf_new_tables_footer"
                }
              >
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
            {scopesList?.length > 0 ? (
              <div
                className="cf_main_content_place_main CF_d-flex"
                style={{
                  padding: "0 0 10px 0",
                  width: scopesList?.length > 0 ? "30%" : "0%",
                  height: "101.5%",
                }}
              >
                <div
                  className="cf_new_tables_div"
                  style={{
                    height: "calc(100% - 10px)",
                  }}
                >
                  <table>
                    <thead>
                      <tr>
                        <th
                          style={{
                            width: "100%",
                            fontSize: "14px",
                            padding: "0 5px",
                          }}
                        >
                          <div className="CF_d-flex ai-center cf_scopesTitle">
                            <p>Scopes List</p>
                            <X
                              size={15}
                              className="CF_Pointer"
                              onClick={() => setScopesList([])}
                            />
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopesList?.map((res) => {
                        return (
                          <tr>
                            <td>
                              <div
                                style={{
                                  width: "100%",
                                  flexDirection: "column",
                                  gap: "8px",
                                  overflow: "hidden",
                                }}
                                className="CF_d-flex"
                              >
                                <div
                                  className="cf_new_unverified_div CF_ChangeColor"
                                  style={{ background: "#0022701a" }}
                                >
                                  <p style={{ color: "#000" }}>
                                    {providerName === "MICROSOFT_TEAMS" ||
                                    providerName === "MICROSOFT_OFFICE_365"
                                      ? res?.scopeAccess
                                      : res?.scopeName}
                                  </p>
                                </div>
                                <CustomToolTip
                                  title={
                                    providerName === "MICROSOFT_TEAMS" ||
                                    providerName === "MICROSOFT_OFFICE_365"
                                      ? res?.adminConsentDescription
                                      : res?.scopeAccess
                                  }
                                  customWidth={true}
                                >
                                  <p
                                    style={{
                                      color: "#000",
                                      padding: "0 5px",
                                      fontWeight: "500",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {getMaxChar(
                                      providerName === "MICROSOFT_TEAMS" ||
                                        providerName === "MICROSOFT_OFFICE_365"
                                        ? res?.adminConsentDescription
                                        : res?.scopeAccess,
                                      "56"
                                    )}
                                  </p>
                                </CustomToolTip>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              ""
            )}
          </div>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default ResourceAppsListNew;
