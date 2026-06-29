import React, { useEffect, useState } from "react";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import { BsDownload } from "react-icons/bs";
import {
  IoChevronDownCircleOutline,
  IoChevronUpCircleSharp,
} from "react-icons/io5";
import {
  downloadGlobalZIP,
  getDateFormatted,
  getMaxChar,
  getSizeFormatted,
  notifyToast,
} from "../../../helpers/utils";
import {
  downloadContentJobLevelReport,
  getJobsList,
  getJobsWorkSpacesList,
  getReportsFileFolderAggregates,
} from "../../Migrations/Content/ContentActions/ContentActions";
import { getCloudName } from "../../../helpers/helpers";
import { IoMdRefresh } from "react-icons/io";
import ContentWorkSpaces from "./ContentWorkSpaces";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";

const Contentheports = () => {
  const [lastUpdatedDate, setLastUpdatedDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [jobsList, setJobsList] = useState([]);
  const [selectedJob, setSelectedJob] = useState({});
  const [workSpacesList, setWorkSpacesList] = useState([]);
  useEffect(() => {
    fileFolderAgg();
    getJobs();
  }, []);

  const fileFolderAgg = async () => {
    let res = await getReportsFileFolderAggregates();
    if (res?.status === "OK") {
      if (res?.res?.includes("Error getting")) {
        notifyToast("error", res?.res);
        // Error getting filefolder aggregation info: Failed to get filefolder aggregation info
      } else {
      }
    }
  };

  const getJobs = async () => {
    setIsPageLoading(true);
    let res = await getJobsList(1, 50);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (!res?.res?.includes("Error retrieving move job details")) {
        setJobsList(res?.res);
      }
    } else {
      setIsPageLoading(false);
    }
    setLastUpdatedDate(`Updated ${new Date().toLocaleString()}`);
  };

  useEffect(() => {
    if (selectedJob?.id) {
      setWorkSpacesList();
      getJobWorkSpaces();
    }
  }, [selectedJob]);

  const getJobWorkSpaces = async () => {
    setIsPageLoading(true);
    setIsLoading(true);
    let res = await getJobsWorkSpacesList(selectedJob?.id, 1, 50);
    if (res?.status === "OK") {
      setWorkSpacesList(res?.res);
      setIsLoading(false);
      setIsPageLoading(false);
    } else {
      setIsLoading(false);
      setIsPageLoading(false);
    }
  };

  const refreshJobs = () => {
    setSelectedJob({});
    getJobs();
  };

  const downloadJobLevelReport = async (jobId) => {
    try {
      setIsPageLoading(true);
      let res = await downloadContentJobLevelReport(jobId);
      let blob = await res.blob();

      if (blob.size > 0) {
        downloadGlobalZIP(blob, "Content_Migration_Report");
      } else {
        notifyToast(
          "success",
          "Report is in Progress,will be ready in few minutes"
        );
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsPageLoading(false);
    }
  };

  return (
    <>
      <div className="cf_reports_content_container">
        <div className="cf_reports_migrations_info">
          <div className="cf_reports_migrations_info_title">
            <span>{lastUpdatedDate}</span>
          </div>
          <div className="cf_reports_migrations_info_body">
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Total Migrations
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>{jobsList?.length}</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Processed Migrations
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>0</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Processed File/Folders
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>0</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Processed Data Size
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>---</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Processed Versions
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>0</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Processed Versions Size
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>---</p>
              </div>
            </div>
          </div>
        </div>
        <div className="cf_reports_table_actions">
          <div onClick={() => refreshJobs()}>
            <IoMdRefresh />
          </div>
        </div>
        <div className="cf_reports_tableDiv" style={{ height: "fit-content" }}>
          <table className="cf_table_common">
            <thead className="cf_table_common_header">
              <tr style={{ background: "#0062ff" }}>
                <th style={{ width: "18%" }}>Job name</th>
                <th style={{ width: "10%" }}>Job type</th>
                <th style={{ width: "12%" }}>Status</th>
                <th style={{ width: "15%" }}>Total Data Migrated</th>
                <th style={{ width: "15%" }}>Total Pairs Migrated</th>
                <th style={{ width: "12%" }}>Processed on</th>
                <th style={{ width: "8%" }}>Download</th>
                <th style={{ width: "5%" }}>Delta</th>
                <th style={{ width: "3%" }}></th>
              </tr>
            </thead>
            <tbody>
              {jobsList?.map((data) => {
                return (
                  <>
                    <tr key={data?.id}>
                      <td
                        title={data?.jobName}
                        style={{ borderLeft: "1px solid #ddd" }}
                      >
                        {getMaxChar(data?.jobName, 28)}
                      </td>
                      <td>{data?.jobType}</td>
                      <td className={`cf_status_td ${data?.jobStatus}`}>
                        {getCloudName(data?.jobStatus)}
                      </td>
                      <td>
                        <div
                          className="CF_d-flex CF_flex-d-column"
                          style={{ gap: "5px" }}
                        >
                          <progress
                            value={data?.processedData}
                            max={data?.totalData}
                          ></progress>
                          <span>
                            {getSizeFormatted(data?.processedData)} migrated of{" "}
                            {getSizeFormatted(data?.totalData)}{" "}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div
                          className="CF_d-flex CF_flex-d-column"
                          style={{ gap: "5px" }}
                        >
                          <progress
                            value={data?.completedPairsCount}
                            max={data?.totalPairsCount}
                          ></progress>
                          <span>
                            {data?.completedPairsCount} pairs migrated of{" "}
                            {data?.totalPairsCount} pairs{" "}
                          </span>
                        </div>
                      </td>
                      <td>{getDateFormatted(data?.createdTime)}</td>
                      <td>
                        <BsDownload
                          className="CF_Pointer"
                          style={{ fontSize: "18px", color: "#0062ff" }}
                          onClick={() => downloadJobLevelReport(data?.id)}
                        />
                      </td>
                      <td>
                        <ButtonComponent
                          isLoading={false}
                          isDisabled={!data?.jobStatus !== "COMPLETED"}
                          inputWidth="90px"
                          buttonName="Initiate Delta"
                          customstyles={{
                            fontSize: "12px",
                            height: "35px",
                            background: "#1220F6",
                          }}
                          buttonClickAction={() => console.log("SERVER_USAGE")}
                        />
                      </td>
                      <td style={{ borderRight: "1px solid #ddd" }}>
                        {selectedJob?.id === data?.id ? (
                          <IoChevronUpCircleSharp
                            onClick={() => setSelectedJob("")}
                            style={{
                              cursor: "pointer",
                              fontSize: "22px",
                              color: "#0062ff",
                              fontWeight: "600",
                            }}
                          />
                        ) : (
                          <IoChevronDownCircleOutline
                            onClick={() => setSelectedJob(data)}
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
                    {selectedJob?.id === data?.id ? (
                      <>
                        <ContentWorkSpaces
                          key={`ws_${data?.id}`}
                          workSpacesList={workSpacesList}
                          isLoading={isLoading}
                        />
                        {/* {isLoading ? getCFTextLoader() : ""} */}
                      </>
                    ) : (
                      ""
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default Contentheports;
