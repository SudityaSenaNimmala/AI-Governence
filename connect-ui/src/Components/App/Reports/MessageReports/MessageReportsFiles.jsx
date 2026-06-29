import React, { useEffect, useState } from "react";
import { getCloudName, getFileIconsNew } from "../../../helpers/helpers";
import { getMaxChar, getSizeFormatted } from "../../../helpers/utils";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import { getChannelFiles } from "../../Migrations/Message/MessageActions/MessageActions";

const MessageReportsFiles = (props) => {
  const { refreshJobWorkspaces } = props;
  const [isLoading, setIsLoading] = useState(true);
  const [filesList, setFilesList] = useState([]);

  useEffect(() => {
    fetchJobWorkSpaces();
  }, [props?.workspacesId]);

  const fetchJobWorkSpaces = async (pageNo = 1, pageSize = 50) => {
    setIsLoading(true);
    let res = await getChannelFiles(pageNo, pageSize, props?.workspacesId);
    if (res?.status === "OK") {
      setFilesList(res?.res);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const refreshWorkSpaces = () => {
    fetchJobWorkSpaces();
  };

  useEffect(() => {
    if (props?.updateReports?.split("|")[0] === "FILES") {
      refreshWorkSpaces();
    }
  }, [props?.updateReports]);

  return (
    <>
      <div className="cf_userMenu_action_pannel" style={{ gap: "15px" }}>
        <div className="cf_slackReportsBreadCrumbs">
          <div className="cf_slackReportsBreadCrumbs_actions">
            <span
              className="cf_reports_breadCrumbs_cta cf_make_link_reports"
              onClick={() => {
                props?.changeCurrentView("JOBS");
                props?.changeCurrentJobId("");
              }}
            >
              Teams
            </span>
            <span
              className="cf_reports_breadCrumbs_cta cf_make_link_reports"
              onClick={() => {
                props?.changeCurrentView("WORKSPACES");
              }}
            >
              {" "}
              {">"} Channels
            </span>
            <span className="cf_reports_breadCrumbs_cta"> {">"} Files</span>
          </div>
        </div>
      </div>
      <div className="cf_reports_tableDiv">
        <table className="cf_table_common">
          <thead
            className="cf_table_common_header cf_messageReports_table_header"
            style={{ backgroundColor: "transparent", color: "#454545" }}
          >
            <tr>
              <th style={{ width: "55%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <span>File Name</span>
                </div>
              </th>
              <th>Size</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody className="cf_messageReports_table_tbody">
            {filesList?.map((data) => {
              return (
                <tr>
                  <td>
                    <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
                      <img
                        src={getFileIconsNew(data?.objectName)}
                        style={{ width: "15px" }}
                      />
                      <span>{getMaxChar(data?.objectName, 50)}</span>
                    </div>
                  </td>
                  <td>{getSizeFormatted(data?.size)}</td>
                  <td className={data?.processStatus}>
                    {getCloudName(data?.processStatus)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageReportsFiles;
