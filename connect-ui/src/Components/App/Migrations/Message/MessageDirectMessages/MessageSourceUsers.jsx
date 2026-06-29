import React, { useContext, useEffect, useRef, useState } from "react";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import { cloudImageMapper, getRandomArray } from "../../../../helpers/helpers";
import { BiFilterAlt } from "react-icons/bi";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  createProvisionMapping,
  getMatchedUsers,
  getMessageDomainsSearchList,
  getMessageDomainsSearchListUsers,
  getProvisionMapping,
  getUserSalckSync,
  getUsersCSVReport,
  getUsersPaginationCount,
  getUsersSyncInfo,
  searchEmailAuthenticationUser,
  sendAuthenticateEmail,
  syncDMs,
} from "../MessageActions/MessageActions";
import {
  downloadGlobalCSV,
  getClouCombinationCode,
  getSelectedDestinationCloudId,
  getSelectedDestinationCloudName,
  getSelectedSourceCloudId,
  getSelectedSourceCloudName,
  notifyToast,
} from "../../../../helpers/utils";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";
import { BiEnvelope } from "react-icons/bi";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import ActionButton from "../../../../Resuables/InputsComponents/ActionButton";
import { BsDownload } from "react-icons/bs";
import { GoSync } from "react-icons/go";
import CustomDropDown from "../../../../Resuables/CustomDropDown/CustomDropDown";

const MessageSourceUsers = (props) => {
  const { currentTab } = { ...props };
  const searchDebounce = useRef(null);
  const [searchEmail, setSearchEmail] = useState("");
  const [filters, setFilters] = useState({
    authentication: { key: "ALL", value: "All" },
    matched: { key: "ALL", value: "All" },
  });
  const [syncInfo, setSyncInfo] = useState("");
  const [userEmailSuggestionsList, setUserEmailSuggestionsList] = useState([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const { globalContext } = useContext(GlobalContext);
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [sendEmailList, setSendEmailList] = useState([]);
  const [matchedEmailList, setMatchedEmailList] = useState([
    "mia@pepperwood.club",
    "james@pepperwood.club",
    "oilver@pepperwood.club",
  ]);
  const [sourceUsersList, setSourceUsersList] = useState([]);
  const [pagination, setPagination] = useState({
    pageSize: 200,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [paginationCount, setPaginationCount] = useState({});

  useEffect(() => {
    fetchPaginationCount();
    fetchSourceUserList();
    if (currentTab === "source") {
      setSyncInfo("");
      getSyncInfo();
    } else {
      setSyncInfo("");
    }
    setFilters({
      authentication: { key: "ALL", value: "All" },
      matched: { key: "ALL", value: "All" },
    });
  }, [currentTab]);

  const fetchSourceUserList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    retryCount = 1
  ) => {
    setIsPageLoading(true);
    let res = await getProvisionMapping(
      currentTab === "source"
        ? getSelectedSourceCloudId()
        : getSelectedDestinationCloudId(),
      pageNo,
      pageSize
    );
    if (res?.status === "OK") {
      if (res?.res === "No Provision User Found" && retryCount < 3) {
        setTimeout(async () => {
          let creatRes = await createProvisionMapping(
            currentTab === "source"
              ? getSelectedSourceCloudId()
              : getSelectedDestinationCloudId(),
            currentTab === "source"
              ? getSelectedDestinationCloudId()
              : getSelectedSourceCloudId(),
            1,
            10
          );
          if (creatRes?.status === "OK") {
            fetchSourceUserList(1, 200, retryCount + 1);
          }
        }, 3000);
      } else {
        if (res?.res === "No Provision User Found") {
          setIsPageLoading(false);
          notifyToast("warn", "No Provision User Found");
        }
      }
      if (res?.res !== "No Provision User Found") {
        setIsPageLoading(false);
        setSourceUsersList(res?.res);
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const fetchPaginationCount = async () => {
    let res = await getUsersPaginationCount(
      currentTab === "source"
        ? getSelectedSourceCloudId()
        : getSelectedDestinationCloudId()
    );
    if (res?.status === "OK") {
      setIsPageLoading(false);
      // setPagination({ totalDocuments: pagination?.res });
      setPaginationCount(res?.res);
    } else {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    let count = paginationCount?.totalSlackCount;

    currentTab !== "source" ? (count = paginationCount?.totalTeamsCount) : "";

    setPagination({
      currentPage: 1,
      pageSize: 200,
      totalPages: Math.ceil(count / pagination?.pageSize),
      totalDocuments: count,
    });
  }, [paginationCount]);

  // useEffect(() => {
  //   // if (pagination?.totalDocuments) {
  //   fetchSourceUserList();
  //   // }
  // }, [pagination]);

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = paginationCount?.totalSlackCount;

    currentTab !== "source" ? (count = paginationCount?.totalTeamsCount) : "";

    if (name === "pageSize") {
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
      fetchSourceUserList(1, +value, 0);
    } else {
      setPagination({
        ...pagination,
        currentPage: +value,
      });
      fetchSourceUserList(+value, pagination?.pageSize, 0);
    }
  };

  const generateUserCSVReport = async () => {
    setIsPageLoading(true);
    let res = await getUsersCSVReport(
      currentTab === "source"
        ? getSelectedSourceCloudId()
        : getSelectedDestinationCloudId(),
      currentTab === "source"
        ? getSelectedSourceCloudName()
        : getSelectedDestinationCloudName()
    );
    if (res?.status === "OK") {
      if (res?.res === "Your Request is Already under processing") {
        setIsPageLoading(false);
        notifyToast("success", res?.res);
      } else {
        downloadGlobalCSV(
          res?.res,
          `${
            currentTab === "source"
              ? getSelectedSourceCloudName()
              : getSelectedDestinationCloudName()
          }_Users_Report`
        );
        setIsPageLoading(false);
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const handleSendMailEvent = (e) => {
    let { value, checked } = e.target;
    let list = [...sendEmailList];
    if (checked) {
      list.push(value);
    } else {
      list = list?.filter((data) => {
        return data !== value;
      });
    }
    setSendEmailList(list);
  };

  const sendEmail = async () => {
    setIsPageLoading(true);
    if (sendEmailList?.length === 0) {
      setIsPageLoading(false);
      return notifyToast(
        "error",
        "Please select at least one user to authenticate"
      );
    }
    let res = await sendAuthenticateEmail(
      sendEmailList,
      currentTab === "source"
        ? getSelectedSourceCloudName()
        : getSelectedDestinationCloudName()
    );
    if (res?.status === "OK") {
      setIsPageLoading(false);
      notifyToast("success", "Email Sent");
      fetchPaginationCount();
      setSendEmailList([]);
      let sourceCheck = document.querySelectorAll("#input_SEND_EMAIL:checked");
      sourceCheck.forEach((input) => {
        input.checked = false;
      });
    } else {
      setIsPageLoading(false);
    }
  };

  const getSearchUser = async (email) => {
    setIsPageLoading(true);
    let res = await searchEmailAuthenticationUser(
      email,
      currentTab === "source"
        ? getSelectedSourceCloudId()
        : getSelectedDestinationCloudId()
    );
    if (res?.status === "OK") {
      if (res?.res) {
        let data = [];
        data.push(res?.res);
        setSourceUsersList(data);
        setIsPageLoading(false);
      } else {
        setIsPageLoading(false);
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const searchUsersList = async (searchInput) => {
    setIsSuggestionsLoading(false);
    setSearchEmail(searchInput);
    if (userEmailSuggestionsList.includes(searchInput)) {
      getSearchUser(searchInput);
      setIsSuggestionsLoading(false);
      setUserEmailSuggestionsList([]);
      return false;
    }
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    searchDebounce.current = setTimeout(async () => {
      if (searchInput) {
        setIsSuggestionsLoading(true);
        let res = await getMessageDomainsSearchListUsers(
          searchInput,
          currentTab,
          1,
          5
        );
        if (res?.status === "OK") {
          setIsSuggestionsLoading(false);
          if (res?.res?.length > 0) {
            setUserEmailSuggestionsList(res?.res);
          }
        } else {
          setIsSuggestionsLoading(false);
        }
      } else {
        setIsSuggestionsLoading(false);
        setUserEmailSuggestionsList([]);
        fetchSourceUserList();
      }
    }, 500);
  };

  const handleSelectAllUsers = (e) => {
    let usersCheck = document.querySelectorAll("#input_SEND_EMAIL");
    let list = [...sendEmailList];
    usersCheck?.forEach((input) => {
      if (e.target.checked) {
        if (!input.checked) {
          list.push(input.value);
        }
      } else {
        list = [];
      }
      input.checked = e.target.checked;
    });
    setSendEmailList(list);
  };

  const handleMathcedFilterChanges = async (e = filters?.matched) => {
    setFilters({ ...filters, matched: e });
    if (e.key === "MATCHED") {
      setMatchedEmailList([]);
      try {
        setIsPageLoading(true);
        let res = await getMatchedUsers(
          pagination?.currentPage,
          pagination?.pageSize,
          currentTab === "source"
            ? getSelectedSourceCloudName()
            : getSelectedDestinationCloudName()
        );
        if (res?.status === "OK") {
          if (res?.res?.length > 0) {
            setMatchedEmailList(res?.res);
          } else {
            throw new Error("No Data Found");
          }
        } else {
          throw new Error("No Data Found");
        }
      } catch (error) {
        notifyToast("error", error?.message);
      } finally {
        setIsPageLoading(false);
      }
    }
  };

  const startSyncUsers = async () => {
    setIsPageLoading(true);
    let res = await getUserSalckSync();
    if (res?.status === "OK") {
      let res = await syncDMs();
      let res1 = await getSyncInfo();
      setIsPageLoading(false);
      notifyToast("success", "Users Synced Successfully");
    } else {
      setIsPageLoading(false);
    }
  };

  const getSyncInfo = async () => {
    let res = await getUsersSyncInfo();
    if (res?.status === "OK") {
      setSyncInfo(
        `Last Synced ${res?.res?.lastSyncUserCount} Users On ${new Date(
          res?.res?.lastSyncDate ?? 0
        ).toLocaleString()}`
      );
    }
  };

  return (
    <>
      <div className="cf_userMenu_action_pannel" style={{ gap: "20px" }}>
        <SearchComponent
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          isSuggestionsLoading={isSuggestionsLoading}
          suggestionsList={userEmailSuggestionsList}
          inputPlaceHolder={
            currentTab === "source"
              ? `Search By Source User Email`
              : `Search By Destination User Email`
          }
          onInputSearch={(e) => searchUsersList(e?.searchInput)}
        />
        <span style={{ marginLeft: "auto" }}></span>
        <ActionButton
          buttonType="button"
          buttonClickAction={() => {
            fetchPaginationCount();
            fetchSourceUserList();
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <GoSync style={{ fontSize: "14px" }} />
            <span style={{ fontSize: "12px" }}>Refresh</span>
          </div>
        </ActionButton>
        {currentTab === "source" ? (
          <ActionButton
            buttonType="button"
            buttonClickAction={() => startSyncUsers()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <GoSync style={{ fontSize: "14px" }} />
              <span style={{ fontSize: "12px" }}>Sync Users</span>
            </div>
          </ActionButton>
        ) : (
          ""
        )}
        <ActionButton
          buttonType="button"
          buttonClickAction={() => generateUserCSVReport()}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <BsDownload style={{ fontSize: "14px" }} />
            <span style={{ fontSize: "12px" }}>CSV</span>
          </div>
        </ActionButton>

        <ButtonComponent
          isDisabled={false}
          inputWidth="auto"
          customstyles={{ padding: "0 10px", height: "35px" }}
          buttonName=""
          buttonClickAction={() => sendEmail()}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <BiEnvelope style={{ fontSize: "16px" }} />
            <span style={{ fontSize: "12px" }}>Send Email</span>
          </div>
        </ButtonComponent>
      </div>
      <div className="cf_message_user_mapping">
        <table className="cf_message_table">
          <thead>
            <tr>
              <th style={{ width: "1%", padding: "10px" }}>
                <div className="CF_d-flex ai-center">
                  <input
                    type="checkbox"
                    onChange={handleSelectAllUsers}
                    checked={
                      document.querySelectorAll("#input_SEND_EMAIL:checked")
                        ?.length ===
                        document.querySelectorAll("#input_SEND_EMAIL")
                          ?.length &&
                      document.querySelectorAll("#input_SEND_EMAIL")?.length > 0
                    }
                  />
                </div>
              </th>
              <th style={{ width: "45%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <div
                    className="cf_mapping_table_cloudIcon"
                    style={{ width: "27px", height: "27px" }}
                  >
                    <img
                      src={cloudImageMapper(
                        currentTab === "source"
                          ? getSelectedSourceCloudName()
                          : getSelectedDestinationCloudName()
                      )}
                      alt={
                        currentTab === "source"
                          ? getSelectedSourceCloudName()
                          : getSelectedDestinationCloudName()
                      }
                      style={{ width: "18px" }}
                    />
                  </div>
                  <div
                    className="CF_d-flex ai-center"
                    style={{ width: "100%", gap: "10px" }}
                  >
                    <span
                      style={{ gap: "10px", width: "fit-content" }}
                      className="CF_d-flex cf_mapping_email"
                      title="alex@filefuze.co"
                    >
                      {currentTab === "source"
                        ? "Source Users"
                        : "Destination Users"}
                    </span>
                    <CustomDropDown
                      customDropDownStyles={{
                        width: "170px",
                      }}
                      defaultVal={filters?.matched}
                      dropDownList={[
                        { key: "ALL", value: "All" },
                        { key: "MATCHED", value: "Matched" },
                      ]}
                      selectFilter={(e) => handleMathcedFilterChanges(e)}
                    >
                      <span className="CF_Pointer CF_d-flex ai-center">
                        <BiFilterAlt />
                      </span>
                    </CustomDropDown>
                  </div>
                </div>
              </th>
              <th style={{ width: "20%" }}>
                <span className="cf_mapping_email">Email Status</span>
              </th>
              <th style={{ width: "20%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                  <span
                    className="CF_d-flex cf_mapping_email"
                    style={{ gap: "10px", width: "fit-content" }}
                  >
                    Authenticated Status
                  </span>
                  <CustomDropDown
                    customDropDownStyles={{
                      width: "170px",
                      right: "-100%",
                    }}
                    defaultVal={filters?.authentication}
                    dropDownList={[
                      { key: "ALL", value: "All" },
                      { key: "AUTHENTICATED", value: "Authenticated" },
                      { key: "NOT_AUTHENTICATED", value: "Not Authenticated" },
                    ]}
                    selectFilter={(e) =>
                      setFilters({ ...filters, authentication: e })
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
            {sourceUsersList
              ?.filter((mail) => {
                if (filters?.matched?.key === "MATCHED") {
                  return matchedEmailList?.includes(mail?.emailId) ? mail : "";
                } else {
                  return mail;
                }
              })
              ?.filter((res) => {
                if (filters?.authentication?.key === "NOT_AUTHENTICATED") {
                  return !res?.provisioned ? res : "";
                } else if (filters?.authentication?.key === "AUTHENTICATED") {
                  return res?.provisioned ? res : "";
                } else {
                  return res;
                }
              })
              ?.map((data) => {
                return (
                  <tr key={data?.id}>
                    <td style={{ width: "1%", padding: "10px" }}>
                      <div className="CF_d-flex ai-center">
                        {data?.provisioned ? (
                          <input type="checkbox" disabled />
                        ) : (
                          <input
                            type="checkbox"
                            onChange={handleSendMailEvent}
                            id="input_SEND_EMAIL"
                            value={data?.cloudId}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "5px" }}
                      >
                        <div
                          className="cf_mapping_table_cloudIcon"
                          style={{ width: "27px", height: "27px" }}
                        >
                          <img
                            src={cloudImageMapper(
                              currentTab === "source"
                                ? getSelectedSourceCloudName()
                                : getSelectedDestinationCloudName()
                            )}
                            alt={
                              currentTab === "source"
                                ? getSelectedSourceCloudName()
                                : getSelectedDestinationCloudName()
                            }
                            style={{ width: "18px" }}
                          />
                        </div>
                        <div
                          className="CF_d-flex CF_flex-d-column"
                          style={{ width: "100%" }}
                        >
                          <span
                            className="cf_mapping_email"
                            title={data?.emailId}
                          >
                            {data?.emailId}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div
                        className="CF_d-flex CF_flex-d-column"
                        style={{ width: "100%" }}
                      >
                        <span className="cf_mapping_email">
                          {currentTab === "source"
                            ? getSelectedSourceCloudId() === data?.cloudId
                              ? "-"
                              : data?.emailSent && data?.emailStatus === null
                              ? "Email Processing"
                              : "Email Not Sent"
                            : getSelectedDestinationCloudId() === data?.cloudId
                            ? "-"
                            : data?.emailSent && data?.emailStatus === null
                            ? "Email Processing"
                            : "Email Not Sent"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="cf_mapping_email">
                        {data?.provisioned
                          ? "Authenticated"
                          : "Not Authenticated"}
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="cf_message_footerVal">
        <span>
          Total Users :{" "}
          {currentTab === "source"
            ? globalContext?.sourceCloud?.totolClouds
            : globalContext?.destinationCloud?.totolClouds}{" "}
        </span>
        <span>
          Authenticated :{" "}
          {getClouCombinationCode() === "S2S"
            ? paginationCount?.slackProvisionedCount
            : currentTab === "source"
            ? paginationCount?.slackProvisionedCount
            : paginationCount?.teamsProvisionedCount}{" "}
        </span>
        <span>
          Email Sent :{" "}
          {getClouCombinationCode() === "S2S"
            ? paginationCount?.slackEmailSentCount
            : currentTab === "source"
            ? paginationCount?.slackEmailSentCount
            : paginationCount?.teamsEmailSentCount}{" "}
        </span>
        <span className="cf_ml_auto"></span>
        <span style={{ fontWeight: "400" }}>{syncInfo}</span>
        <span style={{ opacity: "0.5" }}>
          Showing {pagination?.currentPage} of{" "}
          {pagination?.totalPages ? pagination?.totalPages : 1} Page
        </span>
        {/* <span>
          Showing :{" "}
          <select
            className="cf_message_pagination_select"
            name="pageSize"
            value={pagination?.pageSize}
            onChange={handlePagination}
          >
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="150">150</option>
            <option value="200">200</option>
          </select>
          &nbsp;Rows
        </span> */}
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
                <option value={data} key={`${data}_USR`}>
                  {data}
                </option>
              );
            })}
          </select>
        </span>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageSourceUsers;
