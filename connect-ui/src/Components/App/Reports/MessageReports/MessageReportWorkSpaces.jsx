import React, { useEffect, useRef, useState } from "react";
import {
  downloadGlobalCSV,
  getMaxChar,
  getSourceAndDestination,
  notifyToast,
} from "../../../helpers/utils";
import {
  cloudImageMapper,
  formatDateNew,
  getCloudName,
  getRandomArray,
} from "../../../helpers/helpers";
import { FaHashtag, FaLock } from "react-icons/fa6";
import { BsDownload } from "react-icons/bs";
import {
  changeMessageWorkSpaceStatus,
  checkForMessageCheckBoxs,
  downloadWSReport,
  getJobReportsPaginationCount,
  getMessageJobWorkSpaces,
  getPauseCountForWorkSpaces,
  initiateMessageMigration,
} from "../../Migrations/Message/MessageActions/MessageActions";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { CirclePause, CircleX, Play } from "lucide-react";
import { BiFilterAlt } from "react-icons/bi";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";

const MessageReportWorkSpaces = (props) => {
  const { refreshJobWorkspaces, combination } = props;

  const [isLoading, setIsLoading] = useState(true);
  const [disabledList, setDisabledList] = useState({
    pause: true,
    cancel: true,
    resume: true,
    initateDelta: true,
  });
  const [filters, setFilters] = useState({
    jobType: { key: "All", value: "all" },
    processStatus: { key: "All", value: "all" },
  });
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [workspacesList, setWorkspacesList] = useState([]);
  const [searchVal, setSearchVal] = useState([]);

  useEffect(() => {
    checkForCheckBoxs();
    getPagination();
    fetchJobWorkSpaces();
    checkForPauseWorkSpaces();
  }, [props?.jobId]);

  const checkForCheckBoxs = async () => {
    setIsLoading(true);
    try {
      let res = await checkForMessageCheckBoxs(false, combination);
    } catch (error) {}
  };

  const getPagination = async (
    channelName = "",
    processStatus = filters?.processStatus?.value
  ) => {
    let res = await getJobReportsPaginationCount(
      "all",
      "all",
      "all",
      combination,
      channelName,
      "channel",
      props?.jobId,
      processStatus
    );
    if (res?.status === "OK") {
      let count = res?.res === 0 ? 1 : res?.res;
      setPagination({
        ...pagination,
        totalDocuments: res?.res,
        totalPages: Math.ceil(count / pagination?.pageSize),
      });
    }
  };

  const fetchJobWorkSpaces = async (
    pageNo = 1,
    pageSize = 50,
    jobType = filters?.jobType?.value,
    processStatus = filters?.processStatus?.value,
    channelName = ""
  ) => {
    setIsLoading(true);
    let res = await getMessageJobWorkSpaces(
      pageNo,
      pageSize,
      props?.jobId,
      jobType,
      processStatus,
      channelName
    );
    if (res?.status === "OK") {
      setWorkspacesList(res?.res);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const refreshWorkSpaces = () => {
    checkForCheckBoxs();
    getPagination();
    fetchJobWorkSpaces();
    checkForPauseWorkSpaces();
  };

  useEffect(() => {
    if (props?.updateReports?.split("|")[0] === "WORKSPACES") {
      refreshWorkSpaces();
    }
  }, [props?.updateReports]);

  useEffect(() => {
    // refreshJobWorkspaces(refreshWorkSpaces);
  }, [refreshJobWorkspaces]);

  const handleFilterChanges = (e, action) => {
    setFilters({ ...filters, [action]: e });
    let jobType = filters?.jobType?.value;
    let processStatus = filters?.processStatus?.value;

    if (action === "jobType") {
      jobType = e.value;
    }

    if (action === "processStatus") {
      processStatus = e.value;
    }

    getPagination(processStatus);
    fetchJobWorkSpaces(1, 50, jobType, processStatus);
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchJobWorkSpaces(1, +value);

      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchJobWorkSpaces(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const checkForPauseWorkSpaces = async () => {
    try {
      let res = await getPauseCountForWorkSpaces(props?.jobId);
      if (res?.status === "OK") {
        if (res?.res?.pauseCount > 0) {
          notifyToast(
            "warn",
            `This job has ${res?.res?.pauseCount} ${
              res?.res?.pauseCount > 1 ? "channels" : "channel"
            } currently paused. To close Team, you must resume the channel and wait for processing to complete, or cancel the Channel`
          );
        }
      }
    } catch (error) {}
  };

  const handleWorkSpaceSelection = () => {
    let checkBox = document.querySelectorAll("#selectWorkSpace:checked");
    let statusMapper = {};
    checkBox.forEach((input) => {
      statusMapper[input.getAttribute("data-status")] = statusMapper[
        input.getAttribute("data-status")
      ]
        ? statusMapper[input.getAttribute("data-status")] + 1
        : 1;
    });
    let cpyOptions = { ...disabledList };

    if (statusMapper["PAUSE"] > 0) {
      cpyOptions.resume = false;
    } else {
      cpyOptions.resume = true;
    }
    if (statusMapper["IN_PROGRESS"] > 0) {
      cpyOptions.pause = false;
      cpyOptions.cancel = false;
    } else {
      cpyOptions.pause = true;
      cpyOptions.cancel = true;
    }
    if (
      statusMapper["PROCESSED"] > 0 ||
      statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0
    ) {
      cpyOptions.initateDelta = false;
    } else {
      cpyOptions.initateDelta = true;
    }

    setDisabledList(cpyOptions);
  };

  const startInitateDelta = async () => {
    setIsLoading(true);
    setDisabledList({ ...disabledList, initateDelta: true });
    try {
      let checkBox = document.querySelectorAll("#selectWorkSpace:checked");
      let deltaBody = [];
      checkBox.forEach((input) => {
        let status = input.getAttribute("data-status");
        if (
          status === "PROCESSED" ||
          status === "PROCESSED_WITH_SOME_CONFLICTS"
        ) {
          let deltaObj = JSON.parse(
            decodeURIComponent(input.getAttribute("data-deltaobj"))
          );
          if (deltaObj?.combination === "S2S") {
            deltaObj.sourceDelegateCloudId = deltaObj?.fromCloudId?.id;
            deltaObj.destDelegateCloudId = deltaObj?.toCloudId?.id;
          }
          deltaBody.push(deltaObj);
        }
        input.checked = false;
      });
      let res = await initiateMessageMigration(deltaBody, true, props?.jobId);
      if (res?.status === "OK") {
        getPagination();
        fetchJobWorkSpaces(1, 50, "all", "all");
        notifyToast("success", "Delta Initiated Successfully");
      } else {
        throw new Error(res?.res?.error?.error_summary);
      }
    } catch (error) {
    } finally {
      setIsLoading(false);
    }
  };

  const handleWorkSpaceMigrationStatus = async (action) => {
    try {
      setIsLoading(true);
      let workSpaceId = [];
      let actionStatus = "PAUSE";
      let apiAction = "pause";
      let wsStatus = "PAUSE";
      let apiCount = 0;
      if (action === "PAUSE" || action === "CANCEL") {
        actionStatus = "IN_PROGRESS";
        if (action === "CANCEL") {
          wsStatus = "CANCEL";
          apiAction = "cancel";
        }
      }
      if (action === "RESUME") {
        wsStatus = "IN_PROGRESS";
        actionStatus = "PAUSE";
        apiAction = "resume";
      }
      let checkBox = document.querySelectorAll("#selectWorkSpace:checked");
      checkBox.forEach((input) => {
        input.checked = false;
        let status = input.getAttribute("data-status");
        if (status === actionStatus) {
          workSpaceId.push(input.getAttribute("data-workspaceid"));
        }
      });

      workSpaceId?.map(async (data) => {
        apiCount++;
        let res = await changeMessageWorkSpaceStatus(apiAction, data);
        if (res?.status === "OK") {
          if (workSpaceId?.length === apiCount) {
            apiAction = apiAction === "resume" ? "resumed" : apiAction;
            notifyToast("success", `Migration ${apiAction} Successfully`);
          }
          let copyWs = [...workspacesList];
          copyWs?.map((ws, index) => {
            if (ws.id === data) {
              if (apiAction === "resume") {
                copyWs[index].threadStatus = "RESUME";
                copyWs[index].processStatus = "IN_PROGRESS";
              } else {
                copyWs[index].processStatus = wsStatus;
              }
            }
          });
          setWorkspacesList(copyWs);
        }
      });
    } catch (error) {
    } finally {
      setDisabledList({
        ...disabledList,
        pause: true,
        cancel: true,
        resume: true,
      });
      setIsLoading(false);
    }
  };

  const searchDebounce = useRef(null);
  const searchJobs = async (e) => {
    let inputString = e;
    setSearchVal(inputString);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    searchDebounce.current = setTimeout(async () => {
      if (inputString?.length > 0) {
        setIsLoading(true);
        getPagination(inputString, "all");
        fetchJobWorkSpaces(1, 50, "all", "all", inputString);
      } else {
        fetchJobWorkSpaces(1, 50, "all", "all", "");
      }
    }, 500);
  };

  const handleSelectAllWorkSpaces = (e) => {
    if (e.target.checked) {
      let checkBox = document.querySelectorAll("#selectWorkSpace");
      let statusMapper = {};
      checkBox.forEach((input) => {
        if (!input.checked) {
          statusMapper[input.getAttribute("data-status")] = statusMapper[
            input.getAttribute("data-status")
          ]
            ? statusMapper[input.getAttribute("data-status")] + 1
            : 1;
          input.checked = true;
        }
      });
      let cpyOptions = { ...disabledList };

      if (statusMapper["PAUSE"] > 0) {
        cpyOptions.resume = false;
      } else {
        cpyOptions.resume = true;
      }
      if (statusMapper["IN_PROGRESS"] > 0) {
        cpyOptions.pause = false;
        cpyOptions.cancel = false;
      } else {
        cpyOptions.pause = true;
        cpyOptions.cancel = true;
      }
      if (
        statusMapper["PROCESSED"] > 0 ||
        statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0
      ) {
        cpyOptions.initateDelta = false;
      } else {
        cpyOptions.initateDelta = true;
      }

      setDisabledList(cpyOptions);
    } else {
      let checkBox = document.querySelectorAll("#selectWorkSpace");
      checkBox.forEach((input) => {
        input.checked = false;
      });
      setDisabledList({
        pause: true,
        cancel: true,
        resume: true,
        initateDelta: false,
      });
    }
  };

  const downloadReportWorkSpace = async (channelName, wsId) => {
    try {
      setIsLoading(true);
      let res = await downloadWSReport(wsId);
      if (res?.statusCode === 200) {
        downloadGlobalCSV(res?.res, `${channelName}_${wsId}_Report`);
      } else if (res?.statusCode === 202) {
        notifyToast(
          "success",
          "Report is in Progress,will be ready in few minutes"
        );
      } else {
        throw new Error("Failed Downloading Report");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="cf_userMenu_action_pannel" style={{ gap: "15px" }}>
        {combination === "S2T" ? (
          <SearchComponent
            autoOpen={true}
            boxShadows={true}
            inputName="searchInput"
            defaultVal={""}
            inputPlaceHolder={`Search By Slack Channel Name`}
            onInputSearch={(e) => searchJobs(e?.searchInput)}
          />
        ) : (
          ""
        )}

        <div className="cf_slackReportsBreadCrumbs">
          <div className="cf_slackReportsBreadCrumbs_actions">
            <span
              className="cf_reports_breadCrumbs_cta cf_make_link_reports"
              onClick={() => {
                props?.changeCurrentView("JOBS");
                props?.changeCurrentJobId("");
              }}
            >
              {combination === "S2C" ||
              combination === "T2C" ||
              combination === "C2C"
                ? `Spaces`
                : ``}
              {combination === "S2T" || combination === "T2T" ? `Teams` : ``}
              {combination === "S2S" ? `Channels` : ``}
              {combination === "W2C" || combination === "W2V" ? `Groups` : ``}
            </span>
            <span className="cf_reports_breadCrumbs_cta"> {">"} Channels</span>
          </div>
        </div>

        <span style={{ marginLeft: "auto" }}></span>
        {combination === "S2T" ? (
          <>
            <ActionButton
              customClass={`changeButtonColorOnHover ${
                disabledList?.pause ? "cf_button_disabled" : ""
              }`}
              customStyles={{
                backgroundColor: "#f2f2f2",
                padding: "8px 12px",
                height: "40px",
              }}
              buttonType="button"
              buttonClickAction={() => handleWorkSpaceMigrationStatus("PAUSE")}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <CirclePause size={14} strokeWidth={2} />
              </div>
            </ActionButton>
            <ActionButton
              customClass={`changeButtonColorOnHover ${
                disabledList?.resume ? "cf_button_disabled" : ""
              }`}
              customStyles={{
                backgroundColor: "#f2f2f2",
                padding: "8px 12px",
                height: "40px",
              }}
              buttonType="button"
              buttonClickAction={() => handleWorkSpaceMigrationStatus("RESUME")}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <Play size={14} strokeWidth={2} />
              </div>
            </ActionButton>
            <ActionButton
              customClass={`changeButtonColorOnHover ${
                disabledList?.cancel ? "cf_button_disabled" : ""
              }`}
              customStyles={{
                backgroundColor: "#f2f2f2",
                padding: "8px 12px",
                height: "40px",
              }}
              buttonType="button"
              buttonClickAction={() => handleWorkSpaceMigrationStatus("CANCLE")}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <CircleX size={14} strokeWidth={2} color="red" />
              </div>
            </ActionButton>
          </>
        ) : (
          ""
        )}

        <ActionButton
          customClass={`changeButtonColorOnHover ${
            disabledList?.initateDelta ? "cf_button_disabled" : ""
          }`}
          customStyles={{
            backgroundColor: "#f2f2f2",
            padding: "8px 12px",
            height: "40px",
          }}
          buttonType="button"
          buttonClickAction={() => startInitateDelta()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: "500" }}>
              Initate Delta
            </span>
          </div>
        </ActionButton>
      </div>
      <div className="cf_reports_tableDiv">
        <table className="cf_table_common">
          <thead
            className="cf_table_common_header cf_messageReports_table_header"
            style={{ backgroundColor: "transparent", color: "#454545" }}
          >
            <tr>
              <th style={{ width: "2%", padding: "5px !important" }}>
                <input
                  type="checkbox"
                  onChange={handleSelectAllWorkSpaces}
                  checked={
                    document.querySelectorAll("#selectWorkSpace:checked")
                      .length ===
                      document.querySelectorAll("#selectWorkSpace").length &&
                    document.querySelectorAll("#selectWorkSpace").length > 0
                  }
                />
              </th>
              <th style={{ width: "15%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <div className="CF_d-flex ai-center">
                    <img
                      style={{ width: "20px", height: "20px" }}
                      src={cloudImageMapper(
                        getSourceAndDestination(combination, "SOURCE")
                      )}
                      alt="SLACK"
                    />
                  </div>
                  <span>
                    {combination === "C2C" ? `Source Spaces` : ``}
                    {combination === "T2C" || combination === "T2T"
                      ? `Source Teams`
                      : ``}
                    {combination === "S2C" ||
                    combination === "S2S" ||
                    combination === "S2T"
                      ? `Source Channels`
                      : ``}
                    {combination === "W2C" || combination === "W2V"
                      ? `Source Groups`
                      : ``}
                  </span>
                </div>
              </th>
              <th style={{ width: "15%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <div className="CF_d-flex ai-center">
                    <img
                      style={{ width: "20px", height: "20px" }}
                      src={cloudImageMapper(
                        getSourceAndDestination(combination, "DESTINATION")
                      )}
                      alt="MICROSOFT_TEAMS"
                    />
                  </div>
                  <span>
                    {" "}
                    {combination === "T2C" ||
                    combination === "S2C" ||
                    combination === "W2C" ||
                    combination === "C2C"
                      ? `Destination Spaces`
                      : ``}
                    {combination === "T2T" ||
                    combination === "S2T" ||
                    combination === "S2S"
                      ? `Destination Channels`
                      : ``}
                  </span>
                </div>
              </th>
              <th style={{ textAlign: "center" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <span> Job Type</span>
                  <CustomDropDown
                    customDropDownStyles={{
                      width: "120px",
                      right: "-100%",
                    }}
                    defaultVal={filters?.jobType}
                    dropDownList={[
                      { key: "All", value: "all" },
                      { key: "One-Time", value: "ONETIME" },
                      { key: "Delta", value: "DELTA" },
                    ]}
                    selectFilter={(e) => handleFilterChanges(e, "jobType")}
                  >
                    <span className="CF_Pointer CF_d-flex ai-center">
                      <BiFilterAlt />
                    </span>
                  </CustomDropDown>
                </div>
              </th>
              <th style={{ textAlign: "center" }}>Total Messages</th>
              <th style={{ textAlign: "center" }}>Processed</th>
              <th style={{ textAlign: "center" }}>In Progress</th>
              <th style={{ textAlign: "center" }}>Total Files</th>
              <th style={{ textAlign: "center" }}>Initiated Date</th>
              <th style={{ textAlign: "center" }}>Processed Date</th>
              <th>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <span>Status</span>
                  <CustomDropDown
                    customDropDownStyles={{
                      width: "240px",
                      right: "-100%",
                    }}
                    defaultVal={filters?.processStatus}
                    dropDownList={[
                      { key: "All", value: "all" },
                      { key: "Processed", value: "PROCESSED" },
                      { key: "In Progress", value: "IN_PROGRESS" },
                      { key: "Not Processed", value: "NOT_PROCESSED" },
                      {
                        key: "Processed With Some Conflicts",
                        value: "PROCESSED_WITH_SOME_CONFLICTS",
                      },
                      { key: "Pause", value: "PAUSE" },
                      { key: "Cancel", value: "CANCEL" },
                      { key: "Suspended", value: "SUSPENDED" },
                      { key: "Conflict", value: "CONFLICT" },
                    ]}
                    selectFilter={(e) =>
                      handleFilterChanges(e, "processStatus")
                    }
                  >
                    <span className="CF_Pointer CF_d-flex ai-center">
                      <BiFilterAlt />
                    </span>
                  </CustomDropDown>
                </div>
              </th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody className="cf_messageReports_table_tbody">
            {workspacesList?.map((data) => {
              return (
                <tr key={data?.id}>
                  <td style={{ width: "2%", padding: "5px !important" }}>
                    {data?.processStatus !== "NOT_PROCESSED" &&
                    data?.processStatus !== "CANCEL" &&
                    data?.threadStatus !== "CANCEL" &&
                    (data?.teamClosed === false ||
                      data?.teamClosed === undefined ||
                      data?.teamClosed === null) &&
                    data?.fromCloudId !== undefined &&
                    data?.toCloudId !== null &&
                    data?.channelType !== "export" &&
                    !data?.deltaInitiated ? (
                      data?.toSplit && data?.disableCheckBox ? (
                        <input type="checkbox" disabled />
                      ) : (
                        <input
                          type="checkbox"
                          id="selectWorkSpace"
                          data-workspaceid={data?.id}
                          data-status={
                            data?.threadStatus === "RESUME"
                              ? data?.processStatus
                              : data?.threadStatus
                          }
                          onClick={() => handleWorkSpaceSelection()}
                          data-deltaobj={encodeURIComponent(
                            JSON.stringify({
                              fromCloudId: {
                                id: data?.fromCloudId?.id,
                              },
                              toCloudId: {
                                id: data?.toCloudId?.adminCloudId,
                              },
                              channelDate: data?.sourceDeltaId,
                              fromRootId: data?.fromRootId,
                              toRootId: data?.toRootId,
                              channelName: data?.channelName,
                              channelType: data?.channelType,
                              specialCharacter: "-",
                              workSpaceName: data?.workSpaceName,
                              destChannelName: data?.destChannelName,
                              destTeamName: data?.destTeamName,
                              combination: data?.combination,
                            })
                          )}
                        />
                      )
                    ) : (
                      <input type="checkbox" disabled />
                    )}
                  </td>
                  <td style={{ width: "14%" }}>
                    <div
                      style={{
                        display: "flex",
                        gap: "5px",
                        alignItems: "center",
                      }}
                    >
                      {data?.channelType === "public" ? (
                        <FaHashtag />
                      ) : (
                        <FaLock />
                      )}
                      <span>
                        <span
                          className="cf_make_link_reports"
                          title={data?.channelName}
                          onClick={() => {
                            props?.changeCurrentView("FILES");
                            props?.setWorkspacesId(data?.id);
                          }}
                        >
                          {getMaxChar(data?.channelName, 20)}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td style={{ width: "14%" }}>
                    <span>
                      <span
                        className="cf_make_link_reports"
                        title={data?.destChannelName}
                        onClick={() => {
                          props?.changeCurrentView("FILES");
                          props?.setWorkspacesId(data?.id);
                        }}
                      >
                        {getMaxChar(data?.destChannelName, 20)}
                      </span>
                    </span>
                  </td>
                  <td style={{ textAlign: "center", width: "7%" }}>
                    {data?.deltaMigration ? "Delta" : "OneTime"}
                  </td>
                  <td style={{ textAlign: "center", width: "9%" }}>
                    {data?.totalFilesAndmessage}
                  </td>
                  <td style={{ textAlign: "center", width: "8%" }}>
                    {data?.processedCount}
                  </td>
                  <td style={{ textAlign: "center", width: "8%" }}>
                    {data?.inProgressCount}
                  </td>
                  <td style={{ textAlign: "center", width: "8%" }}>
                    {data?.totalFiles}
                  </td>
                  <td style={{ textAlign: "center", width: "8%" }}>
                    {formatDateNew(data?.createdTime, true).replaceAll(
                      "/",
                      "-"
                    )}
                  </td>
                  <td
                    style={{
                      textAlign: "center",
                      width: "9%",
                    }}
                  >
                    {data?.endTime &&
                    (data?.processStatus === "PROCESSED_WITH_SOME_CONFLICTS" ||
                      data?.processStatus === "PROCESSED")
                      ? formatDateNew(data?.endTime, true).replaceAll("/", "-")
                      : "---"}
                  </td>
                  <td
                    style={{
                      width: "12%",
                      whiteSpace: "nowrap",
                    }}
                    className={
                      data?.threadStatus === "RESUME"
                        ? data?.processStatus
                        : data?.threadStatus
                    }
                  >
                    {data?.threadStatus === "RESUME"
                      ? getCloudName(data?.processStatus)
                      : getCloudName(data?.threadStatus)}
                  </td>
                  <td style={{ width: "8%", textAlign: "center" }}>
                    <BsDownload
                      className="CF_Pointer"
                      style={{
                        strokeWidth: "0.5",
                        color: "#0062ff",
                        fontSize: "14px",
                      }}
                      onClick={() =>
                        downloadReportWorkSpace(data?.channelName, data?.id)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cf_message_footerVal">
        <span>Total Workspaces : {pagination?.totalDocuments} </span>
        <span className="cf_ml_auto"></span>
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
      {isLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageReportWorkSpaces;
