import React, { useContext, useEffect, useRef, useState } from "react";
import { MdOutlineAdd } from "react-icons/md";
import { cloudImageMapper, getRandomArray } from "../../../../helpers/helpers";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import { HiMinus } from "react-icons/hi";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  channelsSyncInfo,
  getExistingTeamsChannels,
  getExistingTeamsList,
  getPaginationCounts,
  getSlackChannels,
  searchInChannels,
  searchInTeams,
  syncChannels,
} from "../MessageActions/MessageActions";
import { FaCaretDown, FaCaretRight } from "react-icons/fa6";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";
import {
  getSelectedDestinationCloudId,
  notifyToast,
} from "../../../../helpers/utils";
import { SET_SELECTED_CHANNELS_MAPPING } from "../../../../../GlobalContext/action.types";
import { RefreshCw } from "lucide-react";

const MessageExistingTeams = (props) => {
  const fileUploadRef = useRef(null);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const searchDebounce = useRef(null);
  // const [isLoading, setIsPageLoading] = useState(false);
  const { channelsMappingsList, dmsMappingsList } = globalContext;
  const [selectedMappingList, setSelectedMappingList] = useState(
    channelsMappingsList ?? {
      public: [],
      private: [],
      publicIds: [],
      privateIds: [],
    }
  );
  const [selectedPairs, setSelectedPairs] = useState({
    public: [],
    private: [],
    publicIds: [],
    privateIds: [],
  });
  const [syncInfo, setSyncInfo] = useState({});
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedTeamName, setSelectedTeamName] = useState("");
  const [searchVal, setSearchVal] = useState("");
  const [searchValDestination, setSearchValDestination] = useState("");
  const [searchEmailDestination, setSearchEmailDestination] = useState("");
  const [teamChannels, setTeamChannels] = useState([]);
  const [slackChannels, setSlackChannels] = useState([]);
  const [teamsList, setTeamsList] = useState([]);
  const [mappedPairs, setMappedPairs] = useState([]);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [paginationSource, setPaginationSource] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [paginationDestination, setPaginationDestination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const handleCSVUpload = () => {
    fileUploadRef.current.value = "";
    fileUploadRef.current.click();
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsPageLoading(true);

    if (file.type !== "text/csv") {
      setIsPageLoading(true);
      notifyToast("warn", "Invalid File Uploaded, Only Accepts CSV Format");
      return;
    }
    var reader = new FileReader();
    reader.onload = async () => {};
    reader.readAsText(file);
  };

  const fetchSlackChannes = async (
    pageNo = paginationDestination?.currentPage,
    pageSize = paginationDestination?.pageSize
  ) => {
    setIsPageLoading(true);
    let res = await getSlackChannels(
      pageNo,
      pageSize,
      props?.channelType,
      true
    );
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.res?.length > 0) {
        if (res?.res === "No Provision User Found" && pageNo === 1) {
          notifyToast("error", "No Channels Found");
        } else {
          setSlackChannels(res?.res);
        }
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const fetchTeamsList = async (
    pageNo = paginationDestination?.currentPage,
    pageSize = paginationDestination?.pageSize
  ) => {
    setIsPageLoading(true);

    let res = await getExistingTeamsList(props?.channelType, pageNo, pageSize);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.res?.length > 0) {
        if (res?.res === "No Provision User Found" && pageNo === 1) {
          notifyToast("error", "No Teams Found");
        } else {
          setTeamsList(res?.res);
        }
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const paginationCount = async () => {
    let res = await getPaginationCounts();
    if (res?.status === "OK") {
      if (props?.channelType === "public") {
        setPaginationSource({
          ...paginationSource,
          totalDocuments: res?.res?.publicChannelCount,
          totalPages: Math.ceil(
            res?.res?.publicChannelCount / paginationSource?.pageSize
          ),
        });
        setPaginationDestination({
          ...paginationDestination,
          totalDocuments: res?.res?.publicTeamsCount,
          totalPages: Math.ceil(
            res?.res?.publicTeamsCount / paginationDestination?.pageSize
          ),
        });
      } else {
        setPaginationSource({
          ...paginationSource,
          totalDocuments: res?.res?.privateChannelCount,
          totalPages: Math.ceil(
            res?.res?.privateChannelCount / paginationSource?.pageSize
          ),
        });
        setPaginationDestination({
          ...paginationDestination,
          totalDocuments: res?.res?.privateTeamsCount,
          totalPages: Math.ceil(
            res?.res?.privateTeamsCount / paginationDestination?.pageSize
          ),
        });
      }
    }
  };

  useEffect(() => {
    getSyncInfo();
    paginationCount();
    fetchSlackChannes();
    fetchTeamsList();
  }, []);

  const getSyncInfo = async () => {
    setIsPageLoading(true);
    try {
      let res = await channelsSyncInfo(true, getSelectedDestinationCloudId());
      if (res?.status === "OK") {
        setSyncInfo(res?.res);
      } else {
        throw new Error("Failed Getting Sync Information");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsPageLoading(false);
    }
  };

  const getTeamChannels = async (teamId, teamName) => {
    setIsPageLoading(true);
    setSelectedTeamId(teamId);
    setSelectedTeamName(teamName);
    setTeamChannels([]);
    let res = await getExistingTeamsChannels(teamId);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.res !== "No Provision User Found") {
        if (res?.res?.length > 0) {
          setTeamChannels(res?.res);
        }
      } else {
        notifyToast("warn", res?.res);
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const checkMapping = () => {
    let sourceInputs = document.querySelectorAll("#existingSource:checked");
    let destinationInputs = document.querySelectorAll(
      "#existingDestination:checked"
    );

    let sourceObject = [];
    if (sourceInputs?.length > 0 && destinationInputs?.length > 0) {
      sourceInputs.forEach((input) => {
        input.checked = false;
        input.disabled = true;
        sourceObject.push(
          JSON.parse(decodeURIComponent(input.getAttribute("data-obj")))
        );
      });
      let channelLevel = destinationInputs[0]?.getAttribute("data-level");
      let teamObject = JSON.parse(
        decodeURIComponent(destinationInputs[0]?.getAttribute("data-obj"))
      );

      let cpyMappingList = [...selectedPairs?.private];
      let cpyIds = [...selectedPairs?.privateIds];
      if (props?.channelType === "public") {
        cpyIds = [...selectedPairs?.publicIds];
        cpyMappingList = [...selectedPairs?.public];
      }

      destinationInputs[0].checked = false;
      let finalObj = [...sourceObject];
      sourceObject?.map((data, index) => {
        finalObj[index].destTeamName = teamObject?.teamName;
        finalObj[index].teamId = teamObject?.teamId ?? teamObject?.teamsId;
        if (channelLevel === "channels") {
          finalObj[index].newChannelId =
            teamObject?.fromRootId ?? teamObject?.channelId;
          finalObj[index].destChannelName = teamObject?.channelName;
          finalObj[index].destTeamName = selectedTeamName;
        }
        finalObj[index].existingTeam = true;
        cpyIds.push(data?.id);
        cpyMappingList.push(finalObj[index]);
      });
      if (props?.channelType === "public") {
        setSelectedPairs({
          ...selectedPairs,
          public: cpyMappingList,
          publicIds: cpyIds,
        });
      } else {
        setSelectedPairs({
          ...selectedPairs,
          private: cpyMappingList,
          privateIds: cpyIds,
        });
      }
    }
  };

  const selectMapping = (checked, obj) => {
    let cpyMappingList = [...selectedMappingList?.private];
    let cpyIds = [...selectedMappingList?.privateIds];
    if (props?.channelType === "public") {
      cpyIds = [...selectedMappingList?.publicIds];
      cpyMappingList = [...selectedMappingList?.public];
    }
    if (checked) {
      cpyMappingList.push(obj);
      cpyIds.push(obj?.id);
    } else {
      cpyMappingList = cpyMappingList?.filter((data) => data?.id !== obj?.id);
      cpyIds = cpyIds?.filter((data) => data !== obj?.id);
    }

    if (props?.channelType === "public") {
      setSelectedMappingList({
        ...selectedMappingList,
        public: cpyMappingList,
        publicIds: cpyIds,
      });
    } else {
      setSelectedMappingList({
        ...selectedMappingList,
        private: cpyMappingList,
        privateIds: cpyIds,
      });
    }
  };

  useEffect(() => {
    dispatch({
      type: SET_SELECTED_CHANNELS_MAPPING,
      payload: selectedMappingList,
    });
  }, [selectedMappingList]);

  const handlePaginationChange = (e, target) => {
    let { name, value } = e.target;
    if (name === "pageSize") {
      if (target === "SOURCE") {
        let count = paginationSource?.totalDocuments;
        setPaginationSource({
          ...paginationSource,
          currentPage: 1,
          pageSize: +value,
          totalPages: Math.ceil(count / +value),
        });
        fetchSlackChannes(1, +value);
      } else {
        let count = paginationDestination?.totalDocuments;
        setPaginationDestination({
          ...paginationDestination,
          currentPage: 1,
          pageSize: +value,
          totalPages: Math.ceil(count / +value),
        });
        fetchTeamsList(1, +value);
      }
    } else {
      if (target === "SOURCE") {
        setPaginationSource({
          ...paginationSource,
          currentPage: +value,
        });
        fetchSlackChannes(+value, paginationSource?.pageSize);
      } else {
        setPaginationDestination({
          ...paginationDestination,
          currentPage: +value,
        });
        fetchTeamsList(+value, paginationDestination?.pageSize);
      }
    }
  };

  const searchSourceUserList = async (e) => {
    let inputString = e?.searchInput;
    inputString = inputString?.trim();
    setSearchVal(inputString);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    searchDebounce.current = setTimeout(async () => {
      if (inputString?.length > 0) {
        setIsPageLoading(true);
        let res = await searchInChannels(
          props?.channelType,
          inputString,
          false,
          false
        );
        if (res?.status === "OK") {
          setIsPageLoading(false);
          if (res?.res !== "No Data Found") {
            setSlackChannels(res?.res);
          } else {
            notifyToast("warn", res?.res);
          }
        } else {
          setIsPageLoading(false);
        }
      } else if (inputString === "") {
        fetchSlackChannes();
      }
    }, 500);
  };

  const searchDestinationTeams = async (e) => {
    let inputString = e;
    inputString = inputString?.trim();
    setSearchValDestination(inputString);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    searchDebounce.current = setTimeout(async () => {
      if (inputString?.length > 0) {
        setIsPageLoading(true);
        let res = await searchInChannels(
          props?.channelType,
          inputString,
          false,
          true
        );
        if (res?.status === "OK") {
          setIsPageLoading(false);
          if (res?.res !== "No Data Found") {
            setTeamsList(res?.res);
          } else {
            notifyToast("warn", res?.res);
          }
        } else {
          setIsPageLoading(false);
        }
      } else if (inputString === "") {
        fetchTeamsList();
      }
    }, 500);
  };

  const getSyncTeams = async () => {
    try {
      setIsPageLoading(true);
      let res = await syncChannels(getSelectedDestinationCloudId());
      if (res?.status === "OK") {
        getSyncInfo();
        notifyToast("success", "Teams Synced Successfully");
      } else {
        setIsPageLoading(false);
        throw new Error("Failed Syncing Teams");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    }
  };

  const handleMultiSelect = (e) => {
    let channelsList = document.querySelectorAll("#channelSelect");
    let cpyMappingList = [...selectedMappingList?.private];
    let cpyIds = [...selectedMappingList?.privateIds];
    if (props?.channelType === "public") {
      cpyMappingList = [...selectedMappingList?.public];
      cpyIds = [...selectedMappingList?.publicIds];
    }
    channelsList.forEach((input) => {
      if (e.target.checked) {
        if (!input.checked) {
          let channelObject = input.getAttribute("data-object");
          channelObject = JSON.parse(decodeURIComponent(channelObject));
          cpyMappingList.push(channelObject);
          cpyIds.push(channelObject?.id);
        }
      } else {
        cpyMappingList = [];
        cpyIds = [];
      }
      input.checked = e.target.checked;
    });

    if (props?.channelType === "public") {
      setSelectedMappingList({
        ...selectedMappingList,
        public: cpyMappingList,
        publicIds: cpyIds,
      });
    } else {
      setSelectedMappingList({
        ...selectedMappingList,
        private: cpyMappingList,
        privateIds: cpyIds,
      });
    }
  };

  return (
    <>
      <div className="cf_placeExistingTeams CF_d-flex">
        <input
          type="file"
          accept=".csv"
          ref={fileUploadRef}
          onChange={(e) => handleFileUpload(e)}
          style={{
            visibility: "hidden",
            width: "0",
            height: "0",
            position: "absolute",
          }}
        />
        <div className="cf_content_source_selection">
          <div
            className="cf_content_mapping_title"
            style={{ gap: "10px", padding: "0 5px" }}
          >
            <div className="cf_content_mapping_title_image">
              <img
                src={cloudImageMapper(globalContext?.sourceCloud?.cloudName)}
                alt="BOX_BUSINESS"
              />
            </div>
            <p>Source</p>
            <div className="cf_content_mapping_title_search">
              <SearchComponent
                boxShadows={true}
                autoFocus={true}
                inputName="searchInput"
                suggestionsList={[]}
                customStyles={{
                  width: "200px",
                  height: "30px",
                  border: 0,
                  overflow: "hidden",
                }}
                customButtonStyles={{
                  background: "transparent",
                  color: "rgb(255, 255, 255)",
                  fontWeight: "bolder",
                  height: "30px",
                  border: 0,
                }}
                inputPlaceHolder={`Search By Channel Name`}
                onInputSearch={(e) => searchSourceUserList(e)}
              />
            </div>
          </div>
          <div
            className="cf_content_mapping_body"
            style={{ height: "calc(100% - 80px)" }}
          >
            {slackChannels?.map((data, index) => {
              return (
                <div
                  className="cf_mapping_domain"
                  key={data?.id}
                  style={{ padding: "10px" }}
                >
                  <span className="CF_d-flex CF_Pointer">
                    <input
                      type="checkbox"
                      id="existingSource"
                      data-obj={encodeURIComponent(JSON.stringify(data))}
                      onClick={checkMapping}
                    />
                  </span>
                  <span
                    className="cf_mapping_domain_name"
                    title={data?.channelName}
                  >
                    {data?.channelName}
                  </span>
                </div>
              );
            })}
          </div>
          <div
            className="cf_content_mapping_footer"
            style={{ gap: "10px", justifyContent: "space-between" }}
          >
            <p style={{ fontSize: "10px", fontWeight: "500" }}>
              Total: {paginationSource?.totalDocuments}
            </p>
            <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
              <p style={{ fontSize: "10px", fontWeight: "500" }}>Showing :</p>
              <select
                name="pageSize"
                onChange={(e) => handlePaginationChange(e, "SOURCE")}
                value={paginationSource?.pageSize}
              >
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="150">150</option>
                <option value="200">200</option>
              </select>
              <p style={{ fontSize: "10px", fontWeight: "500" }}> Rows</p>
            </div>
            <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
              <p style={{ fontSize: "10px", fontWeight: "500" }}>Goto:</p>
              <select
                name="currentPage"
                onChange={(e) => handlePaginationChange(e, "SOURCE")}
                value={paginationSource?.currentPage}
              >
                {getRandomArray(paginationSource?.totalPages)?.map((data) => {
                  return (
                    <option key={`source_${data}`} value={data}>
                      {data}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>

        <div className="cf_content_mapping">
          <div className="cf_content_mapping_title">
            <h4>Mapped Pairs</h4>
            <div className="cf_content_mapping_title_actions">
              <span
                className="CF_d-flex ai-center CF_Pointer"
                onClick={() => handleCSVUpload()}
              >
                <img src={cloudImageMapper("CSV_UPLOAD")} alt="CSV_UPLOAD" />
              </span>
            </div>
          </div>
          <div
            className="cf_content_premissionMapping_body"
            style={{ height: "calc(100% - 80px)" }}
          >
            <table className="cf_mapping_table">
              <thead>
                <tr>
                  <th style={{ width: "2%" }}>
                    <input
                      type="checkbox"
                      onChange={handleMultiSelect}
                      checked={
                        props?.channelType === "public" &&
                        selectedPairs?.public?.length > 0
                          ? selectedMappingList?.publicIds?.length ===
                            selectedPairs?.public?.length
                          : selectedPairs?.private?.length > 0
                          ? selectedMappingList?.privateIds?.length ===
                            selectedPairs?.private?.length
                          : false
                      }
                    />
                  </th>
                  <th style={{ width: "45%" }}>Source Channel</th>
                  <th style={{ width: "45%" }}>Destination Team/Channel</th>
                </tr>
              </thead>
              <tbody>
                {props?.channelType === "public"
                  ? selectedPairs?.public?.map((data, index) => {
                      return (
                        <tr key={`MAPP_${data?.id}`}>
                          <td>
                            <input
                              type="checkbox"
                              id="channelSelect"
                              data-id={data?.id}
                              data-object={encodeURIComponent(
                                JSON.stringify(data)
                              )}
                              data-currentindex={index}
                              onClick={(e) =>
                                selectMapping(e.target.checked, data)
                              }
                              checked={selectedMappingList?.publicIds?.includes(
                                data?.id
                              )}
                            />
                          </td>
                          <td>{data?.channelName}</td>
                          <td>
                            {data?.destChannelName
                              ? data?.destChannelName
                              : data?.destTeamName}
                          </td>
                        </tr>
                      );
                    })
                  : selectedPairs?.private?.map((data, index) => {
                      return (
                        <tr key={`MAPP_${data?.id}`}>
                          <td>
                            <input
                              type="checkbox"
                              id="channelSelect"
                              data-id={data?.id}
                              data-object={encodeURIComponent(
                                JSON.stringify(data)
                              )}
                              data-currentindex={index}
                              onClick={(e) =>
                                selectMapping(e.target.checked, data)
                              }
                              checked={selectedMappingList?.privateIds?.includes(
                                data?.id
                              )}
                            />
                          </td>
                          <td>{data?.channelName}</td>
                          <td>
                            {data?.destChannelName
                              ? data?.destChannelName
                              : data?.destTeamName}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
          <div
            className="cf_content_mapping_footer"
            style={{ gap: "10px", justifyContent: "space-between" }}
          >
            <div
              className="CF_d-flex ai-center"
              style={{ gap: "5px", marginLeft: "auto" }}
            >
              <p style={{ fontSize: "12px", fontWeight: "400" }}>
                {" "}
                {syncInfo?.lastSyncDate
                  ? `Last Synced ${
                      props?.channelType === "public"
                        ? syncInfo?.lastPublicTeamSyncCount
                        : syncInfo?.lastPrivateTeamSyncCount
                    } Teams On ${
                      syncInfo?.lastSyncDate
                        ? new Date(syncInfo?.lastSyncDate).toLocaleString()
                        : new Date().toLocaleString()
                    }`
                  : ""}
              </p>
            </div>
            <div
              className="CF_d-flex ai-center CF_Pointer"
              style={{ gap: "5px" }}
              onClick={() => getSyncInfo()}
            >
              <RefreshCw size={12} />
            </div>
          </div>
        </div>

        <div className="cf_content_source_selection">
          <div
            className="cf_content_mapping_title"
            style={{ gap: "10px", padding: "0 5px" }}
          >
            <div className="cf_content_mapping_title_image">
              <img
                src={cloudImageMapper(
                  globalContext?.destinationCloud?.cloudName
                )}
                alt="BOX_BUSINESS"
              />
            </div>
            <p>Destination</p>
            <div className="cf_content_mapping_title_search CF_d-flex ai-center">
              <RefreshCw
                size={12}
                className="CF_Pointer"
                style={{ position: "absolute", marginLeft: "-15px" }}
                onClick={() => getSyncTeams()}
              />
              <SearchComponent
                boxShadows={true}
                autoFocus={true}
                inputName="searchInput"
                suggestionsList={[]}
                customStyles={{
                  width: "200px",
                  height: "30px",
                  border: 0,
                  overflow: "hidden",
                }}
                customButtonStyles={{
                  background: "transparent",
                  color: "rgb(255, 255, 255)",
                  fontWeight: "bolder",
                  height: "30px",
                  border: 0,
                }}
                inputPlaceHolder={`Search By Team Name`}
                onInputSearch={(e) =>
                  searchDestinationTeams(e?.searchInput, "DESTINATION")
                }
              />
            </div>
          </div>
          <div
            className="cf_content_mapping_body"
            style={{ height: "calc(100% - 80px)" }}
          >
            {teamsList?.map((data, index) => {
              return (
                <>
                  <div
                    className="cf_mapping_domain"
                    key={data?.id}
                    style={{ padding: "10px" }}
                  >
                    <span
                      className="CF_d-flex CF_Pointer"
                      onClick={() => {
                        selectedTeamId === data?.teamId ||
                        selectedTeamId === data?.teamsId
                          ? setSelectedTeamId("")
                          : getTeamChannels(
                              data?.teamId ?? data?.teamsId,
                              data?.teamName
                            );
                      }}
                    >
                      {selectedTeamId === data?.teamId ||
                      selectedTeamId === data?.teamsId ? (
                        <FaCaretDown />
                      ) : (
                        <FaCaretRight />
                      )}
                    </span>
                    <span className="CF_d-flex CF_Pointer">
                      <input
                        type="radio"
                        id="existingDestination"
                        name="destTemaName"
                        data-level="teams"
                        onClick={checkMapping}
                        data-obj={encodeURIComponent(JSON.stringify(data))}
                      />
                    </span>
                    <span
                      className="cf_mapping_domain_name"
                      title={data?.teamName}
                    >
                      {data?.teamName}
                    </span>
                  </div>
                  {selectedTeamId === data?.teamId ||
                  selectedTeamId === data?.teamsId
                    ? teamChannels?.map((data) => {
                        return (
                          <div
                            className="cf_mapping_domain"
                            key={data?.id}
                            style={{ padding: "10px 40px" }}
                          >
                            <span className="CF_d-flex CF_Pointer">
                              <input
                                type="radio"
                                id="existingDestination"
                                name="destTemaName"
                                data-level="channels"
                                data-obj={encodeURIComponent(
                                  JSON.stringify(data)
                                )}
                                onClick={checkMapping}
                              />
                            </span>
                            <span
                              className="cf_mapping_domain_name"
                              title={data?.channelName}
                            >
                              {data?.channelName}
                            </span>
                          </div>
                        );
                      })
                    : ""}
                </>
              );
            })}
          </div>
          <div
            className="cf_content_mapping_footer"
            style={{ gap: "10px", justifyContent: "space-between" }}
          >
            <p style={{ fontSize: "10px", fontWeight: "500" }}>
              Total: {paginationDestination?.totalDocuments}
            </p>
            <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
              <p style={{ fontSize: "10px", fontWeight: "500" }}>Showing :</p>
              <select
                name="pageSize"
                onChange={(e) => handlePaginationChange(e, "DESTINATION")}
                value={paginationDestination?.pageSize}
              >
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="150">150</option>
                <option value="200">200</option>
              </select>
              <p style={{ fontSize: "10px", fontWeight: "500" }}> Rows</p>
            </div>
            <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
              <p style={{ fontSize: "10px", fontWeight: "500" }}>Goto:</p>
              <select
                name="currentPage"
                onChange={(e) => handlePaginationChange(e, "DESTINATION")}
                value={paginationDestination?.currentPage}
              >
                {getRandomArray(paginationDestination?.totalPages)?.map(
                  (data) => {
                    return (
                      <option key={`source_${data}`} value={data}>
                        {data}
                      </option>
                    );
                  }
                )}
              </select>
            </div>
          </div>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageExistingTeams;
