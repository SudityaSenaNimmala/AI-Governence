import React, { useEffect, useState } from "react";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import { BsDownload } from "react-icons/bs";
import {
  IoChevronDownCircleOutline,
  IoChevronUpCircleSharp,
} from "react-icons/io5";
import {
  getDateFormatted,
  getFileIcons,
  getMaxChar,
  getSizeFormatted,
  notifyToast,
} from "../../../helpers/utils";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { LiaTimesCircleSolid } from "react-icons/lia";
import { AiOutlinePauseCircle } from "react-icons/ai";
import { FaRegPlayCircle } from "react-icons/fa";
import {
  changeMigrationStatus,
  getWorkspacesFileFolderCount,
  getWorkspacesFileFolderList,
} from "../../Migrations/Content/ContentActions/ContentActions";
import ButtonPagination from "../../../Resuables/Paginations/ButtonPagination";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";

const ContentWorkSpaces = (props) => {
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [selectedWorkSpace, setSelectedWorkSpace] = useState([]);
  const [workSpaceInfoCount, setWorkSpaceInfoCount] = useState({});
  const [workSpaceFileFolderList, setWorkSpaceFileFolderList] = useState([]);

  useEffect(() => {
    if (selectedWorkSpace?.id) {
      setCurrentPage(1);
      setWorkSpaceInfoCount({});
      setWorkSpaceFileFolderList([]);
      setIsLoading(true);
      fetchWorkSpaceFileFolderCount();
    }
  }, [selectedWorkSpace]);

  const fetchWorkSpaceFileFolderCount = async () => {
    let res = await getWorkspacesFileFolderCount(selectedWorkSpace?.id);
    if (res?.status === "OK") {
      setWorkSpaceInfoCount(res?.res);
      fetchWorkspacesFileFolderList();
    }
  };

  const fetchWorkspacesFileFolderList = async () => {
    setIsPageLoading(true);
    let res = await getWorkspacesFileFolderList(
      selectedWorkSpace?.id,
      currentPage
    );
    if (res?.status === "OK") {
      setIsLoading(false);
      setIsPageLoading(false);
      setWorkSpaceFileFolderList(res?.res);
    } else {
      setIsPageLoading(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspacesFileFolderList();
  }, [currentPage]);

  const changeWorspaceStatus = async (wsId, index, status) => {
    try {
      setIsPageLoading(true);
      let res = await changeMigrationStatus(wsId, status);
      if (res?.status === "OK") {
        let tempData = [...props?.workSpacesList];
        tempData[index].processStatus =
          status === "RESUME" ? "IN_PROGRESS" : status;
      } else {
        throw new Error("Failed to update status");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsPageLoading(false);
    }
  };

  return (
    <>
      <tr style={{ border: "1px solid #ddd" }}>
        <td colspan="10">
          <table className="cf_table_common">
            <thead
              className="cf_table_common_header_inside"
              style={{
                background: "#f2f3ff !important",
                color: "#000 !important",
              }}
            >
              <tr style={{ background: "#f2f3ff" }}>
                <th style={{ width: "15%" }}>From</th>
                <th style={{ width: "15%" }}>To</th>
                <th style={{ width: "12%" }}>Status</th>
                <th style={{ width: "15%" }}>Total Data Migrated</th>
                <th style={{ width: "10%" }}>Date</th>
                <th style={{ width: "5%" }}>Download</th>
                <th style={{ width: "5%" }}>Pause/Resume</th>
                <th style={{ width: "5%" }}>Cancel</th>
                <th style={{ width: "3%" }}></th>
              </tr>
            </thead>
            <tbody>
              {props?.isLoading ? (
                <tr>
                  <td
                    colSpan="9"
                    style={{
                      borderRight: "1px solid #ddd",
                      borderLeft: "1px solid #ddd",
                    }}
                  >
                    {getCFTextLoader()}
                  </td>
                </tr>
              ) : (
                ""
              )}
              <>
                {props?.workSpacesList?.map((data, index) => {
                  return (
                    <>
                      <tr key={data?.id}>
                        <td style={{ borderLeft: "1px solid #ddd" }}>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "10px" }}
                          >
                            <div className="cf_reports_image_wrapper">
                              <img
                                src={cloudImageMapper(data?.fromCloudName)}
                                alt={data?.fromCloudName}
                              />
                            </div>
                            {data?.fromMailId}
                          </div>
                        </td>
                        <td>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "10px" }}
                          >
                            <div className="cf_reports_image_wrapper">
                              <img
                                src={cloudImageMapper(data?.toCloudName)}
                                alt={data?.toCloudName}
                              />
                            </div>
                            {data?.toMailId}
                          </div>
                        </td>
                        <td className={`cf_status_td ${data?.processStatus}`}>
                          {getCloudName(data?.processStatus)}
                        </td>
                        <td>
                          <div
                            className="CF_d-flex CF_flex-d-column"
                            style={{ gap: "5px" }}
                          >
                            <progress
                              value={data?.processedDataSize}
                              max={data?.dataSize}
                            ></progress>
                            <span>
                              {getSizeFormatted(data?.processedDataSize)}{" "}
                              migrated of {getSizeFormatted(data?.dataSize)}{" "}
                            </span>
                          </div>
                        </td>
                        <td>{getDateFormatted(data?.createdTime)}</td>
                        <td style={{ textAlign: "center" }}>
                          {data?.processStatus === "PROCESSED" ? (
                            <BsDownload
                              className="CF_Pointer"
                              style={{
                                fontSize: "18px",
                                color: "#0062ff",
                              }}
                            />
                          ) : (
                            <BsDownload
                              style={{
                                fontSize: "18px",
                                color: "#000",
                                opacity: "0.5",
                                cursor: "not-allowed",
                              }}
                            />
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {data?.processStatus === "IN_PROGRESS" ? (
                            <AiOutlinePauseCircle
                              className="CF_Pointer"
                              style={{
                                fontSize: "18px",
                                color: "#000",
                              }}
                              onClick={() =>
                                changeWorspaceStatus(data?.id, index, "PAUSE")
                              }
                            />
                          ) : data?.processStatus === "PAUSE" ? (
                            <FaRegPlayCircle
                              className="CF_Pointer"
                              style={{
                                fontSize: "18px",
                                color: "#000",
                              }}
                              onClick={() =>
                                changeWorspaceStatus(data?.id, index, "RESUME")
                              }
                            />
                          ) : (
                            <FaRegPlayCircle
                              style={{
                                fontSize: "18px",
                                color: "#000",
                                opacity: "0.5",
                                cursor: "not-allowed",
                              }}
                            />
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {data?.processStatus === "IN_PROGRESS" ? (
                            <LiaTimesCircleSolid
                              className="CF_Pointer"
                              style={{
                                fontSize: "18px",
                                color: "red",
                              }}
                              onClick={() =>
                                changeWorspaceStatus(data?.id, index, "CANCEL")
                              }
                            />
                          ) : data?.processStatus === "PAUSE" ? (
                            <LiaTimesCircleSolid
                              className="CF_Pointer"
                              style={{
                                fontSize: "18px",
                                color: "red",
                              }}
                              onClick={() =>
                                changeWorspaceStatus(data?.id, index, "CANCEL")
                              }
                            />
                          ) : (
                            <LiaTimesCircleSolid
                              style={{
                                fontSize: "18px",
                                color: "#000",
                                opacity: "0.5",
                                cursor: "not-allowed",
                              }}
                            />
                          )}
                        </td>
                        <td
                          style={{
                            textAlign: "center",
                            borderRight: "1px solid #ddd",
                          }}
                        >
                          {selectedWorkSpace?.id === data?.id ? (
                            <IoChevronUpCircleSharp
                              onClick={() => setSelectedWorkSpace("")}
                              style={{
                                cursor: "pointer",
                                fontSize: "22px",
                                color: "#0062ff",
                                fontWeight: "600",
                              }}
                            />
                          ) : (
                            <IoChevronDownCircleOutline
                              onClick={() => setSelectedWorkSpace(data)}
                              style={{
                                cursor: "pointer",
                                fontSize: "22px",
                                color: "#0062ff",
                                fontWeight: "600",
                              }}
                            />
                          )}
                        </td>
                      </tr>
                      {data?.id === selectedWorkSpace?.id ? (
                        <tr>
                          <td
                            colspan="9"
                            style={{
                              border: "1px solid #ddd",
                            }}
                          >
                            <div className="cf_workspace_summary">
                              <div style={{ color: "#000", fontWeight: "600" }}>
                                Total Files/Folders :{" "}
                                {workSpaceInfoCount?.totalFiles +
                                workSpaceInfoCount?.totalFolders
                                  ? workSpaceInfoCount?.totalFiles +
                                    workSpaceInfoCount?.totalFolders
                                  : 0}
                              </div>
                              <div
                                style={{ color: "#00C64F", fontWeight: "600" }}
                              >
                                Processed Files/Folders :{" "}
                                {workSpaceInfoCount?.processedCount
                                  ? workSpaceInfoCount?.processedCount
                                  : 0}
                              </div>
                              <div
                                style={{ color: "#FF4C4C", fontWeight: "600" }}
                              >
                                Conflict Files/Folders :{" "}
                                {workSpaceInfoCount?.conflictCount
                                  ? workSpaceInfoCount?.conflictCount
                                  : 0}
                              </div>
                            </div>
                            <div
                              style={{
                                width: "85%",
                                marginLeft: "10%",
                                marginTop: "3%",
                              }}
                            >
                              <table className="cf_table_common">
                                <thead
                                  className="cf_table_common_header_inside"
                                  style={{
                                    background: "#f2f3ff !important",
                                    color: "#000 !important",
                                  }}
                                >
                                  <tr style={{ background: "#f2f3ff" }}>
                                    <th
                                      style={{
                                        width: "25%",
                                        padding: "5px 10px",
                                      }}
                                    >
                                      File-Name
                                    </th>
                                    <th
                                      style={{
                                        width: "15%",
                                        padding: "5px 10px",
                                      }}
                                    >
                                      Status
                                    </th>
                                    <th
                                      style={{
                                        width: "12%",
                                        padding: "5px 10px",
                                      }}
                                    >
                                      Size
                                    </th>
                                    <th
                                      style={{
                                        width: "10%",
                                        padding: "5px 10px",
                                      }}
                                    >
                                      Date
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {isLoading ? (
                                    <tr>
                                      <td
                                        colSpan="4"
                                        style={{
                                          borderRight: "1px solid #ddd",
                                          borderLeft: "1px solid #ddd",
                                          padding: "5px 10px",
                                        }}
                                      >
                                        {getCFTextLoader()}
                                      </td>
                                    </tr>
                                  ) : (
                                    ""
                                  )}
                                  {workSpaceFileFolderList?.map((data) => {
                                    return (
                                      <tr key={data?.id}>
                                        <td
                                          style={{
                                            borderLeft: "1px solid #ddd",
                                            padding: "5px 10px",
                                          }}
                                        >
                                          <div
                                            className="CF_d-flex ai-center"
                                            style={{ gap: "10px" }}
                                          >
                                            <div
                                              style={{
                                                width: "15px",
                                                height: "15px",
                                              }}
                                            >
                                              <img
                                                src={
                                                  new URL(
                                                    `../../../../assets/images/fileTypes/${getFileIcons(
                                                      data?.destObjectName
                                                    )}`,
                                                    import.meta.url
                                                  ).href
                                                }
                                                alt={data?.destObjectName}
                                              />
                                            </div>
                                            {getMaxChar(
                                              data?.destObjectName,
                                              60
                                            )}
                                          </div>
                                        </td>
                                        <td
                                          style={{
                                            padding: "5px 10px",
                                          }}
                                          className={`cf_status_td ${data?.processStatus}`}
                                        >
                                          {getCloudName(data?.processStatus)}
                                        </td>
                                        <td
                                          style={{
                                            padding: "5px 10px",
                                          }}
                                        >
                                          {getSizeFormatted(data?.fileSize)}{" "}
                                        </td>
                                        <td
                                          style={{
                                            padding: "5px 10px",
                                            borderRight: "1px solid #ddd",
                                          }}
                                        >
                                          {getDateFormatted(data?.createdTime)}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>

                              <div
                                style={{
                                  width: "100%",
                                  height: "50px",
                                  display: "flex",
                                  marginTop: "2%",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <ButtonPagination
                                  totalPages={
                                    workSpaceInfoCount?.totalFiles +
                                    workSpaceInfoCount?.totalFolders
                                  }
                                  setCurrentPage={setCurrentPage}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        ""
                      )}
                    </>
                  );
                })}
              </>
            </tbody>
          </table>
        </td>
      </tr>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default ContentWorkSpaces;
