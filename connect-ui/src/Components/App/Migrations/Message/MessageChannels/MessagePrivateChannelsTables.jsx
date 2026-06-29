import React, { useContext, useEffect, useState } from "react";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import {
  cloudImageMapper,
  formatDateNew,
  getCloudName,
  getRandomArray,
} from "../../../../helpers/helpers";
import { FaHashtag, FaLock } from "react-icons/fa6";
import {
  getPaginationCounts,
  getSlackChannels,
} from "../MessageActions/MessageActions";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { getMaxChar } from "../../../../helpers/utils";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";

const MessagePrivateChannelsTables = (props) => {
  const { globalContext } = useContext(GlobalContext);
  const [isLoading, setIsLoading] = useState(true);
  const [channelsList, setChannelsList] = useState([]);
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [paginationCount, setPaginationCount] = useState({});
  useEffect(() => {
    if (props?.currentTab) {
      setPagination({
        pageSize: 50,
        totalPages: 1,
        currentPage: 1,
        totalDocuments: 0,
      });
      setPaginationCount({});
      setChannelsList([]);
      fetchChannels();
      fetchPaginationCount();
    }
  }, [props?.currentTab]);

  const fetchChannels = async () => {
    setIsLoading(true);
    let channels = await getSlackChannels(
      pagination?.currentPage,
      pagination?.pageSize,
      "private"
    );
    if (channels?.status === "OK") {
      setChannelsList([]);
      setIsLoading(false);
      setChannelsList(channels?.res);
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let count = paginationCount?.privateChannelCount;
    setPagination({
      currentPage: 1,
      pageSize: 50,
      totalPages: Math.ceil(count / 50),
      totalDocuments: count,
    });
  }, [paginationCount]);

  const fetchPaginationCount = async () => {
    let paginationCount = await getPaginationCounts();
    if (paginationCount.status === "OK") {
      setIsLoading(false);
      setPaginationCount(paginationCount.res);
    } else {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = paginationCount?.privateChannelCount;
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
    }
  };

  useEffect(() => {
    fetchChannels();
  }, [pagination]);

  return (
    <>
      <div className="cf_userMenu_action_pannel">
        <SearchComponent
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          inputPlaceHolder={`Search By Slack Channel Name`}
          onInputSearch={(e) => console.log(e?.searchInput)}
        />
      </div>
      <div className="cf_message_user_mapping">
        <table className="cf_message_table">
          <thead>
            <tr>
              <th style={{ width: "1%", padding: "10px" }}>
                <div className="CF_d-flex ai-center">
                  <input type="checkbox" />
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
                    <span className="cf_mapping_email" title="alex@filefuze.co">
                      Channel Name
                    </span>
                  </div>
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
                    <span className="cf_mapping_email" title="alex@filefuze.co">
                      Destination Team Name
                    </span>
                  </div>
                </div>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">
                  Destination Channel Name
                </span>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">Channel Date</span>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">Manager Availability</span>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">Migration Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {channelsList?.map((data) => {
              return (
                <tr key={data?.id}>
                  <td style={{ width: "1%", padding: "10px" }}>
                    <div className="CF_d-flex ai-center">
                      <input type="checkbox" />
                    </div>
                  </td>
                  <td style={{ width: "15%" }}>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
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
                  <td style={{ width: "15%" }}>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                      <div
                        className="CF_d-flex CF_flex-d-column"
                        style={{ width: "100%" }}
                      >
                        <span
                          className="cf_mapping_email"
                          title={data?.destTeamName ?? data?.channelName}
                        >
                          {getMaxChar(
                            data?.destTeamName ?? data?.channelName,
                            30
                          )}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td style={{ width: "10%" }}>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                      <div
                        className="CF_d-flex CF_flex-d-column"
                        style={{ width: "100%" }}
                      >
                        <span
                          className="cf_mapping_email"
                          title={data?.destChannelName ?? data?.channelName}
                        >
                          {getMaxChar(
                            data?.destChannelName ?? data?.channelName,
                            40
                          )}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td style={{ width: "10%" }}>
                    <span className="cf_mapping_email">
                      {formatDateNew(data?.channelDate)}
                    </span>
                  </td>
                  <td style={{ width: "10%" }}>
                    <span className="cf_mapping_email">
                      {data?.managerAvailable ? "Available" : "Not Available"}
                    </span>
                  </td>
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
      </div>
      <div className="cf_message_footerVal">
        <span>Total Channels : {pagination?.totalDocuments} </span>
        <span className="cf_ml_auto"></span>
        <span style={{ opacity: "0.5" }}>
          Showing {pagination?.currentPage} of {pagination?.totalPages ?? 1}{" "}
          Page
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
              return <option value={data}>{data}</option>;
            })}
          </select>
        </span>
      </div>
      {isLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessagePrivateChannelsTables;
