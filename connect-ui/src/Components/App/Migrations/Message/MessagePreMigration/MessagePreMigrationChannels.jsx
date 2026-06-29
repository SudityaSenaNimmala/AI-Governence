import React, { useEffect, useRef, useState } from "react";
import { getPreMigrationChannels } from "../MessageActions/MessageActions";
import {
  downloadGlobalCSV,
  getMaxChar,
  getSizeFormatted,
  jsonToCSV,
  notifyToast,
  tableToCSV,
} from "../../../../helpers/utils";
import {
  getCloudName,
  getMembersCountInDMs,
} from "../../../../helpers/helpers";
import { Download, Hash, Lock } from "lucide-react";

const MessagePreMigrationChannels = (props) => {
  const tableRef = useRef(null);
  let { channelInfo, preMigrationId, channelType, dmInfo } = { ...props };
  const [channelsList, setChannelsList] = useState([]);

  useEffect(() => {
    props.setIspageLoading(true);
    getChannelsList();
  }, []);

  const getChannelsList = async (pageNo = 1, pageSize = 50) => {
    let check = document.getElementById("viewPreMigrationPublic");

    if (!check) {
      return false;
    }

    if (pageNo !== 1) {
      props.setIspageLoading(false);
    }
    try {
      let res = await getPreMigrationChannels(pageNo, pageSize, preMigrationId);
      if (res?.status === "OK") {
        if (res?.res?.length > 0) {
          setChannelsList((prevChannels) => [...prevChannels, ...res?.res]);
        }
        if (res?.res?.length >= pageSize) {
          getChannelsList(pageNo + 1, pageSize);
        }
      } else {
        throw new Error("Failed Getting Users List");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      props.setIspageLoading(false);
    }
  };

  return (
    <>
      <div className="cf_reports_content_container">
        <div className="cf_userMenu_action_pannel" style={{ gap: "30px" }}>
          <div className="cf_userMenu_action_pannel" style={{ gap: "15px" }}>
            <div className="cf_slackReportsBreadCrumbs">
              <div className="cf_slackReportsBreadCrumbs_actions">
                <span
                  id="viewPreMigrationPublic"
                  className="cf_reports_breadCrumbs_cta cf_make_link_reports"
                  onClick={() => props?.resetView("SUMMARY")}
                >
                  Summary
                </span>
                <span className="cf_reports_breadCrumbs_cta">
                  {" "}
                  {">"}{" "}
                  {channelType === "CHANNELS"
                    ? "Public Channels"
                    : "Direct Messages"}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div
          className="cf_reports_tableDiv"
          style={{ height: "calc(100% - 100px)" }}
        >
          <table className="cf_table_common" ref={tableRef}>
            <thead
              className="cf_table_common_header cf_messageReports_table_header"
              style={{ backgroundColor: "transparent", color: "#454545" }}
            >
              <tr>
                <th style={{ width: "15%" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Name</span>
                  </div>
                </th>
                <th>Total Messages</th>
                <th>Total Replies</th>
                <th>Members</th>
                {channelType === "CHANNELS" ? <th>In-Active Users</th> : ""}
                <th>Total Files</th>
                <th>Total Data Size</th>
                <th>
                  <div className="CF_d-flex ai-center">
                    <span>Status</span>
                    <Download
                      size={14}
                      style={{ marginLeft: "auto" }}
                      color="#0062ff"
                      className="CF_Pointer"
                      onClick={() =>
                        downloadGlobalCSV(
                          tableToCSV(tableRef),
                          `${channelType}_PRE_MIGRATION_REPORT`
                        )
                      }
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="cf_messageReports_table_tbody">
              {channelsList?.map((data, index) => {
                return (
                  <tr key={`${data?.id}_${data?.channelName}_${index}`}>
                    <td
                      title={
                        channelType === "CHANNELS"
                          ? data?.channelName
                          : data.channelName.split("mpdm-")[1]?.length > 0
                          ? data.channelName.split("mpdm-")[1].split("-1")[0]
                          : data.channelName
                      }
                    >
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "8px" }}
                      >
                        {channelType === "CHANNELS" ? (
                          data?.publicChannel ? (
                            <Hash size={12} />
                          ) : (
                            <Lock size={12} />
                          )
                        ) : (
                          ""
                        )}
                        <span>
                          {getMaxChar(
                            channelType === "CHANNELS"
                              ? data?.channelName
                              : data.channelName.split("mpdm-")[1]?.length > 0
                              ? data.channelName
                                  .split("mpdm-")[1]
                                  .split("-1")[0]
                              : data.channelName,
                            25
                          )}
                        </span>
                      </div>
                    </td>
                    <td>{data?.totalMessageInChannel}</td>
                    <td>{data?.totalRepliesCount}</td>
                    <td>
                      {channelType === "CHANNELS"
                        ? data?.publicChannel
                          ? data?.totalUsersInPublicChannel
                          : data?.totalUsersInPrivateChannel
                        : getMembersCountInDMs(
                            data?.channelName.split("mpdm-")[1]?.length > 0
                              ? data?.channelName
                                  .split("mpdm-")[1]
                                  .split("-1")[0]
                              : data?.channelName
                          )}
                    </td>
                    {channelType === "CHANNELS" ? (
                      <td>{data?.totalInactiveUsersInCloud}</td>
                    ) : (
                      ""
                    )}
                    <td>{data?.filesCount ? data?.filesCount : "0"}</td>
                    <td>{getSizeFormatted(data?.totalDataSize)}</td>
                    <td className={data?.processStatus}>
                      {getCloudName(data?.processStatus)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div
          className="cf_message_footerVal"
          style={{ gap: "30px", padding: "0 10px" }}
        >
          {channelType === "CHANNELS" ? (
            <>
              <span>Channels : {channelInfo?.totalChannels} </span>
              <span>Public : {channelInfo?.totalPublicChannel} </span>
              <span>Private : {channelInfo?.totalPrivateChannel} </span>
              <span>
                Total Messages : {channelInfo?.totalMessageInChannel}{" "}
              </span>
            </>
          ) : (
            <>
              <span>Direct Messages : {dmInfo?.totalDms} </span>
              <span>Group : {dmInfo?.totalPublicChannel} </span>
              <span>One-One : {dmInfo?.totalPrivateChannel} </span>
              <span>Total Messages : {dmInfo?.totalMessageInChannel} </span>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default MessagePreMigrationChannels;
