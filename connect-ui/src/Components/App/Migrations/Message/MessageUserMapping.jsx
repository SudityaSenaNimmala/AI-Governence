import React, { useContext, useEffect, useRef, useState } from "react";
import TabSwitcher from "../../../Resuables/TabSwitcher/TabSwitcher";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { cloudImageMapper, getRandomArray } from "../../../helpers/helpers";
import {
  deleteExistingUserMapping,
  downloadExistingUserMapping,
  getMessageDomainsSearchList,
  getPermissionMapping,
  getSerachMessageUserMapping,
  savePermissionMapping,
  uploadUserMappingCSVFile,
} from "./MessageActions/MessageActions";
import {
  downloadGlobalCSV,
  getClouCombinationCode,
  getSelectedDestinationCloudId,
  getSelectedSourceCloudId,
  notifyToast,
} from "../../../helpers/utils";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import MessageChannelsTables from "./MessageChannels/MessageChannelsTables";
import MessagePrivateChannelsTables from "./MessageChannels/MessagePrivateChannelsTables";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { IoTrashOutline } from "react-icons/io5";
import { BsDownload, BsUpload } from "react-icons/bs";
import { getDomainsSearchList } from "../Content/ContentActions/ContentActions";
import MessageExistingTeams from "./MessageChannels/MessageExistingTeams";

const MessageUserMapping = (props) => {
  let {
    atPosition,
    previousPosition,
    sourceCloud,
    destinationCloud,
    activeTab,
  } = props;
  const [existingTeams, setExistingTeams] = useState(false);
  const [currentTab, setCurrentTab] = useState("USERS");
  const [searchEmail, setSearchEmail] = useState("");
  const [userEmailSuggestionsList, setUserEmailSuggestionsList] = useState([]);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const { globalContext } = useContext(GlobalContext);
  const [mappingList, setMappingList] = useState([]);
  const [tabMenu, setTabMenu] = useState([]);
  const [pagination, setPagination] = useState({
    pageSize: 200,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  useEffect(() => {
    if (atPosition === 2) {
      if (sourceCloud === "SLACK" && destinationCloud === "MICROSOFT_TEAMS") {
        setTabMenu([
          {
            id: "USERS",
            name: "Users",
          },
          {
            id: "PUBLIC_CHANNELS",
            name: "Public Channels",
          },
          {
            id: "PRIVATE_CHANNELS",
            name: "Private Channels",
          },
        ]);
      } else {
        setTabMenu([
          {
            id: "USERS",
            name: "Users",
          },
        ]);
        getUserMappingList();
      }
    } else if (atPosition === 3) {
      if (
        (sourceCloud === "MICROSOFT_TEAMS" &&
          destinationCloud === "GOOGLE_CHAT") ||
        (sourceCloud === "MICROSOFT_TEAMS" &&
          destinationCloud === "MICROSOFT_TEAMS")
      ) {
        setTabMenu([
          {
            id: "PUBLIC_CHANNELS",
            name: "Public Teams",
          },
          {
            id: "PRIVATE_CHANNELS",
            name: "Private Teams",
          },
        ]);
      } else if (
        (sourceCloud === "GOOGLE_CHAT" && destinationCloud === "GOOGLE_CHAT") ||
        (sourceCloud === "GOOGLE_CHAT" &&
          destinationCloud === "MICROSOFT_TEAMS")
      ) {
        setTabMenu([
          {
            id: "PUBLIC_CHANNELS",
            name: "Public Spaces",
          },
          {
            id: "PRIVATE_CHANNELS",
            name: "Private Spaces",
          },
        ]);
      } else if (
        sourceCloud === "MICROSOFT_TEAMS" &&
        destinationCloud === "MICROSOFT_TEAMS"
      ) {
        setTabMenu([
          {
            id: "PUBLIC_CHANNELS",
            name: "Public Teams",
          },
          {
            id: "PRIVATE_CHANNELS",
            name: "Private Teams",
          },
        ]);
      } else if (
        getClouCombinationCode() === "W2C" ||
        getClouCombinationCode() === "W2V"
      ) {
        setTabMenu([
          {
            id: "PUBLIC_CHANNELS",
            name: "Public Groups",
          },
          {
            id: "PRIVATE_CHANNELS",
            name: "Private Groups",
          },
        ]);
      } else {
        setTabMenu([
          {
            id: "PUBLIC_CHANNELS",
            name: "Public Channels",
          },
          {
            id: "PRIVATE_CHANNELS",
            name: "Private Channels",
          },
        ]);
      }
    }
  }, [sourceCloud, destinationCloud, atPosition]);

  useEffect(() => {
    if (previousPosition === 1) {
      if (atPosition === 2) {
        setCurrentTab("USERS");
        getUserMappingList();
      } else {
        setCurrentTab("PUBLIC_CHANNELS");
      }
    }
  }, [atPosition]);

  useEffect(() => {
    setCurrentTab(activeTab);
  }, [activeTab]);

  const getUserMappingList = async (pageNo = pagination?.currentPage) => {
    setIsPageLoading(true);
    let mapping = await getPermissionMapping(
      getSelectedSourceCloudId(),
      getSelectedDestinationCloudId(),
      pageNo,
      pagination?.pageSize
    );
    if (mapping?.status === "OK") {
      setIsPageLoading(false);
      if (mapping?.res?.length === 0) {
        let savePermissions = await savePermissionMapping();
        if (savePermissions?.status === "OK") {
          setIsPageLoading(true);
          setTimeout(() => {
            getUserMappingList(1);
          }, 3000);
        }
      } else {
        if (pageNo === 1) {
          setPagination({
            ...pagination,
            totalDocuments: mapping?.res[0]?.noOfMappedCloudPressent,
            totalPages: Math.ceil(
              mapping?.res[0]?.noOfMappedCloudPressent / pagination?.pageSize
            ),
          });
        }
        setIsPageLoading(false);
        setMappingList(mapping?.res);
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const handleFileUploadStream = async (fileStream) => {
    setIsPageLoading(true);
    let deleteExistingMapping = await deleteExistingUserMapping();
    if (deleteExistingMapping?.status === "OK") {
      let uploadCSV = await uploadUserMappingCSVFile(fileStream);
      if (uploadCSV?.status === "OK") {
        setIsPageLoading(false);
        setMappingList(uploadCSV?.res);
      } else {
        notifyToast("error", "Failed Validating UserMapping CSV");
        getUserMappingList();
        setIsPageLoading(false);
      }
    } else {
      notifyToast("error", "Failed To Delete UserMapping");
      setIsPageLoading(false);
    }
  };

  const deleteUserMapping = async () => {
    setIsPageLoading(true);
    let deledeMapping = await deleteExistingUserMapping();
    if (deledeMapping?.status === "OK") {
      setIsPageLoading(false);
      setMappingList([]);
      getUserMappingList();
    } else {
      notifyToast("error", "Failed To Delete UserMapping");
      setIsPageLoading(false);
    }
  };

  const searchDebounce = useRef(null);

  const searchUsersList = async (searchInput) => {
    setSearchEmail(searchInput);
    if (userEmailSuggestionsList.includes(searchInput)) {
      getSearchUser(searchInput);
      setUserEmailSuggestionsList([]);
      return false;
    }
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    searchDebounce.current = setTimeout(async () => {
      if (searchInput) {
        setIsSuggestionsLoading(true);
        let res = await getMessageDomainsSearchList(
          searchInput,
          "sourceCloudId",
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
        getUserMappingList();
        setIsSuggestionsLoading(false);
        setUserEmailSuggestionsList([]);
      }
    }, 500);
  };

  const getSearchUser = async (email) => {
    setIsPageLoading(true);
    let res = await getSerachMessageUserMapping(email);
    if (res?.status === "OK") {
      if (res?.res) {
        let data = [];
        data?.push(res?.res);
        setMappingList(data);
        setIsPageLoading(false);
      } else {
        setIsPageLoading(false);
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const downloadUserMapping = async () => {
    try {
      setIsPageLoading(true);
      let res = await downloadExistingUserMapping(
        mappingList[0]?.noOfMappedCloudPressent
      );

      if (res?.status !== "OK") {
        throw new Error("Failed To Generate CSV Report");
      } else {
        downloadGlobalCSV(res?.res, "UserMapping");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsPageLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;

    if (name === "pageSize") {
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      setPagination({
        ...pagination,
        currentPage: +value,
      });
      getUserMappingList(+value);
    }
  };

  useEffect(() => {
    if (currentTab === "PUBLIC_CHANNELS") {
      localStorage.setItem("publicExistingTeams", existingTeams);
    } else {
      localStorage.setItem("privateExistingTeams", existingTeams);
    }
  }, [existingTeams]);

  useEffect(() => {
    let lastObject = JSON.parse(localStorage?.lastTracker);
    let maps = { ...lastObject };
    maps.currentTab = currentTab;
    localStorage.setItem("lastTracker", JSON.stringify(maps));
  }, [currentTab]);

  return (
    <>
      <TabSwitcher
        tabMenu={tabMenu}
        currentTab={currentTab}
        existingTeamsValue={existingTeams}
        changeExistingTeams={setExistingTeams}
        returnCurrentTab={(e) => setCurrentTab(e)}
      />
      {currentTab === "USERS" ? (
        <>
          <div className="cf_userMenu_action_pannel">
            <SearchComponent
              autoOpen={true}
              boxShadows={true}
              inputName="searchInput"
              isSuggestionsLoading={isSuggestionsLoading}
              suggestionsList={userEmailSuggestionsList}
              inputPlaceHolder={`Search By Source User Email`}
              onInputSearch={(e) => searchUsersList(e?.searchInput)}
            />
            <span style={{ marginLeft: "auto" }}></span>

            <ActionButton
              buttonType="button"
              buttonClickAction={() => deleteUserMapping()}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "5px" }}
              >
                <IoTrashOutline style={{ fontSize: "14px" }} />
                <span style={{ fontSize: "12px" }}>Delete</span>
              </div>
            </ActionButton>

            <ActionButton
              buttonType="button"
              buttonClickAction={() => downloadUserMapping()}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "5px" }}
              >
                <BsDownload style={{ fontSize: "14px" }} />
                <span style={{ fontSize: "12px" }}>CSV</span>
              </div>
            </ActionButton>
            <ActionButton
              buttonType="file"
              getFileStream={handleFileUploadStream}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "5px" }}
              >
                <BsUpload style={{ fontSize: "14px" }} />
                <span style={{ fontSize: "12px" }}>CSV</span>
              </div>
            </ActionButton>
          </div>
          <div className="cf_message_user_mapping">
            <table className="cf_message_table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                      <div
                        className="cf_mapping_table_cloudIcon"
                        style={{ width: "27px", height: "27px" }}
                      >
                        <img
                          src={cloudImageMapper(
                            globalContext?.sourceCloud?.cloudName
                          )}
                          alt={globalContext?.sourceCloud?.cloudName}
                          style={{ width: "18px" }}
                        />
                      </div>
                      <div
                        className="CF_d-flex CF_flex-d-column"
                        style={{ width: "100%" }}
                      >
                        <span
                          className="cf_mapping_email"
                          title="alex@filefuze.co"
                        >
                          Source Users
                        </span>
                      </div>
                    </div>
                  </th>
                  <th style={{ width: "30%" }}>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                      <div
                        className="cf_mapping_table_cloudIcon"
                        style={{ width: "27px", height: "27px" }}
                      >
                        <img
                          src={cloudImageMapper(
                            globalContext?.destinationCloud?.cloudName
                          )}
                          alt={globalContext?.destinationCloud?.cloudName}
                          style={{ width: "18px" }}
                        />
                      </div>
                      <div
                        className="CF_d-flex CF_flex-d-column"
                        style={{ width: "100%" }}
                      >
                        <span
                          className="cf_mapping_email"
                          title="alex@filefuze.co"
                        >
                          Destination Users
                        </span>
                      </div>
                    </div>
                  </th>
                  <th style={{ width: "10%" }}>
                    <span className="cf_mapping_email">Mapping Status</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {mappingList?.map((data, index) => {
                  return (
                    <tr key={`MAP_${index}`}>
                      <td>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "5px" }}
                        >
                          {data?.sourceCloudDetails ? (
                            <div
                              className="cf_mapping_table_cloudIcon"
                              style={{ width: "27px", height: "27px" }}
                            >
                              <img
                                src={cloudImageMapper(
                                  globalContext?.sourceCloud?.cloudName
                                )}
                                alt={globalContext?.sourceCloud?.cloudName}
                                style={{ width: "18px" }}
                              />
                            </div>
                          ) : (
                            ""
                          )}
                          <div
                            className="CF_d-flex CF_flex-d-column"
                            style={{ width: "100%" }}
                          >
                            <span
                              className="cf_mapping_email"
                              title="alex@filefuze.co"
                            >
                              {data?.sourceCloudDetails
                                ? data?.sourceCloudDetails?.emailId
                                : "-"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "5px" }}
                        >
                          {data?.destCloudDetails ? (
                            <div
                              className="cf_mapping_table_cloudIcon"
                              style={{ width: "27px", height: "27px" }}
                            >
                              <img
                                src={cloudImageMapper(
                                  globalContext?.destinationCloud?.cloudName
                                )}
                                alt={globalContext?.destinationCloud?.cloudName}
                                style={{ width: "18px" }}
                              />
                            </div>
                          ) : (
                            ""
                          )}
                          <div
                            className="CF_d-flex CF_flex-d-column"
                            style={{ width: "100%" }}
                          >
                            <span
                              className="cf_mapping_email"
                              title="alex@filefuze.co"
                            >
                              {data?.destCloudDetails
                                ? data?.destCloudDetails?.emailId
                                : "-"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="cf_mapping_email">
                          {data?.sourceCloudDetails && data?.destCloudDetails
                            ? "Mapped"
                            : "Unmapped"}
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
              Total Mappings : {mappingList[0]?.noOfMappedCloudPressent ?? 0}{" "}
            </span>
            <span>
              Total Source Users : {globalContext?.sourceCloud?.totolClouds}{" "}
            </span>
            <span>
              Total Destination Users :{" "}
              {globalContext?.destinationCloud?.totolClouds}{" "}
            </span>
            <span>Mapped : {mappingList[0]?.matched ?? 0} </span>
            <span>Unmapped : {mappingList[0]?.notMatched ?? 0} </span>
            <span className="cf_ml_auto"></span>
            <span style={{ opacity: "0.5" }}>
              Showing {pagination?.currentPage ? pagination?.currentPage : 1} of
              {pagination?.totalPages ? pagination?.totalPages : 1} Page
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
                    <option value={data} key={`RA_${data}`}>
                      {data}
                    </option>
                  );
                })}
              </select>
            </span>
          </div>
        </>
      ) : (
        ""
      )}
      {currentTab === "PUBLIC_CHANNELS" ? (
        existingTeams ? (
          <MessageExistingTeams channelType="public" />
        ) : (
          <MessageChannelsTables
            currentTab={currentTab}
            sourceCloud={sourceCloud}
            destinationCloud={destinationCloud}
            existingTeams={existingTeams}
          />
        )
      ) : (
        ""
      )}
      {/* <MessagePrivateChannelsTables currentTab={currentTab} /> */}
      {currentTab === "PRIVATE_CHANNELS" ? (
        existingTeams ? (
          <MessageExistingTeams channelType="private" />
        ) : (
          <MessageChannelsTables
            currentTab={currentTab}
            sourceCloud={sourceCloud}
            destinationCloud={destinationCloud}
            existingTeams={existingTeams}
          />
        )
      ) : (
        ""
      )}
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageUserMapping;
