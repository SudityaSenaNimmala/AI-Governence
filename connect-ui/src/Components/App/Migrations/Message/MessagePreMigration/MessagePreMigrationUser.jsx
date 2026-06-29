import React, { useEffect, useRef, useState } from "react";
import { runUserPreMigration } from "../MessageActions/MessageActions";
import {
  downloadGlobalCSV,
  notifyToast,
  tableToCSV,
} from "../../../../helpers/utils";
import { getCloudName, getRandomArray } from "../../../../helpers/helpers";
import { Download } from "lucide-react";

const MessagePreMigrationUser = (props) => {
  let { userInfo } = { ...props };
  const tableRef = useRef(null);
  const [usersList, setUsersList] = useState([]);
  const [pagination, setPagination] = useState({
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });

  useEffect(() => {
    props.setIspageLoading(true);
    getUsersList();
  }, []);

  useEffect(() => {
    if (userInfo && userInfo["Total Users"]) {
      setPagination((prev) => ({
        ...prev,
        totalDocuments: userInfo["Total Users"],
        totalPages: Math.ceil(userInfo["Total Users"] / prev.pageSize),
      }));
    }
  }, [userInfo]);

  const getUsersList = async (
    pageNo = pagination.currentPage,
    pageSize = pagination.pageSize
  ) => {
    try {
      props.setIspageLoading(true);
      let res = await runUserPreMigration(pageNo, pageSize, false);
      if (res?.status === "OK") {
        setUsersList(res?.res);
      } else {
        throw new Error("Failed Getting Users List");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      props.setIspageLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      getUsersList(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      getUsersList(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
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
                  className="cf_reports_breadCrumbs_cta cf_make_link_reports"
                  onClick={() => props?.resetView("SUMMARY")}
                >
                  Summary
                </span>
                <span className="cf_reports_breadCrumbs_cta"> {">"} Users</span>
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
                <th style={{ width: "55%" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>User Email</span>
                  </div>
                </th>
                <th>
                  <div className="CF_d-flex ai-center">
                    <span>User Status</span>
                    <Download
                      size={14}
                      style={{ marginLeft: "auto" }}
                      color="#0062ff"
                      className="CF_Pointer"
                      onClick={() =>
                        downloadGlobalCSV(
                          tableToCSV(tableRef),
                          `USERS_PRE_MIGRATION_REPORT`
                        )
                      }
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="cf_messageReports_table_tbody">
              {usersList?.map((data) => {
                return (
                  <tr key={data?.emailId}>
                    <td key={data?.emailId}>{data?.emailId}</td>
                    <td>{getCloudName(data?.billingStatus)}</td>
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
          <span>Total Users : {userInfo["Total Users"]} </span>
          <span>Active Users : {userInfo["Active Users"]} </span>
          <span>In-Active Users : {userInfo["Inactive Users"]} </span>
          <span>
            Deactivated Users Users : {userInfo["Deactivated Users"]}{" "}
          </span>
        </div>

        {/* Pagination Section */}

        <div className="cf_new_tables_footer">
          <span>Total: {pagination?.totalDocuments} </span>
          <span style={{ marginLeft: "auto" }}></span>
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
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="300">300</option>
              <option value="400">400</option>
              <option value="500">500</option>
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
      </div>
    </>
  );
};

export default MessagePreMigrationUser;
