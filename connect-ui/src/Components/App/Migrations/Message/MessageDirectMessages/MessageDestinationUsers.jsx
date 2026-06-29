import React, { useContext, useEffect, useState } from "react";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import { cloudImageMapper, getRandomArray } from "../../../../helpers/helpers";
import { BiFilterAlt } from "react-icons/bi";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  getProvisionMapping,
  getUsersPaginationCount,
} from "../MessageActions/MessageActions";
import { getSelectedDestinationCloudId } from "../../../../helpers/utils";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";

const MessageDestinationUsers = () => {
  const { globalContext } = useContext(GlobalContext);
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [sourceUsersList, setSourceUsersList] = useState([]);
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [paginationCount, setPaginationCount] = useState({});

  useEffect(() => {
    fetchPaginationCount();
    // fetchSourceUserList();
  }, []);

  const fetchSourceUserList = async () => {
    setIsPageLoading(true);
    let res = await getProvisionMapping(
      getSelectedDestinationCloudId(),
      pagination?.currentPage,
      pagination?.pageSize
    );
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.res !== "No Provision User Found") {
        setSourceUsersList(res?.res);
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const fetchPaginationCount = async () => {
    let pagination = await getUsersPaginationCount();
    if (pagination.status === "OK") {
      setIsPageLoading(false);
      setPaginationCount(pagination.res);
    } else {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    let count = paginationCount?.totalTeamsCount;
    setPagination({
      currentPage: 1,
      pageSize: 50,
      totalPages: Math.ceil(count / 50),
      totalDocuments: count,
    });
  }, [paginationCount]);

  useEffect(() => {
    if (pagination?.totalDocuments) {
      fetchSourceUserList();
    }
  }, [pagination]);

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = paginationCount?.totalTeamsCount;
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

  return (
    <>
      <div className="cf_userMenu_action_pannel">
        <SearchComponent
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          inputPlaceHolder={`Search By User Email`}
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
              <th style={{ width: "45%" }}>
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
                  <div className="CF_d-flex" style={{ width: "100%" }}>
                    <span
                      style={{ gap: "10px" }}
                      className="CF_d-flex cf_mapping_email"
                      title="alex@filefuze.co"
                    >
                      Destination Users
                      <span className="CF_Pointer CF_d-flex ai-center">
                        <BiFilterAlt className="fw-600" />
                      </span>
                    </span>
                  </div>
                </div>
              </th>
              <th style={{ width: "20%" }}>
                <span className="cf_mapping_email">Email Status</span>
              </th>
              <th style={{ width: "20%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                  <span
                    className="CF_d-flex cf_mapping_email"
                    style={{ gap: "10px" }}
                  >
                    Authenticated Status
                    <span className="CF_Pointer CF_d-flex ai-center">
                      <BiFilterAlt />
                    </span>
                  </span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sourceUsersList?.map((data) => {
              return (
                <tr key={data?.id}>
                  <td style={{ width: "1%", padding: "10px" }}>
                    <div className="CF_d-flex ai-center">
                      <input type="checkbox" />
                    </div>
                  </td>
                  <td>
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
                          title={data?.emailId}
                        >
                          {data?.emailId}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div
                      className="CF_d-flex CF_flex-d-column"
                      style={{ width: "100%" }}
                    >
                      <span className="cf_mapping_email">
                        {getSelectedDestinationCloudId() === data?.cloudId
                          ? "-"
                          : data?.emailSent && data?.emailStatus === null
                          ? "Email Processing"
                          : data?.emailSent
                          ? data?.emailStatus
                          : "Email Not Sent"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="cf_mapping_email">
                      {data?.provisioned
                        ? "Authenticated"
                        : "Not Authenticated"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cf_message_footerVal">
        <span>Total Users : {pagination?.totalDocuments} </span>
        <span>Authenticated : {paginationCount?.teamsProvisionedCount} </span>
        <span>
          Not Authenticated Users :{" "}
          {paginationCount?.totalTeamsCount -
            paginationCount?.slackProvisionedCount}{" "}
        </span>
        <span>Email Sent : {paginationCount?.teamsEmailSentCount} </span>
        <span className="cf_ml_auto"></span>
        <span style={{ fontWeight: "400" }}>
          Last Synced 0 Users On 07/06/2024, 16:32:26
        </span>
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
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageDestinationUsers;
