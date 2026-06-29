import { Check } from "lucide-react";
import React, { useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getRandomArray } from "../../helpers/helpers";
import {
  getFilterStatus,
  getMaxChar,
  makeFirstLetterCapital,
  validateEmail,
} from "../../helpers/utils";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import { getCFLoader, getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import { getGitHubUsersList } from "./DemoActions/DemoActions";
import { getVendorSearch } from "../SaaSManagement/SaaSActions/SaaSActions";
import { BiFilterAlt } from "react-icons/bi";
import CustomDropDown from "../../Resuables/CustomDropDown/CustomDropDown";

const DemoUserManagementGitHub = ({
  selectedOrgData = { organization: "ALL" },
}) => {
  let searchString = window.location.hash?.split("?")[1];
  const searchParams = new URLSearchParams(searchString);
  const filterStatus = searchParams.get("Status");

  const [downloadStatus, setDownloadStatus] = useState({});
  const [filters, setFilters] = useState({
    activeStatus: getFilterStatus(filterStatus),
    type: { key: "ALL", value: "ALL" },
    usage: { key: "ALL", value: "ALL" },
  });
  const [selectedOrg, setSelectedOrg] = useState(null);
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

  const { globalContext } = useContext(GlobalContext);
  const { memberId, providerName, usersCount, id, ssoAppId } = {
    ...globalContext?.saasCloud,
  };

  useEffect(() => {
    if (selectedOrgData?.organization) {
      setIsLoading(true);
      setActiveCloudFilter("");
      setPagination({ ...pagination, currentPage: 1 });
      setSelectedOrg(selectedOrgData);
      fetchSaaSUsersList(1, 100, selectedOrgData?.organization);
    } else {
      setIsLoading(false);
      if (ssoAppId && providerName !== "ATLASSIAN") {
        fetchSaaSUsersList(1, 100, selectedOrgData?.organization);
      } else {
        fetchSaaSUsersList(1, 100, selectedOrgData?.organization);
      }
    }
  }, [selectedOrgData]);

  const fetchSaaSUsersList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    orgName = selectedOrg?.organization,
    userType = filters?.type?.key,
    activeStatus = filters?.activeStatus?.key,
    searchValue
  ) => {
    setIsLoading(true);
    setUsersList([]);
    setIsPageLoading(false);
    let users = await getGitHubUsersList(
      id,
      pageNo,
      pageSize,
      orgName,
      providerName,
      userType,
      activeStatus,
      searchValue
    );
    if (users?.status === "OK" && users?.res) {
      setUsersList(users?.res?.data);
      setIsLoading(false);
      setPagination({
        pageSize: pageSize,
        currentPage: pageNo,
        totalDocuments: users?.res?.totalDocuments,
        totalPages: Math.ceil(
          users?.res?.totalDocuments / pagination?.pageSize
        ),
      });
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
      setIsLoading(false);
    }
  };

  // const fetchSaaSUsersListCount = async (
  //   userType = filters?.type?.key,
  //   activeStatus = filters?.activeStatus?.key
  // ) => {
  //   setIsLoading(true);
  //   setUsersList([]);
  //   let users = await getSaaSUsersListCount(
  //     memberId,
  //     userType,
  //     activeStatus,
  //     providerName
  //   );
  //   if (users?.status === "OK" && users?.res) {
  //     setPagination({
  //       ...pagination,
  //       totalDocuments: users?.res,
  //       totalPages: Math.ceil(users?.res / pagination?.pageSize),
  //     });
  //     setIsLoading(false);
  //   } else {
  //     setIsLoading(false);
  //   }
  // };

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
    fetchSaaSUsersList(
      1,
      100,
      selectedOrg?.organization,
      filters?.type?.key,
      filters?.activeStatus?.key,
      searchValue
    );
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
    if (action === "usage") {
      return false;
    }
    fetchSaaSUsersList(
      1,
      50,
      selectedOrg?.organization,
      type,
      activeStatus,
      activeCloudFilter
    );
    // fetchSaaSUsersList(1, 50, type, activeStatus);
    // fetchSaaSUsersListCount(type, activeStatus);
  };

  useEffect(() => {
    if (filterStatus) {
      setFilters({
        ...filters,
        activeStatus: getFilterStatus(filterStatus),
      });
    }
  }, [filterStatus]);

  const noTitles = ["BOX_BUSINESS"];

  const saasUserRoleTitles = ["BOX_BUSINESS", "GOOGLE_WORKSPACE"];

  const emailNotRequired = ["JIRA", "CONFLUENCE"];

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
          defaultVal={activeCloudFilter}
          inputPlaceHolder={
            providerName === "MAILTRAP" ? "Search By Email" :
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
      </div>
      {/* maxHeight: "5680px", */}
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
                {providerName !== "MAILTRAP" ? <th style={{ width: "300px" }}>Name</th> : ""}
                {emailNotRequired.includes(providerName) ? (
                  ""
                ) : (
                  <th style={{ width: "350px" }}>Email</th>
                )}
                {providerName === "GITHUB" && ssoAppId ? (
                  ""
                ) : (
                  <th style={{ width: "350px" }}>{providerName === "MAILTRAP" ? "Account" : "Organization"}</th>
                )}
                {providerName === "GITHUB" ? (
                  <th style={{ width: "350px" }}>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                      <span>Usage</span>
                      <CustomDropDown
                        customDropDownStyles={{
                          width: "120px",
                          right: "-100%",
                        }}
                        defaultVal={filters?.usage}
                        dropDownList={[
                          { key: "ALL", value: "All" },
                          { key: "GITHUB", value: "GITHUB" },
                          { key: "GITHUB_COPILOT", value: "Copilot" },
                        ]}
                        selectFilter={(e) => handleFilterChanges(e, "usage")}
                      >
                        <span className="CF_Pointer CF_d-flex ai-center">
                          <BiFilterAlt />
                        </span>
                      </CustomDropDown>
                    </div>
                  </th>
                ) : (
                  ""
                )}
                <th style={{ width: "150px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>{providerName === "MAILTRAP" ? "Access" : "Type"}</span>
                    {
                      providerName !== "MAILTRAP" ? (
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
                            { key: "guest", value: "Guest" },
                          ]}
                          selectFilter={(e) => handleFilterChanges(e, "type")}
                        >
                          <span className="CF_Pointer CF_d-flex ai-center">
                            <BiFilterAlt />
                          </span>
                        </CustomDropDown>) : ""
                    }
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
                    <td className="cf_new_table_hide_text">
                      <p>User</p>
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
                  ?.filter((res) => {
                    return filters?.usage?.key === "ALL"
                      ? res
                      : filters?.usage?.key === "GITHUB"
                        ? res?.workspaceId === "GITHUB"
                        : res?.workspaceId === "GITHUB_COPILOT";
                  })
                  ?.map((res, index) => (
                    <tr key={index}>
                      {providerName !== "MAILTRAP" && <td
                        className="cf_new_table_hide_text"
                        style={{ width: "200px" }}
                      >
                        <div className="cf_ManageClouds_table_image_container">
                          <img
                            src={res?.logoUrl ?? cloudImageMapper(providerName)}
                            alt="SLACK"
                          />
                          <p title={res?.firstName}>
                            {getMaxChar(res?.firstName, 45)}
                          </p>
                        </div>
                      </td>}
                      {emailNotRequired.includes(providerName) ? (
                        ""
                      ) : (
                        <td className="cf_new_table_hide_text">
                          {
                            providerName === "GITHUB" ?
                              <p title={res?.email}>{validateEmail(res?.email) ? getMaxChar(res?.email, 45) : "-"}</p>
                              :
                              <p title={res?.email}>{getMaxChar(res?.email, 45)}</p>
                          }
                        </td>
                      )}
                      {providerName === "GITHUB" && ssoAppId ? (
                        ""
                      ) : (
                        <td className="cf_new_table_hide_text">
                          <p title={res?.organization}>
                            {getMaxChar(res?.organization, 45)}
                          </p>
                        </td>
                      )}
                      {providerName === "GITHUB" ? (
                        <td>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "5px" }}
                          >
                            <img
                              src={cloudImageMapper("GITHUB")}
                              alt="SLACK"
                              style={{ width: "20px" }}
                            />

                            {res?.workspaceId === "GITHUB_COPILOT" ? (
                              <>
                                <p style={{ fontWeight: "600" }}>+</p>
                                <img
                                  src={cloudImageMapper("GITHUB_COPILOT")}
                                  alt="SLACK"
                                  style={{ width: "20px" }}
                                />
                              </>
                            ) : (
                              ""
                            )}
                          </div>
                        </td>
                      ) : (
                        ""
                      )}
                      <td className="cf_new_table_hide_text">
                        {
                          providerName === "MAILTRAP" ?
                            <p>{res?.userType}</p> : ""
                        }
                        {providerName !== "MAILTRAP" && <p style={{ position: "relative" }}>
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
                        </p>}
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
                        {res?.isActive ? (
                          <div className="cf_new_verified_div">
                            <Check size={16} strokeWidth={3} color="#166534" />
                            <p>Active</p>
                          </div>
                        ) : (
                          <div className="cf_new_unverified_div">
                            <p>
                              {providerName === "GOOGLE_WORKSPACE" ||
                                providerName === "GOOGLE_CHAT" ||
                                providerName === "G_SUITE" ||
                                providerName === "GOOGLE_SHARED_DRIVE"
                                ? "Suspended" : res?.idelUser ? "Idle" :
                                  res?.deleted
                                    ? "Deleted"
                                    : "Inactive"}
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
          <span>
            Total:{" "}
            {filters?.usage?.key === "ALL"
              ? pagination?.totalDocuments
              : usersList?.filter((res) => {
                return filters?.usage?.key === "ALL"
                  ? res
                  : filters?.usage?.key === "GITHUB"
                    ? res?.workspaceId === "GITHUB"
                    : res?.workspaceId === "GITHUB_COPILOT";
              })?.length}{" "}
          </span>
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

      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default DemoUserManagementGitHub;
