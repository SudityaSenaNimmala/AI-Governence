import { Check } from "lucide-react";
import React, { useContext, useEffect, useRef, useState } from "react";
import { BiFilterAlt } from "react-icons/bi";
import { Link, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import {
  getSaaSUsersList,
  getSaaSUsersListCount,
  getVendorSearch,
  inviteUsersToCursor,
} from "../SaaSManagement/SaaSActions/SaaSActions";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import CustomDropDown from "../../Resuables/CustomDropDown/CustomDropDown";
import { cloudImageMapper, getRandomArray } from "../../helpers/helpers";
import {
  checkForKeyExists,
  customAppMenu,
  getFilterStatus,
  getMaxChar,
  getSizeFormatted,
  makeFirstLetterCapital,
  newImplementation,
  notifyToast,
} from "../../helpers/utils";
import { getCFLoader, getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import { getGitHubUsersList } from "./DemoActions/DemoActions";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import Popup from "../../Resuables/Popup/Popup";
import { getOauthKeys } from "../Oauth/OauthActions/OauthApiActions";
import UserAIUsageInsights from "./AIUsageInsights/UserAIUsageInsights";
import ShadowITAppsList from "../ShadowIT/ShadowITAppsList";
import ManageUsersUsingCSV from "./SaaSManageUsers/ManageUsersUsingCSV";
import InsightFullAppUsage from "./AIUsageInsights/InsightFullAppUsage";
import ClaudeAIUserInsights from "./AIUsageInsights/ClaudeAIUserInsights";
import GeminiAIUsageInsights from "./AIUsageInsights/GeminiAIUsageInsights";
import BambooHRUserInsights from "./BambooHRUserInsights/BambooHRUserInsights";

const DemoUserManagement = () => {
  let searchString = window.location.hash?.split("?")[1];
  const searchParams = new URLSearchParams(searchString);
  const filterStatus = searchParams.get("Status");
  const [isInviteVisible, setIsInviteVisible] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState({});
  const [isInviteLinkSaved, setIsInviteLinkSaved] = useState(false);
  const [userForShadowIT, setUserForShadowIT] = useState(null);
  const [isManageUsersUsingCSVOpen, setIsManageUsersUsingCSVOpen] =
    useState(false);
  const [inviteUser, setInviteUser] = useState({
    selectedAssessment: {},
    emails: [],
    plainEmails: "",
  });
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

  const [selectedUser, setSelectedUser] = useState(null);

  const { globalContext } = useContext(GlobalContext);
  const { memberId, providerName, usersCount, id, phoneNumber, externalProviderName, deltaUsersUrl } = {
    ...globalContext?.saasCloud,
  };

  useEffect(() => {
    // getCSVStatus();
    fetchSaaSUsersListCount();
    fetchSaaSUsersList();
    if (providerName === "CURSOR_AI") {
      checkForCursorInviteLink();
    }
  }, [memberId]);

  const checkForCursorInviteLink = async () => {
    let res = await getOauthKeys("CURSOR_AI");
    if (res?.status === "OK" && res?.res?.redirectUrl) {
      setIsInviteLinkSaved(true);
    } else {
      setIsInviteLinkSaved(false);
    }
  };

  useEffect(() => {
    if (filterStatus) {
      setFilters({
        ...filters,
        activeStatus: getFilterStatus(filterStatus),
      });
    }
  }, [filterStatus]);

  const fetchSaaSUsersList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    userType = filters?.type?.key,
    activeStatus = filters?.activeStatus?.key
  ) => {
    setIsLoading(true);
    setUsersList([]);
    let users;
    if (newImplementation.includes(providerName)) {
      users = await getGitHubUsersList(
        id,
        pageNo,
        pageSize,
        "ALL",
        providerName,
        userType,
        activeStatus,
        null
      );
    } else {
      users = await getSaaSUsersList(
        memberId,
        pageNo,
        pageSize,
        userType,
        activeStatus,
        providerName,
        id
      );
    }
    if (users?.status === "OK" && users?.res) {
      if (newImplementation.includes(providerName)) {
        setUsersList(users?.res?.data);
        if (pageNo === 1) {
          setPagination({
            ...pagination,
            currentPage: pageNo,
            pageSize: pageSize,
            totalDocuments: users?.res?.totalDocuments,
            totalPages: Math.ceil(users?.res?.totalDocuments / pageSize),
          });
        }
      } else {
        setUsersList(users?.res);
      }
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const fetchSaaSUsersListCount = async (
    userType = filters?.type?.key,
    activeStatus = filters?.activeStatus?.key
  ) => {
    if (!newImplementation.includes(providerName)) {
      setIsLoading(true);
      setUsersList([]);
      let users = await getSaaSUsersListCount(
        memberId,
        userType,
        activeStatus,
        providerName,
        id
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
    let res;
    if (newImplementation.includes(providerName)) {
      res = await getGitHubUsersList(
        id,
        1,
        100,
        "ALL",
        providerName,
        filters?.type?.key,
        filters?.activeStatus?.key,
        searchValue
      );
    } else {
      res = await getVendorSearch(
        memberId,
        "users",
        searchValue,
        false,
        providerName
      );
    }
    if (res?.status === "OK") {
      if (res?.res !== "No Data Found") {
        setIsPageLoading(false);
        if (newImplementation.includes(providerName)) {
          setUsersList(res?.res?.data);
          setPagination({
            ...pagination,
            totalDocuments: res?.res?.totalDocuments,
            totalPages: Math.ceil(
              res?.res?.totalDocuments / pagination?.pageSize
            ),
          });
        } else {
          setUsersList(res?.res);
        }
      } else {
        setIsPageLoading(false);
        notifyToast("error", res?.res);
      }
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
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
    setPagination({ ...pagination, currentPage: 1 });
    fetchSaaSUsersList(1, pagination?.pageSize, type, activeStatus);
    fetchSaaSUsersListCount(type, activeStatus);
  };

  const noTitles = ["BOX_BUSINESS"];

  const saasUserRoleTitles = ["BOX_BUSINESS", "GOOGLE_WORKSPACE"];

  const emailNotRequired = ["JIRA", "CONFLUENCE"];

  const handleEmailsInput = (e) => {
    const emails = e.target.value.split(",");
    const validEmails = emails.filter((email) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    });
    let shallowCopy = { ...inviteUser };
    shallowCopy.plainEmails = e.target.value;
    if (validEmails.length > 0) {
      shallowCopy.emails = validEmails;
    }
    setInviteUser(shallowCopy);
  };

  const handleInviteUsers = async () => {
    setIsPageLoading(true);
    setIsInviteVisible(false);
    let res = await inviteUsersToCursor(inviteUser?.emails, id);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      notifyToast("success", "Invite Sent Successfully");
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed To Send Invite");
    }
  };
  return (
    <>
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
        <span
          style={{ marginLeft: "auto", gap: "10px" }}
          className="CF_d-flex ai-center"
        >
          {providerName === "CURSOR_AI" && deltaUsersUrl ? (
            <ActionButton
              customClass={`changeButtonColorOnHover`}
              customStyles={{
                backgroundColor: "#f2f2f2",
                height: "35px",
                width: "60px",
              }}
              buttonType="button"
              buttonClickAction={() => {
                setIsInviteVisible(true);
                setInviteUser({
                  selectedAssessment: {},
                  emails: [],
                  plainEmails: "",
                });
              }}
            >
              <p style={{ fontSize: "12px", fontWeight: "500" }}>Invite</p>
            </ActionButton>
          ) : (
            ""
          )}
          {providerName === "OTHERS" ? (
            <ButtonComponent
              isDisabled={false}
              inputWidth="200px"
              customstyles={{ height: "35px" }}
              buttonName="Manage Users Using CSV"
              buttonClickAction={() => setIsManageUsersUsingCSVOpen(true)}
            />
          ) : (
            <Link to="/Workflow">
              <ButtonComponent
                isDisabled={false}
                inputWidth="95px"
                customstyles={{ height: "35px" }}
                buttonName="Workflow"
                buttonClickAction={() => console.log()}
              />
            </Link>
          )}
        </span>
      </div>
      <div
        className="cf_main_content_place_main CF_d-flex"
        style={{
          padding: "10px 0 0 0",
          flexDirection: "column",
          height: "fit-content",
        }}
      >
        {/* maxHeight: "5680px", */}
        {/* maxHeight: "5680px", */}
        <div
          className="cf_new_tables_div"
          style={{
            height: "fit-content",
            overflow: "visible",
          }}
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
                {
                  providerName === "BAMBOOHR" ?
                    <>

                      <th style={{ width: "200px" }}>
                        Department
                      </th>
                      <th style={{ width: "200px" }}>
                        Job Title
                      </th>
                    </>
                    : ""
                }
                {providerName === "CURSOR_AI" ? (
                  <>
                    <th style={{ width: "200px", textAlign: "center" }}>
                      Premium Requests
                    </th>
                    <th style={{ width: "200px", textAlign: "center" }}>
                      On-Demand Usage
                    </th>
                    <th style={{ width: "200px", textAlign: "center" }}>
                      Premium Requests
                    </th>
                    <th style={{ width: "200px", textAlign: "center" }}>
                      On-Demand Usage
                    </th>
                  </>
                ) : (
                  ""
                )}
                <th style={{ width: "150px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Type</span>
                    <CustomDropDown
                      customDropDownStyles={{
                        width: "120px",
                        right: "-100%",
                      }}
                      defaultVal={filters?.type}
                      dropDownList={providerName === "ACTION1" ? [
                        { key: "ALL", value: "All" },
                        { key: "USERS", value: "Users" },
                        { key: "ADMIN", value: "Admin" },
                        { key: "AGENT", value: "Agent" },
                        { key: "guest", value: "Guest" },
                      ] : [
                        { key: "ALL", value: "All" },
                        { key: "USERS", value: "Users" },
                        { key: "ADMIN", value: "Admin" },
                        { key: "guest", value: "Guest" },
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
                {/* <th style={{ width: "150px" }}>Last Signin</th>
                      <th style={{ width: "150px" }}>Created At</th> */}
                <th style={{ width: "100px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
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
                        { key: "IN_ACTIVE", value: "Inactive" },
                        { key: "IDLE", value: "Idle" },
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
                        <img src={cloudImageMapper(providerName)} alt="SLACK" />
                        <p>Vimalesh T</p>
                      </div>
                    </td>
                    <td className="cf_new_table_hide_text">
                      <p>vimalesh.t_cloudfuze...odclub.onmicrosoft.com</p>
                    </td>
                    <td className="cf_new_table_hide_text">
                      <p>User</p>
                    </td>
                    {providerName === "CURSOR_AI" ? (
                      <td className="cf_new_table_hide_text">
                        <p>User</p>
                      </td>
                    ) : (
                      ""
                    )}
                    {providerName === "CURSOR_AI" ? (
                      <td className="cf_new_table_hide_text">
                        <p>User</p>
                      </td>
                    ) : (
                      ""
                    )}
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
                    {/* <td className="cf_new_table_hide_text">
                            <p>21st Jan 2025</p>
                          </td>
                          <td className="cf_new_table_hide_text">
                            <p>21st Jan 2025</p>
                          </td> */}
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
                            src={res?.logoUrl ?? (externalProviderName && phoneNumber) ? `https://cloudfuzehost.com/globalasserts/${phoneNumber}` : cloudImageMapper(providerName)}
                            alt="SLACK"
                          />
                          <p
                            title={res?.firstName ? res?.firstName : res?.email}
                            className={
                              providerName === "GOOGLE_WORKSPACE_" || providerName === "CURSOR_AI" ||
                                providerName === "INSIGHTFUL" ||
                                providerName === "CLAUDE" ||
                                customAppMenu?.shadowItApps?.includes(
                                  providerName
                                )
                                ? `cf_make_link`
                                : ""
                            }
                            onClick={() =>
                              providerName === "GOOGLE_WORKSPACE_" || providerName === "CURSOR_AI" ||
                                providerName === "INSIGHTFUL" ||
                                providerName === "CLAUDE"
                                ? setSelectedUser(res)
                                : customAppMenu?.shadowItApps?.includes(
                                  providerName
                                )
                                  ? setUserForShadowIT(res)
                                  : null
                            }
                          >
                            {getMaxChar(
                              res?.firstName ? res?.firstName : res?.email,
                              45
                            )}
                          </p>
                        </div>
                      </td>
                      {emailNotRequired.includes(providerName) ? (
                        ""
                      ) : (
                        <td className="cf_new_table_hide_text">
                          <p
                            title={res?.email}
                            className={
                              providerName === "GOOGLE_WORKSPACE_" || providerName === "CURSOR_AI" ||
                                providerName === "CLAUDE" ||
                                providerName === "INSIGHTFUL" ||
                                providerName === "BAMBOOHR" ||
                                customAppMenu?.shadowItApps?.includes(providerName)
                                ? `cf_make_link`
                                : ""
                            }
                            onClick={() =>
                              providerName === "GOOGLE_WORKSPACE_" || providerName === "CURSOR_AI" || providerName === "INSIGHTFUL" || providerName === "CLAUDE"
                                ? setSelectedUser(res)
                                : providerName === "BAMBOOHR"
                                  ? setSelectedUser(res)
                                  : customAppMenu?.shadowItApps?.includes(providerName)
                                    ? setUserForShadowIT(res)
                                    : null
                            }
                          >
                            {getMaxChar(res?.email, 45)}
                          </p>
                        </td>
                      )}
                      {
                        providerName === "BAMBOOHR" ?
                          <>
                            <td
                              className="cf_new_table_hide_text"
                              title={res?.departmentName}
                            >
                              <p>{getMaxChar(res?.departmentName, 30) || "-"}</p>
                            </td>
                            <td
                              className="cf_new_table_hide_text"
                              title={res?.jobTitle}
                            >
                              <p>{getMaxChar(res?.jobTitle, 30) || "-"}</p>
                            </td>
                          </>
                          : ""
                      }
                      {providerName === "CURSOR_AI" ? (
                        <>
                          <td
                            className="cf_new_table_hide_text"
                            style={{ textAlign: "center" }}
                          >
                            <p>{res?.fastPremiumRequests || 0}</p>
                          </td>
                          <td
                            className="cf_new_table_hide_text"
                            style={{ textAlign: "center" }}
                          >
                            <p>
                              ${res?.spendCents > 0 ? res?.spendCents / 100 : 0}
                            </p>
                          </td>
                        </>
                      ) : (
                        ""
                      )}
                      <td className="cf_new_table_hide_text">
                        <p style={{ position: "relative" }}>
                          {providerName === "ACTION1" && res?.userType ? res?.userType : providerName === "HUBSPOT" && res?.saasUserRole
                            ? res?.saasUserRole
                            : res?.admin
                              ? "Admin"
                              : res?.guest
                                ? "Guest"
                                : "User"}
                          {res?.saasUserRole?.indexOf("INVITED") > -1 ||
                            res?.memberId?.includes(res?.email) ? (
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
                          {res?.userType === "CONTRACTOR" ? (
                            <span
                              style={{
                                color: "#0062ff",
                                fontSize: "8px",
                                position: "absolute",
                                top: "-1px",
                                fontWeight: "600",
                              }}
                            >
                              &nbsp; Contractor
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
                      <td
                        className="cf_new_table_hide_text"
                        style={{ width: "15%" }}
                      >
                        {res?.isActive && !res?.idelUser ? (
                          <div className="cf_new_verified_div">
                            <Check size={16} strokeWidth={3} color="#166534" />
                            <p>Active</p>
                          </div>
                        ) : (
                          <div className="cf_new_unverified_div">
                            <p>
                              {res?.userStatus === "DISABLED" ? "Disabled" : filters?.activeStatus?.key === "ALL" ? providerName === "GOOGLE_WORKSPACE_" ||
                                providerName === "GOOGLE_CHAT_" ||
                                providerName === "G_SUITE_" ||
                                providerName === "GOOGLE_SHARED_DRIVE_"
                                ? "Suspended"
                                : res?.idelUser
                                  ? "Idle"
                                  : !res?.isActive
                                    ? "InActive"
                                    : res?.deleted
                                      ? "Deleted"
                                      : "Inactive" : filters?.activeStatus?.value}
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
              {getRandomArray(
                pagination?.totalPages ? pagination?.totalPages : 1
              )?.map((data) => {
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

      <Popup
        options={{
          isOpen: isInviteVisible,
          title: `Invite Users To Cursor`,
          popupWidth: "40%",
          popupHeight: `250px`,
          popupTop: "150px",
        }}
        toggleOpen={setIsInviteVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            gap: "30px",
          }}
        >
          <textarea
            className="cf_textInput"
            style={{
              resize: "none",
              width: "100%",
              height: "100vh",
              fontSize: "12px",
              padding: "6px",
            }}
            value={inviteUser?.plainEmails}
            onInput={(e) =>
              e.target.value
                ? handleEmailsInput(e)
                : setInviteUser({
                  ...inviteUser,
                  emails: [],
                  plainEmails: "",
                })
            }
            placeholder="Enter emails seperated by comma (e.g. abc@gmail.com,xyz@gmail.com)"
          />
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={inviteUser?.emails?.length === 0}
            buttonName="Send Invite"
            buttonClickAction={() => handleInviteUsers(inviteUser?.emails)}
          />
        </div>
      </Popup>

      {isPageLoading ? getCFLoader() : ""}
      {selectedUser && providerName === "GOOGLE_WORKSPACE_" ? (
        <GeminiAIUsageInsights
          selectedUser={selectedUser}
          setSelectedUser={setSelectedUser}
          isPageLoading={isPageLoading}
          setIsPageLoading={setIsPageLoading}
        />
      ) : (
        ""
      )}
      {selectedUser && providerName === "CURSOR_AI" ? (
        <UserAIUsageInsights
          selectedUser={selectedUser}
          setSelectedUser={setSelectedUser}
          isPageLoading={isPageLoading}
          setIsPageLoading={setIsPageLoading}
        />
      ) : (
        ""
      )}
      {selectedUser && providerName === "CURSOR_AI" ? (
        <UserAIUsageInsights
          selectedUser={selectedUser}
          setSelectedUser={setSelectedUser}
          isPageLoading={isPageLoading}
          setIsPageLoading={setIsPageLoading}
        />
      ) : (
        ""
      )}
      {selectedUser && providerName === "CLAUDE" ? (
        <ClaudeAIUserInsights
          selectedUser={selectedUser}
          setSelectedUser={setSelectedUser}
          isPageLoading={isPageLoading}
          setIsPageLoading={setIsPageLoading}
        />
      ) : (
        ""
      )}
      {selectedUser && providerName === "INSIGHTFUL" ? (
        <InsightFullAppUsage
          selectedUser={selectedUser}
          setSelectedUser={setSelectedUser}
          isPageLoading={isPageLoading}
          setIsPageLoading={setIsPageLoading}
        />
      ) : (
        ""
      )}

      {selectedUser && providerName === "BAMBOOHR" ? (
        <BambooHRUserInsights
          selectedUser={selectedUser}
          setSelectedUser={setSelectedUser}
        />
      ) : (
        ""
      )}
      {userForShadowIT ? (
        <ShadowITAppsList
          userInfo={userForShadowIT}
          setUserForShadowIT={setUserForShadowIT}
        />
      ) : (
        ""
      )}
      <ManageUsersUsingCSV
        fetchSaaSUsersList={fetchSaaSUsersList}
        adminCloudId={id}
        userlevel={true}
        isPopUpOpen={isManageUsersUsingCSVOpen}
        totalUsers={pagination?.totalDocuments}
        setIsPopUpOpen={setIsManageUsersUsingCSVOpen}
        setIsPageLoading={setIsPageLoading}
      />
    </>
  );
};

export default DemoUserManagement;
