import { Merge } from "lucide-react";
import React, { useContext, useEffect, useRef, useState } from "react";
import { BsDownload, BsUpload } from "react-icons/bs";
import { FaHashtag, FaLock } from "react-icons/fa6";
import { GoSync } from "react-icons/go";
import { IoTrashOutline } from "react-icons/io5";
import { SET_SELECTED_CHANNELS_MAPPING } from "../../../../../GlobalContext/action.types";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  cloudImageMapper,
  formatDateNew,
  getCloudName,
  getRandomArray,
} from "../../../../helpers/helpers";
import {
  downloadGlobalCSV,
  getClouCombinationCode,
  getMaxChar,
  getSelectedDestinationCloudName,
  getSelectedSourceCloudName,
  notifyToast,
  validateEmail,
} from "../../../../helpers/utils";
import CustomCalendar from "../../../../Resuables/CustomCalendar/CustomCalendar";
import ActionButton from "../../../../Resuables/InputsComponents/ActionButton";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../../../Resuables/InputsComponents/TextInput";
import TextInputUpdate from "../../../../Resuables/InputsComponents/TextInputUpdate";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";
import Popup from "../../../../Resuables/Popup/Popup";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import {
  channelsSyncInfo,
  deleteExistingChannelMapping,
  downloadChannelsMappingCSV,
  getMessageDomainsSearchList,
  getPaginationCounts,
  getSlackChannels,
  searchInChannels,
  syncChannels,
  syncUserChannels,
  uploadChannelsCSVFile,
  validateMessageCSVFile,
} from "../MessageActions/MessageActions";
import MessageTeams from "../MessageTeams/MessageTeams";

const MessageChannelsTables = (props) => {
  let { sourceCloud, destinationCloud } = props;
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { channelsMappingsList } = globalContext;
  const [isLoading, setIsLoading] = useState(false);
  const [isEditVisible, setIsEditVisible] = useState(false);
  const [currentCombination, setCurrentCombination] = useState("S2T");
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [showSyncOptions, setShowSyncOptions] = useState(false);
  // const [isPageLoading, setIsPageLoading] = useState(false);
  const [channelsList, setChannelsList] = useState([]);
  const [selectedEdit, setSelectedEdit] = useState("");
  const [searchVal, setSearchVal] = useState("");
  const [mergeName, setMergeName] = useState("");
  const [lastSyncInfo, setLastSyncInfo] = useState({});
  const [isCSVMapping, setIsCSVMapping] = useState(false);
  const [syncOptions, setSyncOptions] = useState({
    type: "BULK",
    syncEmail: "",
    suggestionsLoading: false,
    suggestionsList: [],
  });
  const [changeChannelDate, setChangeChannelDate] = useState({
    channelDate: "",
    currentIndex: 0,
    channelId: "",
    positionX: "",
    positionY: "",
  });
  const [selectedMappingList, setSelectedMappingList] = useState(
    channelsMappingsList ?? {
      public: [],
      export: [],
      private: [],
      exportIds: [],
      publicIds: [],
      privateIds: [],
    }
  );
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [paginationCount, setPaginationCount] = useState({});
  let syncChannelsRateLimit = 0;
  useEffect(() => {
    setCurrentCombination(getClouCombinationCode());
  }, []);

  useEffect(() => {
    if (props?.currentTab) {
      setChannelsList([]);
      fetchChannels(1, 50);
      fetchChannelsSyncInfo();
    }
  }, [props?.currentTab]);

  const fetchChannels = async (pageNo, pageSize) => {
    setIsLoading(true);
    let pgNo = pageNo ?? pagination?.currentPage;
    let pgSize = pageSize ?? pagination?.pageSize;

    let channels = await getSlackChannels(
      pgNo,
      pgSize,
      props?.currentTab === "PUBLIC_CHANNELS" ? "public" : "private"
    );
    if (channels?.status === "OK") {
      if (
        channels?.res === "No Provision User Found" &&
        pagination?.currentPage === 1 &&
        syncChannelsRateLimit !== 2
      ) {
        setIsLoading(false);
        syncChannelsRateLimit++;
        setTimeout(async () => {
          return await startSyncChannels();
        }, 500);
        return false;
      }
      if (
        channels?.res === "No Provision User Found" &&
        pagination?.currentPage === 1 &&
        syncChannelsRateLimit === 2
      ) {
        setIsLoading(false);
        notifyToast(
          "success",
          "Channels Syncing In Progress, Please Try After Some time..."
        );
        return false;
      }
      setIsCSVMapping(channels?.res[0]?.csv);
      if (pgNo === 1 && pgSize === 50) {
        fetchPaginationCount(channels?.res[0]?.csv);
      }
      // setChannelsList([]);
      setIsLoading(false);
      let chanlList = [];
      let comb = getClouCombinationCode();
      let duplicateList = [];
      if (props?.currentTab === "PUBLIC_CHANNELS") {
        channels?.res?.map((data, index) => {
          let cpydata = data;
          if ((comb === "C2C" || comb === "C2T") && !data?.csv) {
            cpydata.channelDate = cpydata?.createdTime;
          }
          if (!selectedMappingList?.publicIds?.includes(data?.id)) {
            chanlList.push(cpydata);
          } else {
            duplicateList.push({
              id: cpydata?.id,
              name: cpydata?.channelName,
            });
          }
          // return !selectedMappingList?.publicIds?.includes(data?.id)
          //   ? chanlList.push(cpydata)
          //   : "";
        });
        console.log(chanlList?.length, "chanlList");
        console.log(duplicateList, "duplicateList");
        if (getClouCombinationCode() === "T2C") {
          setChannelsList([...chanlList]);
        } else {
          setChannelsList([...selectedMappingList?.public, ...chanlList]);
        }
      } else {
        setIsLoading(false);
        channels?.res?.map((data) => {
          let cpydata = data;
          if ((comb === "C2C" || comb === "C2T") && !data?.csv) {
            cpydata.channelDate = cpydata?.createdTime;
          }
          return !selectedMappingList?.privateIds?.includes(data?.id)
            ? chanlList.push(cpydata)
            : "";
        });
        if (getClouCombinationCode() === "T2C") {
          setChannelsList([...chanlList]);
        } else {
          setChannelsList([...selectedMappingList?.private, ...chanlList]);
        }
      }
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let count = paginationCount?.privateChannelCount;
    if (getSelectedSourceCloudName() === "MICROSOFT_TEAMS") {
      count = paginationCount?.privateTeamsCount;
    }
    if (props?.currentTab === "PUBLIC_CHANNELS") {
      count = paginationCount?.publicChannelCount;
      if (getSelectedSourceCloudName() === "MICROSOFT_TEAMS") {
        count = paginationCount?.publicTeamsCount;
      }
    }
    setPagination({
      ...pagination,
      totalPages: Math.ceil(count / 50),
      totalDocuments: count,
    });
  }, [paginationCount]);

  const fetchPaginationCount = async (isCSV) => {
    let paginationCount = await getPaginationCounts(isCSV);
    if (paginationCount.status === "OK") {
      setIsLoading(false);
      setPaginationCount(paginationCount.res);
    } else {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    // if (props?.currentTab === "PUBLIC_CHANNELS") {
    //   count = paginationCount?.publicChannelCount;
    // }
    // console.log(paginationCount, "paginationCount");
    // console.log(pagination, "pagination");

    if (name === "pageSize") {
      fetchChannels(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchChannels(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const saveUpdatedName = (
    channelId,
    updatedName,
    currentIndex,
    updatedFor
  ) => {
    let copyChannelsList = [...channelsList];
    if (updatedFor === "channelName") {
      copyChannelsList[currentIndex].destChannelName = updatedName;
      if (getSelectedDestinationCloudName() === "GOOGLE_CHAT") {
        notifyToast("success", "Destination Space Name Updated Successfully");
      } else {
        notifyToast("success", "Destination Channel Name Updated Successfully");
      }
    } else if (updatedFor === "teamName") {
      copyChannelsList[currentIndex].destTeamName = updatedName;
    } else if (updatedFor === "toSplit") {
      copyChannelsList[currentIndex].toSplit = updatedName;
    } else {
      copyChannelsList[currentIndex].originalDate =
        copyChannelsList?.channelDate;
      copyChannelsList[currentIndex].channelDate = updatedName;
    }
    if (
      props?.currentTab === "PRIVATE_CHANNELS" &&
      selectedMappingList?.privateIds?.includes(channelId)
    ) {
      let cpyMappingList = [...selectedMappingList?.private];
      let index = cpyMappingList.findIndex((data) => data?.id === channelId);
      cpyMappingList[index] = copyChannelsList[currentIndex];
      setSelectedMappingList({
        ...selectedMappingList,
        private: cpyMappingList,
      });
    }
    if (
      props?.currentTab === "PUBLIC_CHANNELS" &&
      selectedMappingList?.publicIds?.includes(channelId)
    ) {
      let cpyMappingList = [...selectedMappingList?.public];
      let index = cpyMappingList.findIndex((data) => data?.id === channelId);
      cpyMappingList[index] = copyChannelsList[currentIndex];
      setSelectedMappingList({
        ...selectedMappingList,
        public: cpyMappingList,
      });
    }

    setChannelsList(copyChannelsList);
    setSelectedEdit("");
  };

  const mergeSelectedChannels = () => {
    let inputs = document.querySelectorAll("#channelSelect:checked");
    let copyChannelsList = [...channelsList];
    let cpyMappingList = [...selectedMappingList?.private];
    if (props?.currentTab === "PUBLIC_CHANNELS") {
      cpyMappingList = [...selectedMappingList?.public];
    }
    inputs.forEach((inp, index) => {
      let channelId = inp.getAttribute("data-id");
      let currentIndex = inp.getAttribute("data-currentindex");
      copyChannelsList[currentIndex].destTeamName = mergeName;
      let indexD = cpyMappingList.findIndex((data) => data?.id === channelId);
      cpyMappingList[indexD] = copyChannelsList[currentIndex];
    });
    if (props?.currentTab === "PUBLIC_CHANNELS") {
      setSelectedMappingList({
        ...selectedMappingList,
        public: cpyMappingList,
      });
    } else {
      setSelectedMappingList({
        ...selectedMappingList,
        private: cpyMappingList,
      });
    }
    notifyToast("success", "Destination Team Name Updated Successfully");
    setChannelsList(copyChannelsList);
    setMergeName("");
    setIsEditVisible(false);
  };

  const handleMappingSelection = (e) => {
    let { checked } = e.target;
    let cpyChannelsList = [...channelsList];
    let channelObject = e.target.getAttribute("data-object");
    let currentIndex = e.target.getAttribute("data-currentindex");
    channelObject = JSON.parse(decodeURIComponent(channelObject));
    let cpyMappingList = [...selectedMappingList?.private];
    let cpyIds = [...selectedMappingList?.privateIds];
    if (props?.currentTab === "PUBLIC_CHANNELS") {
      cpyMappingList = [...selectedMappingList?.public];
      cpyIds = [...selectedMappingList?.publicIds];
    }
    if (checked) {
      cpyMappingList?.push(channelObject);
      cpyIds.push(channelObject?.id);
      let temp = cpyChannelsList[currentIndex];
      cpyChannelsList.splice(currentIndex, 1);
      cpyChannelsList.unshift(temp);
    } else {
      cpyMappingList = cpyMappingList?.filter(
        (data) => data?.id !== channelObject?.id
      );
      cpyIds = cpyIds?.filter((data) => data !== channelObject?.id);
      let temp = cpyChannelsList[channelsList?.length - 1];
      cpyChannelsList[channelsList?.length - 1] = channelObject;
      cpyChannelsList[currentIndex] = temp;
    }

    setChannelsList(cpyChannelsList);
    if (props?.currentTab === "PUBLIC_CHANNELS") {
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

  const handleFileUploadStream = async (fileStream) => {
    setIsLoading(true);
    try {
      let deleteMappingRes = await deleteExistingChannelMapping(
        props?.currentTab === "PUBLIC_CHANNELS" ? "public" : "private"
      );
      if (deleteMappingRes?.status === "OK") {
        let uploadCSVFileRes = await uploadChannelsCSVFile(
          fileStream,
          props?.currentTab === "PUBLIC_CHANNELS" ? "public" : "private"
        );
        if (uploadCSVFileRes?.status === "OK") {
          let timer = 3000;
          if (uploadCSVFileRes?.res === "Large Csv uploading please refresh") {
            timer = 15000;
          }
          setTimeout(() => {
            downloadValidationReport(fileStream);
          }, timer);
        } else {
          throw new Error("Failed Uploading CSV");
        }
      } else {
        throw new Error("Failed Deleting Mapping");
      }
    } catch (error) {
      setIsLoading(false);
      notifyToast("error", error?.message);
    }
  };

  const downloadValidationReport = async (fileStream) => {
    let res = await validateMessageCSVFile(
      fileStream,
      true,
      props?.currentTab === "PUBLIC_CHANNELS" ? "public" : "private"
    );
    if (res?.status === "OK") {
      downloadGlobalCSV(res?.res, `${props?.currentTab}_VALIDATION_REPORT`);
      resetChannelMapping();
      fetchChannels(1, 50);
      fetchPaginationCount(true);
      setIsCSVMapping(true);
      setPagination({
        pageSize: 50,
        totalPages: 1,
        currentPage: 1,
        totalDocuments: 0,
      });
    } else {
      setIsLoading(false);
      notifyToast("error", "Failed Generating Validation Report");
    }
  };

  const deleteMapping = async (action) => {
    setIsLoading(true);
    let res = await deleteExistingChannelMapping(
      props?.currentTab === "PUBLIC_CHANNELS" ? "public" : "private"
    );
    if (res?.status === "OK") {
      resetChannelMapping();
      setIsLoading(false);
      setIsCSVMapping(false);
      if (action === "DELETE") {
        fetchChannels(1, 50);
      }
      setPagination({
        pageSize: 50,
        totalPages: 1,
        currentPage: 1,
        totalDocuments: 0,
      });
    } else {
      setIsLoading(false);
    }
  };

  const resetChannelMapping = () => {
    let obj = {
      public: [],
      export: [],
      private: [],
      exportIds: [],
      publicIds: [],
      privateIds: [],
    };
    setSelectedMappingList(obj);
    return dispatch({
      type: SET_SELECTED_CHANNELS_MAPPING,
      payload: obj,
    });
  };

  const downloadMappingCSV = async () => {
    setIsLoading(true);
    let res = await downloadChannelsMappingCSV(
      isCSVMapping,
      props?.currentTab === "PUBLIC_CHANNELS" ? "public" : "private"
    );
    if (res?.statusCode === 202) {
      setIsLoading(false);
      notifyToast(
        "success",
        "Report is in Progress,will be ready in few minutes"
      );
    } else if (res?.statusCode === 200) {
      setIsLoading(false);
      if (res?.res?.length > 0) {
        downloadGlobalCSV(res?.res, props?.currentTab);
      } else {
        notifyToast(
          "success",
          "Report is in Progress,will be ready in few minutes"
        );
      }
    } else {
      setIsLoading(false);
      notifyToast("error", "Failed To Generate Report");
    }
  };

  const startSyncChannels = async () => {
    setShowSyncOptions(false);
    setSyncOptions({
      ...syncOptions,
      type: "BULK",
    });

    setIsLoading(true);
    if (syncOptions?.type === "SYNCEMAIL") {
      let res = await syncUserChannels(syncOptions?.syncEmail);
      if (res?.status === "OK") {
        notifyToast("success", "Sync Initiated Successfully");
        setIsLoading(false);
      } else {
        notifyToast("error", "Failed Syncing Channels");
        setIsLoading(false);
      }
    } else {
      let res = await syncChannels();
      if (res?.status === "OK") {
        notifyToast("success", "Channels Synced Successfully");
        setTimeout(() => {
          fetchChannelsSyncInfo();
          fetchChannels();
        }, 2000);
        setIsLoading(false);
      } else {
        notifyToast("error", "Failed Syncing Channels");
        setIsLoading(false);
      }
    }
  };

  const fetchChannelsSyncInfo = async () => {
    let res = await channelsSyncInfo();
    if (res?.status === "OK") {
      setLastSyncInfo(res?.res);
    }
  };

  const searchDebounce = useRef(null);
  const searchSourceUserList = async (e) => {
    let inputString = e?.searchInput;
    setSearchVal(inputString);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    searchDebounce.current = setTimeout(async () => {
      if (inputString?.length > 0) {
        setIsLoading(true);
        let res = await searchInChannels(
          props?.currentTab === "PUBLIC_CHANNELS" ? "public" : "private",
          inputString,
          isCSVMapping,
          false
        );
        if (res?.status === "OK") {
          setIsLoading(false);
          if (res?.res !== "No Data Found") {
            setChannelsList(res?.res);
          } else {
            notifyToast("warn", res?.res);
          }
        } else {
          setIsLoading(false);
        }
      } else if (inputString === null) {
        setIsLoading(false);
        fetchChannels();
      }
    }, 500);
  };

  const handleChangeDate = (data) => {
    saveUpdatedName(
      data?.channelId,
      data?.newDate / 1000,
      data?.currentIndex,
      "channelDate"
    );
    setChangeChannelDate({
      channelDate: "",
      currentIndex: 0,
      channelId: "",
      positionX: "",
      positionY: "",
    });
  };

  const startSplitChannels = (e, index) => {
    saveUpdatedName("", e.target.checked, index, "toSplit");
    if (e.target.checked) {
      notifyToast(
        "success",
        "By choosing split channels option, channels with over 250,000 messages will be split into multiple channels."
      );
    }
  };

  const handleMultiSelect = (e) => {
    let channelsList = document.querySelectorAll("#channelSelect");
    let cpyMappingList = [...selectedMappingList?.private];
    let cpyIds = [...selectedMappingList?.privateIds];
    if (props?.currentTab === "PUBLIC_CHANNELS") {
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

    if (props?.currentTab === "PUBLIC_CHANNELS") {
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

  const searchUsersList = async (searchInput) => {
    let cpySyncOptions = { ...syncOptions };
    cpySyncOptions.syncEmail = searchInput;
    if (cpySyncOptions?.suggestionsList.includes(searchInput)) {
      cpySyncOptions.suggestionsLoading = false;
      cpySyncOptions.syncEmail = searchInput;
      cpySyncOptions.suggestionsList = [];
      setSyncOptions(cpySyncOptions);

      return false;
    }
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    searchDebounce.current = setTimeout(async () => {
      if (searchInput) {
        cpySyncOptions.suggestionsLoading = true;
        setIsSuggestionsLoading(true);
        let res = await getMessageDomainsSearchList(
          searchInput,
          "sourceCloudId",
          1,
          5
        );
        if (res?.status === "OK") {
          setIsSuggestionsLoading(false);
          cpySyncOptions.suggestionsLoading = false;
          if (res?.res?.length > 0) {
            cpySyncOptions.suggestionsList = res?.res;
          }
        } else {
          setIsSuggestionsLoading(false);
          cpySyncOptions.suggestionsLoading = false;
        }
        setSyncOptions(cpySyncOptions);
      } else {
        setIsSuggestionsLoading(false);
        cpySyncOptions.suggestionsLoading = false;
        cpySyncOptions.suggestionsList = [];
        setSyncOptions(cpySyncOptions);
      }
    }, 500);
  };
  const getInputNAme = () => {
    if (globalContext?.sourceCloud?.cloudName === "MICROSOFT_TEAMS") {
      return "Search By  Team Name";
    } else if (globalContext?.sourceCloud?.cloudName === "GOOGLE_CHAT") {
      return "Search By Space Name";
    } else if (globalContext?.sourceCloud?.cloudName === "SLACK") {
      return "Search By Slack Channel Name";
    } else if (globalContext?.sourceCloud?.cloudName === "FACEBOOK_WORKPLACE") {
      return "Search By Group Name";
    }
  };

  return (
    <>
      <div className="cf_userMenu_action_pannel" style={{ gap: "15px" }}>
        <SearchComponent
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          defaultVal={searchVal === null ? "" : searchVal}
          inputPlaceHolder={getInputNAme()}
          onInputSearch={(e) =>
            searchSourceUserList(
              e?.searchInput === "" ? { searchInput: null } : e
            )
          }
        />
        <span style={{ marginLeft: "auto" }}></span>
        <ActionButton
          buttonType="button"
          // buttonClickAction={() => startSyncChannels()}
          buttonClickAction={() => {
            setSyncOptions({
              type: "BULK",
              syncEmail: "",
              suggestionsLoading: false,
              suggestionsList: [],
            });
            setShowSyncOptions(true);
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <GoSync style={{ fontSize: "14px" }} />
            <span style={{ fontSize: "12px" }}>Sync Channels</span>
          </div>
        </ActionButton>
        {document.querySelectorAll("#channelSelect:checked").length > 1 &&
        getClouCombinationCode() === "S2T" ? (
          <ActionButton
            buttonType="button"
            // buttonClickAction={() => startSyncChannels()}
            buttonClickAction={() => {
              setMergeName("");
              setIsEditVisible(true);
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <Merge size={14} style={{ transform: "rotate(90deg)" }} />
              <span style={{ fontSize: "12px" }}>Merge Channels</span>
            </div>
          </ActionButton>
        ) : (
          ""
        )}
        {isCSVMapping ? (
          <ActionButton
            buttonType="button"
            buttonClickAction={() => deleteMapping("DELETE")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <IoTrashOutline style={{ fontSize: "14px" }} />
              <span style={{ fontSize: "12px" }}>Delete</span>
            </div>
          </ActionButton>
        ) : (
          ""
        )}
        <ActionButton
          buttonType="button"
          buttonClickAction={() => downloadMappingCSV()}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <BsDownload style={{ fontSize: "14px" }} />
            <span style={{ fontSize: "12px" }}>CSV</span>
          </div>
        </ActionButton>
        <ActionButton buttonType="file" getFileStream={handleFileUploadStream}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <BsUpload style={{ fontSize: "14px" }} />
            <span style={{ fontSize: "12px" }}>CSV</span>
          </div>
        </ActionButton>
      </div>
      <div className="cf_message_user_mapping">
        {getClouCombinationCode() === "T2C" ||
        getClouCombinationCode() === "T2T" ? (
          <MessageTeams
            teamsList={channelsList}
            channelType={
              props?.currentTab === "PUBLIC_CHANNELS" ? "public" : "private"
            }
          />
        ) : (
          <table className="cf_message_table">
            <thead style={{ zIndex: "9" }}>
              <tr>
                <th style={{ width: "1%", padding: "10px" }}>
                  <div className="CF_d-flex ai-center">
                    <input
                      type="checkbox"
                      onChange={handleMultiSelect}
                      checked={
                        (props?.currentTab === "PUBLIC_CHANNELS"
                          ? selectedMappingList?.publicIds?.length ===
                            channelsList?.length
                          : selectedMappingList?.privateIds?.length ===
                            channelsList?.length) && channelsList?.length > 0
                      }
                    />
                  </div>
                </th>
                <th style={{ width: "15%" }}>
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
                        {currentCombination == "W2C" ||
                        currentCombination == "W2V"
                          ? "Group Name"
                          : currentCombination == "C2C" ||
                            currentCombination == "C2T"
                          ? `Source Space Name`
                          : `Channel Name`}
                      </span>
                    </div>
                  </div>
                </th>
                {destinationCloud === "MICROSOFT_TEAMS" ? (
                  <th style={{ width: "15%" }}>
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
                        <span className="cf_mapping_email">
                          Destination Team Name
                        </span>
                      </div>
                    </div>
                  </th>
                ) : (
                  ""
                )}
                <th style={{ width: "10%" }}>
                  {destinationCloud === "GOOGLE_CHAT" ? (
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
                        <span className="cf_mapping_email">
                          Destination Space Name
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="cf_mapping_email">
                      Destination Channel Name
                    </span>
                  )}
                </th>
                <th style={{ width: "10%" }}>
                  <span className="cf_mapping_email">
                    {currentCombination == "W2C" || currentCombination == "W2V"
                      ? "Group Date"
                      : "Channel Date"}
                  </span>
                </th>
                {currentCombination === "W2C" ||
                currentCombination === "W2V" ||
                currentCombination === "S2S" ||
                currentCombination === "C2T" ||
                currentCombination === "C2C" ? (
                  ""
                ) : (
                  <th style={{ width: "10%" }}>
                    <span className="cf_mapping_email">Split Channels</span>
                  </th>
                )}

                {currentCombination === "S2C" ? (
                  <th style={{ width: "10%" }}>
                    <span className="cf_mapping_email">
                      Manager Availability
                    </span>
                  </th>
                ) : (
                  ""
                )}
                <th style={{ width: "10%" }}>
                  <span className="cf_mapping_email">Migration Status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {channelsList?.map((data, index) => {
                return (
                  <tr key={data?.id}>
                    <td style={{ width: "1%", padding: "10px" }}>
                      <div className="CF_d-flex ai-center">
                        <input
                          type="checkbox"
                          id="channelSelect"
                          data-id={data?.id}
                          data-object={encodeURIComponent(JSON.stringify(data))}
                          data-currentindex={index}
                          onChange={handleMappingSelection}
                          checked={
                            props?.currentTab === "PUBLIC_CHANNELS"
                              ? selectedMappingList?.publicIds?.includes(
                                  data?.id
                                )
                              : selectedMappingList?.privateIds?.includes(
                                  data?.id
                                )
                          }
                        />
                      </div>
                    </td>
                    <td style={{ width: "15%" }}>
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "5px" }}
                      >
                        <div className="CF_d-flex ai-center">
                          {props?.currentTab === "PUBLIC_CHANNELS" ? (
                            <FaHashtag style={{ fontSize: "12px" }} />
                          ) : (
                            <FaLock style={{ fontSize: "12px" }} />
                          )}
                        </div>
                        <div
                          className="CF_d-flex CF_flex-d-column"
                          style={{ width: "100%" }}
                        >
                          <span
                            className="cf_mapping_email"
                            title={data?.channelName}
                          >
                            {getMaxChar(data?.channelName, 30)}
                          </span>
                        </div>
                      </div>
                    </td>
                    {destinationCloud === "MICROSOFT_TEAMS" ? (
                      <td style={{ width: "15%", position: "relative" }}>
                        {selectedEdit === `TEAMS_${data?.id}` ? (
                          <TextInputUpdate
                            defaultVal={data?.destTeamName ?? data?.channelName}
                            closeAction={() => setSelectedEdit("")}
                            saveAction={(value) =>
                              saveUpdatedName(
                                data?.id,
                                value,
                                index,
                                "teamName"
                              )
                            }
                          />
                        ) : (
                          <div
                            className="CF_d-flex ai-center CF_Pointer"
                            style={{ gap: "5px" }}
                            onClick={() => setSelectedEdit(`TEAMS_${data?.id}`)}
                          >
                            <div
                              className="CF_d-flex CF_flex-d-column"
                              style={{ width: "100%" }}
                            >
                              <span
                                className="cf_mapping_email cf_tableEdit_Option"
                                title={data?.destTeamName ?? data?.channelName}
                              >
                                {getMaxChar(
                                  data?.destTeamName ?? data?.channelName,
                                  30
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>
                    ) : (
                      ""
                    )}
                    <td
                      style={{
                        width: "10%",
                        position: "relative",
                        height: "52.5px",
                      }}
                    >
                      {selectedEdit === `CHANNEL_${data?.id}` ? (
                        <TextInputUpdate
                          defaultVal={
                            getClouCombinationCode() === "S2S" && isCSVMapping
                              ? data?.destTeamName
                                ? data?.destTeamName
                                : data?.channelName
                              : data?.destChannelName ?? data?.channelName
                          }
                          closeAction={() => setSelectedEdit("")}
                          saveAction={(value) =>
                            saveUpdatedName(
                              data?.id,
                              value,
                              index,
                              (getClouCombinationCode() === "S2S" ||
                                getClouCombinationCode() === "S2C") &&
                                isCSVMapping
                                ? "teamName"
                                : "channelName"
                            )
                          }
                        />
                      ) : (
                        <div
                          className="CF_d-flex ai-center CF_Pointer"
                          style={{ gap: "5px" }}
                          onClick={() => setSelectedEdit(`CHANNEL_${data?.id}`)}
                        >
                          <div
                            className="CF_d-flex CF_flex-d-column"
                            style={{ width: "100%" }}
                          >
                            <span
                              className="cf_mapping_email cf_tableEdit_Option"
                              title={
                                (getClouCombinationCode() === "S2S" ||
                                  getClouCombinationCode() === "S2C") &&
                                isCSVMapping
                                  ? data?.destTeamName
                                    ? data?.destTeamName
                                    : data?.channelName
                                  : data?.destChannelName ?? data?.channelName
                              }
                            >
                              {getMaxChar(
                                (getClouCombinationCode() === "S2S" ||
                                  getClouCombinationCode() === "S2C") &&
                                  isCSVMapping
                                  ? data?.destTeamName
                                    ? data?.destTeamName
                                    : data?.channelName
                                  : data?.destChannelName ?? data?.channelName,
                                40
                              )}
                            </span>
                          </div>
                        </div>
                      )}
                    </td>
                    <td style={{ width: "10%" }}>
                      <span
                        className="cf_mapping_email cf_tableEdit_Option"
                        onClick={(e) =>
                          setChangeChannelDate({
                            channelDate: formatDateNew(data?.channelDate),
                            currentIndex: index,
                            channelId: data?.id,
                            positionX: e.pageX,
                            positionY: e.pageY,
                          })
                        }
                      >
                        {formatDateNew(data?.channelDate)}
                      </span>
                    </td>
                    {currentCombination === "W2C" ||
                    currentCombination === "W2V" ||
                    currentCombination === "S2S" ||
                    currentCombination === "C2T" ||
                    currentCombination === "C2C" ? (
                      ""
                    ) : (
                      <td>
                        <label className="switch">
                          <input
                            type="checkbox"
                            id="splitChannels"
                            checked={data?.toSplit ? data?.toSplit : false}
                            onChange={(e) => startSplitChannels(e, index)}
                          />
                          <span
                            className="slider round"
                            style={{ top: "6px" }}
                          ></span>
                        </label>
                      </td>
                    )}
                    {currentCombination === "S2C" ? (
                      <td style={{ width: "10%" }}>
                        <span className="cf_mapping_email">
                          {getClouCombinationCode() === "S2C" && isCSVMapping
                            ? data?.destChannelName
                            : data?.managerAvailable
                            ? "Available"
                            : "Not Available"}
                        </span>
                      </td>
                    ) : (
                      ""
                    )}
                    <td style={{ width: "10%" }}>
                      <span className="cf_mapping_email">
                        {getCloudName(data?.processStatus) === "In Queue"
                          ? "Not Initiated"
                          : getCloudName(data?.processStatus)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="cf_message_footerVal">
        <span>
          {getSelectedSourceCloudName() === "GOOGLE_CHAT"
            ? "Total Spaces"
            : getSelectedSourceCloudName() === "MICROSOFT_TEAMS"
            ? `Total Teams`
            : `Total Channels`}{" "}
          : {pagination?.totalDocuments}{" "}
        </span>
        {props?.currentTab === "PUBLIC_CHANNELS" &&
        selectedMappingList?.publicIds?.length > 0 ? (
          <span>Selected : {selectedMappingList?.publicIds?.length} </span>
        ) : (
          ""
        )}
        {props?.currentTab === "PRIVATE_CHANNELS" &&
        selectedMappingList?.privateIds?.length > 0 ? (
          <span>Selected : {selectedMappingList?.privateIds?.length} </span>
        ) : (
          ""
        )}
        <span className="cf_ml_auto"></span>
        <span style={{ fontSize: "12px", fontWeight: "400" }}>
          {`Last Synced ${
            getSelectedSourceCloudName() === "MICROSOFT_TEAMS"
              ? props?.currentTab === "PUBLIC_CHANNELS"
                ? lastSyncInfo?.lastPublicTeamSyncCount || 0
                : lastSyncInfo?.lastPrivateTeamSyncCount || 0
              : props?.currentTab === "PUBLIC_CHANNELS"
              ? lastSyncInfo?.lastPublicSyncChannelCount || 0
              : lastSyncInfo?.lastPrivateSyncChannelCount || 0
          } ${
            getSelectedSourceCloudName() === "GOOGLE_CHAT"
              ? "Spaces"
              : "Channels"
          } On ${new Date(lastSyncInfo?.lastSyncDate ?? 0).toLocaleString()}`}
        </span>
        <span style={{ fontSize: "12px", fontWeight: "400" }}>
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
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="150">150</option>
            <option value="200">200</option>
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
                <option value={data} key={`${data}_OPT`}>
                  {data}
                </option>
              );
            })}
          </select>
        </span>
      </div>
      {changeChannelDate?.channelDate ? (
        <CustomCalendar
          customDate={changeChannelDate?.channelDate}
          closeDate={setChangeChannelDate}
          customData={changeChannelDate}
          applyChangeDate={handleChangeDate}
        />
      ) : (
        ""
      )}
      {isLoading ? getCFLoader() : ""}
      <Popup
        options={{
          isOpen: showSyncOptions,
          title: `Sync Channels`,
          popupWidth: "30%",
          popupHeight: `fit-content`,
          popupTop: "150px",
        }}
        toggleOpen={setShowSyncOptions}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            gap: "15px",
            alignItems: "flex-start",
          }}
        >
          <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
            <input
              type="radio"
              id="bulkSync"
              name="syncType"
              onChange={() =>
                setSyncOptions({
                  type: "BULK",
                  syncEmail: "",
                  suggestionsLoading: false,
                  suggestionsList: [],
                })
              }
              checked={syncOptions?.type === "BULK"}
            />
            <label htmlFor="bulkSync">Bulk Sync</label>
          </div>
          <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
            <input
              type="radio"
              id="syncByUsers"
              name="syncType"
              onChange={() =>
                setSyncOptions({
                  type: "SYNCEMAIL",
                  syncEmail: "",
                  suggestionsLoading: false,
                  suggestionsList: [],
                })
              }
              checked={syncOptions?.type === "SYNCEMAIL"}
            />
            <label htmlFor="syncByUsers">Sync By User</label>
          </div>
          {syncOptions?.type === "SYNCEMAIL" ? (
            <div
              className="CF_d-flex ai-center"
              style={{ visibility: "hidden" }}
            >
              <SearchComponent
                autoOpen={true}
                boxShadows={true}
                inputName="searchInput"
                isSuggestionsLoading={false}
                suggestionsList={[]}
                inputPlaceHolder={`Search By User Email`}
                onInputSearch={(e) => searchUsersList(e?.searchInput)}
              />
            </div>
          ) : (
            ""
          )}
          {syncOptions?.type === "SYNCEMAIL" ? (
            <div
              className="CF_d-flex ai-center"
              style={{ position: "absolute", marginTop: "90px" }}
            >
              <SearchComponent
                autoOpen={true}
                boxShadows={true}
                inputName="searchInput"
                isSuggestionsLoading={isSuggestionsLoading}
                suggestionsList={syncOptions?.suggestionsList}
                inputPlaceHolder={`Search By User Email`}
                onInputSearch={(e) => searchUsersList(e?.searchInput)}
              />
            </div>
          ) : (
            ""
          )}
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={
              syncOptions?.type === "BULK"
                ? false
                : syncOptions?.type === "SYNCEMAIL" &&
                  validateEmail(syncOptions?.syncEmail)
                ? false
                : true
            }
            buttonName="Start Sync"
            buttonClickAction={() => startSyncChannels()}
          />
        </div>
      </Popup>
      <Popup
        options={{
          isOpen: isEditVisible,
          title: `Merge Channels`,
          popupWidth: "25%",
          popupHeight: `fit-content`,
          popupTop: "150px",
        }}
        toggleOpen={setIsEditVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            gap: "15px",
            alignItems: "flex-start",
          }}
        >
          <TextInput
            type="text"
            autoFocus={true}
            inputWidth="100%"
            defaultValue={mergeName}
            inputName="domainName"
            placeHolder="Enter New Team Name *"
            getInputText={(val) => setMergeName(val)}
          />
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={
              syncOptions?.type === "BULK"
                ? false
                : syncOptions?.type === "SYNCEMAIL" &&
                  validateEmail(syncOptions?.syncEmail)
                ? false
                : true
            }
            buttonName="Merge"
            buttonClickAction={() => mergeSelectedChannels()}
          />
        </div>
      </Popup>
    </>
  );
};

export default MessageChannelsTables;
