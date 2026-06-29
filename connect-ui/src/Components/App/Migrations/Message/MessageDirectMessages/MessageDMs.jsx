import React, { useContext, useEffect, useRef, useState } from "react";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import {
  cloudImageMapper,
  formatDateNew,
  getCloudName,
  getRandomArray,
} from "../../../../helpers/helpers";
import { BiFilterAlt } from "react-icons/bi";
import {
  deleteExistingDMsMapping,
  downloadDmsCSV,
  getDms,
  getPaginationCounts,
  searchInDms,
  syncDMs,
  uploadDMsCSVFile,
  validateMessageCSVFile,
} from "../MessageActions/MessageActions";
import CustomCalendar from "../../../../Resuables/CustomCalendar/CustomCalendar";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { SET_SELECTED_DMS_MAPPING } from "../../../../../GlobalContext/action.types";
import ActionButton from "../../../../Resuables/InputsComponents/ActionButton";
import { BsDownload, BsUpload } from "react-icons/bs";
import { IoTrashOutline } from "react-icons/io5";
import { GoSync } from "react-icons/go";
import {
  downloadGlobalCSV,
  getClouCombinationCode,
  getSourceAndDestination,
  notifyToast,
} from "../../../../helpers/utils";
import DMSEmailFormat from "./DMSEmailFormat";
import { Calendar } from "lucide-react";
import CustomDropDown from "../../../../Resuables/CustomDropDown/CustomDropDown";

const MessageDMs = () => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { dmsMappingsList } = globalContext;
  const [dmsList, setDmsList] = useState([]);
  const [searchVal, setSearchVal] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCSVMapping, setIsCSVMapping] = useState(false);
  const [footerPagination, setFooterPagination] = useState({});
  const [changeChannelDate, setChangeChannelDate] = useState({
    originalDate: "",
    channelDate: "",
    currentIndex: 0,
    channelId: "",
    positionX: "",
    positionY: "",
  });
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [selectedDmsMappingList, setSelectedDmsMappingList] = useState(
    dmsMappingsList ?? {
      dms: [],
      dmIds: [],
    }
  );
  const [paginationCount, setPaginationCount] = useState({});
  const [filter, setFilter] = useState({ key: "ALL", value: "All" });

  useEffect(() => {
    fetchDms();
    setFilter({ key: "ALL", value: "All" });
  }, []);

  const fetchDms = async (pageNo, pageSize) => {
    setIsLoading(true);
    let pgNo = pageNo ?? pagination?.currentPage;
    let pgSize = pageSize ?? pagination?.pageSize;
    let combination = getClouCombinationCode();
    let res = await getDms(pgNo, pgSize);
    if (res?.status === "OK") {
      if (res?.res === "No Provision User Found") {
        setIsLoading(false);
        notifyToast("success", "No Dms Found");
        return false;
      }
      // fetchPaginationCount();
      let dmsList = [];
      res?.res?.map((data) => {
        if (combination === "C2C" || combination === "C2T") {
          data.channelDate = data?.createdTime;
        }
        return !selectedDmsMappingList?.dmIds?.includes(data?.id)
          ? dmsList.push(data)
          : "";
      });
      setDmsList([...selectedDmsMappingList?.dms, ...dmsList]);
      // setDmsList(res?.res);
      setIsCSVMapping(res?.res[0]?.csv);
      if (pgNo === 1 && pgSize === 50) {
        fetchPaginationCount(res?.res[0]?.csv);
      }
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const fetchPaginationCount = async (isCSV) => {
    setIsLoading(true);
    let paginationCount = await getPaginationCounts(isCSV, false, "DM");
    if (paginationCount.status === "OK") {
      setIsLoading(false);

      setPaginationCount(paginationCount.res);
      setFooterPagination(paginationCount.res);
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let count = paginationCount?.dmsCount + paginationCount?.groupDmsCount;
    setPagination({
      currentPage: 1,
      pageSize: 50,
      totalPages: Math.ceil(count / 50),
      totalDocuments: count,
    });
  }, [paginationCount]);

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = paginationCount?.dmsCount;
    if (name === "pageSize") {
      fetchDms(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchDms(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  // useEffect(() => {
  //   fetchDms();
  // }, [pagination]);

  const handleMappingSelection = (e) => {
    let { checked } = e.target;
    let cpyDmsList = [...dmsList];
    let channelObject = e.target.getAttribute("data-object");
    let currentIndex = e.target.getAttribute("data-currentindex");
    channelObject = JSON.parse(decodeURIComponent(channelObject));
    let cpyMappingList = [...selectedDmsMappingList?.dms];
    let cpyIds = [...selectedDmsMappingList?.dmIds];
    if (checked) {
      cpyMappingList?.push(channelObject);
      cpyIds.push(channelObject?.id);
      // let temp = cpyDmsList[0];
      // cpyDmsList[0] = channelObject;
      // cpyDmsList[currentIndex] = temp;
      let temp = cpyDmsList[currentIndex];
      cpyDmsList.splice(currentIndex, 1);
      cpyDmsList.unshift(temp);
    } else {
      cpyMappingList = cpyMappingList?.filter(
        (data) => data?.id !== channelObject?.id
      );
      cpyIds = cpyIds?.filter((data) => data !== channelObject?.id);
      let temp = cpyDmsList[dmsList?.length - 1];
      cpyDmsList[dmsList?.length - 1] = channelObject;
      cpyDmsList[currentIndex] = temp;
    }
    setDmsList(cpyDmsList);
    setSelectedDmsMappingList({
      ...selectedDmsMappingList,
      dms: cpyMappingList,
      dmIds: cpyIds,
    });
  };

  useEffect(() => {
    dispatch({
      type: SET_SELECTED_DMS_MAPPING,
      payload: selectedDmsMappingList,
    });
  }, [selectedDmsMappingList]);

  const getDMsCSV = async () => {
    setIsLoading(true);
    let res = await downloadDmsCSV(false);
    if (res?.statusCode === 202) {
      setIsLoading(false);
      notifyToast(
        "success",
        "Report is in Progress,will be ready in few minutes"
      );
    } else if (res?.statusCode === 200) {
      setIsLoading(false);
      if (res?.res?.length > 0) {
        downloadGlobalCSV(res?.res, "DMs");
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

  const handleFileUploadStream = async (fileStream) => {
    setIsLoading(true);
    let deleteMappingRes = await deleteExistingDMsMapping();
    if (deleteMappingRes?.status === "OK") {
      let uploadCSVFileRes = await uploadDMsCSVFile(fileStream);
      if (uploadCSVFileRes?.status === "OK") {
        let csvValidation = await validateMessageCSVFile(
          fileStream,
          false,
          " "
        );
        if (csvValidation?.status === "OK") {
          downloadGlobalCSV(csvValidation?.res, `DMS_VALIDATION_REPORT`);
          fetchDms();
          resetChannelMapping();
          setIsCSVMapping(true);
          setPagination({
            pageSize: 50,
            totalPages: 1,
            currentPage: 1,
            totalDocuments: 0,
          });
        } else {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  };

  const deleteMapping = async () => {
    setIsLoading(true);
    let res = await deleteExistingDMsMapping();
    if (res?.status === "OK") {
      setIsCSVMapping(false);
      fetchDms();
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const handleSelectAllDm = (e) => {
    let dmChecks = document.querySelectorAll("#selectDm");
    let cpyMappingList = [...selectedDmsMappingList?.dms];
    let cpyIds = [...selectedDmsMappingList?.dmIds];

    dmChecks.forEach((input) => {
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

    setSelectedDmsMappingList({
      dms: cpyMappingList,
      dmIds: cpyIds,
    });
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
        let res = await searchInDms(inputString, isCSVMapping);
        if (res?.status === "OK") {
          setIsLoading(false);
          if (res?.res !== "No Data Found") {
            setDmsList(res?.res);
          } else {
            notifyToast("warn", res?.res);
          }
        } else {
          setIsLoading(false);
        }
      } else {
        fetchDms(1, 50);
        setPagination({
          pageSize: 50,
          totalPages: 1,
          currentPage: 1,
          totalDocuments: 0,
        });
      }
    }, 500);
  };

  const handleChangeDate = (data) => {
    let copyDmsList = [...dmsList];
    copyDmsList[data?.currentIndex].originalDate =
      copyDmsList[data?.currentIndex]?.channelDate;
    copyDmsList[data?.currentIndex].channelDate = data?.newDate / 1000;

    setDmsList(copyDmsList);
    setChangeChannelDate({
      originalDate: "",
      channelDate: "",
      currentIndex: 0,
      channelId: "",
      positionX: "",
      positionY: "",
    });
  };

  const getSyncDMs = async () => {
    setIsLoading(true);
    let res = await syncDMs(getSelectedSourceCloudId());
    if (res?.status === "OK") {
      notifyToast("success", "Started Syncing DM's");
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="cf_userMenu_action_pannel" style={{ gap: "15px" }}>
        <SearchComponent
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          inputPlaceHolder={`Search By Chat Name`}
          onInputSearch={(e) => searchSourceUserList(e)}
        />
        <span style={{ marginLeft: "auto" }}></span>
        <ActionButton
          buttonType="button"
          buttonClickAction={() => console.log()}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <GoSync style={{ fontSize: "14px" }} />
            <span style={{ fontSize: "12px" }}>Sync DM's</span>
          </div>
        </ActionButton>
        {isCSVMapping ? (
          <ActionButton
            buttonType="button"
            buttonClickAction={() => deleteMapping()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <IoTrashOutline style={{ fontSize: "14px" }} />
              <span style={{ fontSize: "12px" }}>Delete</span>
            </div>
          </ActionButton>
        ) : (
          ""
        )}
        <ActionButton buttonType="button" buttonClickAction={() => getDMsCSV()}>
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
        <table className="cf_message_table">
          <thead>
            <tr>
              <th style={{ width: "1%" }}>
                <span className="cf_mapping_email">S.No</span>
              </th>
              <th style={{ width: "1%" }}>
                <div className="CF_d-flex ai-center">
                  <input
                    type="checkbox"
                    onChange={handleSelectAllDm}
                    checked={
                      selectedDmsMappingList?.dmIds?.length ===
                        dmsList?.length && dmsList?.length > 0
                    }
                  />
                  {/* document.querySelectorAll("#selectDm:checked")?.length ===
                      document.querySelectorAll("#selectDm")?.length &&
                    document.querySelectorAll("#selectDm")?.length > 0 */}
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
                        getSourceAndDestination(
                          getClouCombinationCode(),
                          "SOURCE"
                        )
                      )}
                      alt="SLACK"
                      style={{ width: "18px" }}
                    />
                  </div>
                  <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
                    <span
                      style={{ gap: "10px" }}
                      className="CF_d-flex cf_mapping_email"
                      title="alex@filefuze.co"
                    >
                      Source Chat Name
                    </span>
                    <CustomDropDown
                      customDropDownStyles={{
                        width: "120px",
                        right: "-100%",
                      }}
                      defaultVal={filter}
                      dropDownList={[
                        { key: "ALL", value: "All" },
                        { key: "GROUP", value: "Group" },
                        { key: "ONE-ONE", value: "One-One" },
                      ]}
                      selectFilter={(e) => setFilter(e)}
                    >
                      <span className="CF_Pointer CF_d-flex ai-center">
                        <BiFilterAlt />
                      </span>
                    </CustomDropDown>
                  </div>
                </div>
              </th>
              {getClouCombinationCode() === "C2C" ||
              getClouCombinationCode() === "C2T" ||
              getClouCombinationCode() === "W2C" ||
              getClouCombinationCode() === "W2V" ? (
                ""
              ) : (
                <th style={{ width: "10%" }}>
                  <span className="cf_mapping_email">Channel Date</span>
                </th>
              )}
              <th style={{ width: "30%" }}>
                <span className="cf_mapping_email">Emails</span>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">Migration Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dmsList
              ?.filter((data) => {
                return filter?.key === "ALL"
                  ? data
                  : filter?.key === "GROUP"
                  ? data?.group
                  : !data?.group;
              })
              ?.map((data, index) => {
                return (
                  <tr key={data?.id}>
                    <td style={{ width: "1%" }}>
                      <span className="cf_mapping_email">{index + 1}</span>
                    </td>
                    <td style={{ width: "1%" }}>
                      <div className="CF_d-flex ai-center">
                        {getClouCombinationCode() === "S2C" && data?.self ? (
                          <input type="checkbox" disabled />
                        ) : (
                          <input
                            type="checkbox"
                            id="selectDm"
                            data-currentindex={index}
                            onChange={handleMappingSelection}
                            data-object={
                              getClouCombinationCode() === "T2C" ||
                              getClouCombinationCode() === "T2T"
                                ? encodeURIComponent(
                                    JSON.stringify({
                                      ...data,
                                      channelName: data?.dmsDisplayName,
                                      channelDate: data?.createdTime,
                                    })
                                  )
                                : encodeURIComponent(JSON.stringify(data))
                            }
                            checked={selectedDmsMappingList?.dmIds?.includes(
                              data?.id
                            )}
                          />
                        )}
                      </div>
                    </td>
                    <td style={{ width: "30%" }}>
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "5px" }}
                      >
                        <div className="CF_d-flex ai-center"></div>
                        <div
                          className="CF_d-flex CF_flex-d-column"
                          style={{ width: "100%" }}
                        >
                          <span
                            className="cf_mapping_email"
                            title={
                              data?.dmsDisplayName ||
                              data?.channelName?.replaceAll("mpdm-", "")
                            }
                          >
                            {data?.dmsDisplayName ||
                              data?.channelName?.replaceAll("mpdm-", "")}
                          </span>
                        </div>
                      </div>
                    </td>
                    {getClouCombinationCode() === "C2C" ||
                    getClouCombinationCode() === "C2T" ||
                    getClouCombinationCode() === "W2C" ||
                    getClouCombinationCode() === "W2V" ? (
                      ""
                    ) : (
                      <td>
                        <span
                          className="cf_mapping_email cf_tableEdit_Option"
                          onClick={(e) =>
                            setChangeChannelDate({
                              originalDate: formatDateNew(data?.originalDate),
                              channelDate: formatDateNew(
                                data?.channelDate || data?.createdTime
                              ),
                              currentIndex: index,
                              channelId: data?.id,
                              positionX: e.pageX,
                              positionY: e.pageY,
                            })
                          }
                        >
                          {formatDateNew(
                            data?.channelDate || data?.createdTime
                          )}
                        </span>
                      </td>
                    )}
                    <td>
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "5px" }}
                      >
                        <DMSEmailFormat
                          emailList={data?.emailIds}
                          dmName={data?.channelName?.replaceAll("mpdm-", "")}
                        />
                        {/* {data?.emailIds?.split(",")[0]
                          ? `${data?.emailIds?.split(",")[0]}${
                              data?.emailIds?.split(",")[1]
                                ? `,${data?.emailIds?.split(",")[1]}`
                                : ""
                            }`
                          : "---"} */}
                      </div>
                    </td>
                    <td>
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
      </div>
      <div className="cf_message_footerVal">
        <span>
          Total DM's :{" "}
          {pagination?.totalDocuments ? pagination?.totalDocuments : 0}{" "}
        </span>
        <span>
          Group DM's :{" "}
          {footerPagination?.groupDmsCount
            ? footerPagination?.groupDmsCount
            : 0}{" "}
          {/* {dmsList?.length > 0
            ? dmsList?.filter((item) => item.group === true).length
            : 0}{" "} */}
        </span>
        <span>
          One-One DM's :{" "}
          {dmsList?.length > 0
            ? dmsList?.filter((item) => item.group !== true).length
            : 0}{" "}
        </span>
        {selectedDmsMappingList?.dmIds?.length > 0 ? (
          <span>Selected : {selectedDmsMappingList?.dmIds?.length} </span>
        ) : (
          ""
        )}
        <span className="cf_ml_auto"></span>
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
                <option value={data} key={`${data}_DMS`}>
                  {data}
                </option>
              );
            })}
          </select>
        </span>
      </div>
      {isLoading ? getCFLoader() : ""}
      {changeChannelDate?.channelDate ? (
        <CustomCalendar
          customData={changeChannelDate}
          closeDate={setChangeChannelDate}
          applyChangeDate={handleChangeDate}
          customDate={changeChannelDate?.channelDate}
          originalDate={changeChannelDate?.originalDate}
        />
      ) : (
        ""
      )}
    </>
  );
};

export default MessageDMs;
