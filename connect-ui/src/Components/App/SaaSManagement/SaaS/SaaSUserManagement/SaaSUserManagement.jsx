import { Check, Lightbulb } from "lucide-react";
import moment from "moment";
import React, { useContext, useEffect, useRef, useState } from "react";
import { BiFilterAlt } from "react-icons/bi";
import { Link, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getRandomArray } from "../../../../helpers/helpers";
import {
  downloadGlobalCSV,
  getFilterStatus,
  getMaxChar,
  getSizeFormatted,
  makeFirstLetterCapital,
  notifyToast,
} from "../../../../helpers/utils";
import CustomDropDown from "../../../../Resuables/CustomDropDown/CustomDropDown";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../../Resuables/Loaders/Loaders";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import {
  getDownloadSaaSReport,
  getDownloadStatus,
  getSaaSUsersList,
  getSaaSUsersListCount,
  getVendorSearch,
} from "../../SaaSActions/SaaSActions";

const SaaSUserManagement = () => {
  const [searchParams] = useSearchParams();
  const filterStatus = searchParams.get("Status");
  const [downloadStatus, setDownloadStatus] = useState({});
  const [filters, setFilters] = useState({
    activeStatus: getFilterStatus(filterStatus),
    type: { key: "ALL", value: "ALL" },
  });
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [usersList, setUsersList] = useState([]);
  const [pagination, setPagination] = useState({
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });

  const [activeCloudFilter, setActiveCloudFilter] = useState("");

  useEffect(() => {
    if (filterStatus) {
      setFilters({
        ...filters,
        activeStatus: getFilterStatus(filterStatus),
      });
    }
  }, [filterStatus]);

  console.log(filters);

  const { globalContext } = useContext(GlobalContext);
  const { memberId, providerName, usersCount } = {
    ...globalContext?.saasCloud,
  };

  useEffect(() => {
    // getCSVStatus();
    fetchSaaSUsersListCount();
    fetchSaaSUsersList();
  }, [memberId]);

  // useEffect(() => {
  //   if (usersCount) {
  //     setPagination({
  //       ...pagination,
  //       totalDocuments: usersCount,
  //       totalPages: Math.ceil(usersCount / pagination?.pageSize),
  //     });
  //   }
  // }, [usersCount]);

  const fetchSaaSUsersList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    userType = filters?.type?.key,
    activeStatus = filters?.activeStatus?.key
  ) => {
    setIsLoading(true);
    setUsersList([]);
    let users = await getSaaSUsersList(
      memberId,
      pageNo,
      pageSize,
      userType,
      activeStatus,
      providerName
    );
    if (users?.status === "OK" && users?.res) {
      setUsersList(users?.res);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const fetchSaaSUsersListCount = async (
    userType = filters?.type?.key,
    activeStatus = filters?.activeStatus?.key
  ) => {
    setIsLoading(true);
    setUsersList([]);
    let users = await getSaaSUsersListCount(
      memberId,
      userType,
      activeStatus,
      providerName
    );
    if (users?.status === "OK" && users?.res) {
      setPagination({
        ...pagination,
        totalDocuments: users?.res,
        totalPages: Math.ceil(users?.res / pagination?.pageSize),
      });
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchSaaSUsersList(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchSaaSUsersList(+value, pagination?.pageSize);
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
      fetchSaaSUsersList();
    }
  };

  const searchUsers = async (searchValue) => {
    setIsPageLoading(true);
    let res = await getVendorSearch(
      memberId,
      "users",
      searchValue,
      false,
      providerName
    );
    if (res?.status === "OK") {
      if (res?.res !== "No Data Found") {
        setIsPageLoading(false);
        setUsersList(res?.res);
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
    let res = await getDownloadStatus(memberId, "users");
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

  const handleFilterChanges = (e, action) => {
    setFilters({
      ...filters,
      [action]: e,
    });
    let type = filters?.type?.key;
    let activeStatus = filters?.activeStatus?.key;

    if (action === "activeStatus") {
      activeStatus = e.key;
    }
    if (action === "type") {
      type = e.key;
    }
    setPagination({ ...pagination, pageSize: 100, currentPage: 1 });
    fetchSaaSUsersList(1, 50, type, activeStatus);
    fetchSaaSUsersListCount(type, activeStatus);
  };

  const noTitles = ["BOX_BUSINESS"];

  const saasUserRoleTitles = ["BOX_BUSINESS", "GOOGLE_WORKSPACE"];

  const emailNotRequired = ["JIRA", "ATLASSIAN", "CONFLUENCE"];

  const checkForUserIdelStatus = (date) => {
    if (date) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return !moment(date).isAfter(thirtyDaysAgo);
    } else {
      return false;
    }
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="SaaS Management" />
        <div className="cf_main_content_place">
          <TopNav pageName="User Management" backLink="/SaaSManagement/Menu" />
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
              inputPlaceHolder={
                providerName == "JIRA"
                  ? `Search By Name`
                  : `Search By Email Or Name`
              }
              onInputSearch={(e) => searchUsersList(e.searchInput)}
            />
            <span style={{ marginLeft: "auto" }}>
              <Link to="/Workflow">
                <ButtonComponent
                  isDisabled={false}
                  inputWidth="95px"
                  customstyles={{ height: "35px" }}
                  buttonName="Workflow"
                  buttonClickAction={() => console.log()}
                />
              </Link>
            </span>
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
              className="cf_new_tables_div"
              style={{ height: "calc(100% - 50px)" }}
            >
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "300px" }}>Name</th>
                    {emailNotRequired.includes(providerName) ? (
                      ""
                    ) : (
                      <th style={{ width: "350px" }}>Email</th>
                    )}
                    <th style={{ width: "150px" }}>
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "5px" }}
                      >
                        <span>Type</span>
                        <CustomDropDown
                          customDropDownStyles={{
                            width: "120px",
                            right: "-100%",
                          }}
                          defaultVal={filters?.type}
                          dropDownList={[
                            { key: "ALL", value: "All" },
                            { key: "USERS", value: "Users" },
                            { key: "ADMIN", value: "Admin" },
                          ]}
                          selectFilter={(e) => handleFilterChanges(e, "type")}
                        >
                          <span className="CF_Pointer CF_d-flex ai-center">
                            <BiFilterAlt />
                          </span>
                        </CustomDropDown>
                      </div>
                    </th>
                    {saasUserRoleTitles.includes(providerName) ? (
                      <>
                        <th style={{ width: "150px" }}>Role</th>
                      </>
                    ) : (
                      ""
                    )}
                    {noTitles.includes(providerName) ? (
                      <>
                        <th style={{ width: "150px" }}>Used Size</th>
                      </>
                    ) : (
                      ""
                    )}
                    <th style={{ width: "150px" }}>Last Signin</th>
                    {/* 
                    <th style={{ width: "150px" }}>Created At</th> */}
                    <th style={{ width: "100px" }}>
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "5px" }}
                      >
                        <span>Status</span>
                        <CustomDropDown
                          customDropDownStyles={{
                            width: "120px",
                            right: "-100%",
                          }}
                          defaultVal={filters?.activeStatus}
                          dropDownList={[
                            { key: "ALL", value: "All" },
                            { key: "ACTIVE", value: "Active" },
                            { key: "IDLE", value: "Idle" },
                            { key: "IN_ACTIVE", value: "In Active" },
                          ]}
                          selectFilter={(e) =>
                            handleFilterChanges(e, "activeStatus")
                          }
                        >
                          <span className="CF_Pointer CF_d-flex ai-center">
                            <BiFilterAlt />
                          </span>
                        </CustomDropDown>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <>
                      <tr>
                        <td colSpan={8}>{getCFTextLoader()}</td>
                      </tr>
                      <tr style={{ visibility: "hidden" }}>
                        <td className="cf_new_table_hide_text">
                          <div className="cf_ManageClouds_table_image_container">
                            <img
                              src={cloudImageMapper(providerName)}
                              alt="SLACK"
                            />
                            <p>Vimalesh T</p>
                          </div>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <p>vimalesh.t_cloudfuze...odclub.onmicrosoft.com</p>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <p>User</p>
                        </td>
                        {noTitles.includes(providerName) ? (
                          <>
                            <td className="cf_new_table_hide_text">
                              <p>100GB</p>
                            </td>
                            <td className="cf_new_table_hide_text">
                              <p>OTHER</p>
                            </td>
                          </>
                        ) : (
                          ""
                        )}
                        <td className="cf_new_table_hide_text">
                          <p>21st Jan 2025</p>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <p>21st Jan 2025</p>
                        </td>
                        <td
                          className="cf_new_table_hide_text"
                          style={{ width: "15%" }}
                        >
                          <div className="cf_new_unverified_div">
                            <p>Unverified</p>
                          </div>
                        </td>
                      </tr>
                    </>
                  ) : (
                    usersList
                      ?.sort((a, b) => b?.deleted - a?.deleted)
                      ?.sort((a, b) => b?.isActive - a?.isActive)
                      ?.map((res, index) => (
                        <tr key={index}>
                          <td
                            className="cf_new_table_hide_text"
                            style={{ width: "200px" }}
                          >
                            <div className="cf_ManageClouds_table_image_container">
                              <img
                                src={
                                  res?.logoUrl ?? cloudImageMapper(providerName)
                                }
                                alt="SLACK"
                              />
                              <p title={res?.firstName}>
                                {getMaxChar(res?.firstName, 45)}
                              </p>
                            </div>
                          </td>
                          {emailNotRequired.includes(providerName) ? (
                            ""
                          ) : (
                            <td className="cf_new_table_hide_text">
                              <p title={res?.email}>
                                {getMaxChar(res?.email, 45)}
                              </p>
                            </td>
                          )}
                          <td className="cf_new_table_hide_text">
                            <p style={{ position: "relative" }}>
                              {providerName === "HUBSPOT" && res?.saasUserRole
                                ? res?.saasUserRole
                                : res?.admin
                                ? "Admin"
                                : "User"}
                              {res?.saasUserRole?.indexOf("INVITED") > -1 ? (
                                <span
                                  style={{
                                    color: "#0062ff",
                                    fontSize: "8px",
                                    position: "absolute",
                                    top: "-1px",
                                    fontWeight: "600",
                                  }}
                                >
                                  &nbsp; Invited
                                </span>
                              ) : (
                                ""
                              )}
                            </p>
                          </td>
                          {saasUserRoleTitles.includes(providerName) ? (
                            <>
                              <td className="cf_new_table_hide_text">
                                {/* <p title={res?.role}>{getMaxChar(res?.role, 45)}</p> */}
                                <p title={res?.saasUserRole || res?.role}>
                                  {makeFirstLetterCapital(
                                    getMaxChar(
                                      res?.saasUserRole || res?.role,
                                      45
                                    )?.replaceAll("_", " ")
                                  )}
                                </p>
                              </td>
                            </>
                          ) : (
                            ""
                          )}
                          {noTitles.includes(providerName) ? (
                            <>
                              <td className="cf_new_table_hide_text">
                                <p>{getSizeFormatted(res?.usedSize)}</p>
                              </td>
                            </>
                          ) : (
                            ""
                          )}
                          <td className="cf_new_table_hide_text">
                            <p>
                              {res?.lastSignInDateTime || res?.createdTime
                                ? moment(
                                    res?.lastSignInDateTime || res?.createdTime
                                  ).format("Do MMM YYYY")
                                : "-"}
                            </p>
                          </td>
                          {/* 
                          <td className="cf_new_table_hide_text">
                            <p>
                              {res?.createdTime
                                ? moment(res?.createdTime).format("Do MMM YYYY")
                                : "-"}
                            </p>
                          </td> */}
                          <td
                            className="cf_new_table_hide_text"
                            style={{ width: "15%" }}
                          >
                            {res?.isActive ? (
                              // <div className="cf_new_verified_div">
                              checkForUserIdelStatus(
                                res?.lastSignInDateTime
                              ) ? (
                                <div className="cf_new_verified_div cf_warning_div">
                                  <Lightbulb
                                    size={16}
                                    strokeWidth={3}
                                    color="#166534"
                                  />
                                  <p>Idle</p>
                                </div>
                              ) : (
                                <div className="cf_new_verified_div">
                                  <Check
                                    size={16}
                                    strokeWidth={3}
                                    color="#166534"
                                  />
                                  <p>Active</p>
                                </div>
                              )
                            ) : (
                              // </div>
                              <div className="cf_new_unverified_div">
                                <p>
                                  {providerName === "GOOGLE_WORKSPACE" ||
                                  providerName === "GOOGLE_CHAT" ||
                                  providerName === "G_SUITE" ||
                                  providerName === "GOOGLE_SHARED_DRIVE"
                                    ? "Suspended"
                                    : res?.deleted
                                    ? "Deleted"
                                    : "InActive"}
                                </p>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
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
    </>
  );
};

export default SaaSUserManagement;
