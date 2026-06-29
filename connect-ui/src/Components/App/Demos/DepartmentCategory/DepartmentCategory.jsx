import React, { useContext, useEffect, useState } from "react";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import { useSearchParams } from "react-router-dom";
import { getUsersByDepartment } from "../../UserManagement/UserManagementActions/UserManagementActions";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import { getRandomArray } from "../../../helpers/helpers";
import DepartmentUsersApplications from "./DepartmentUsersApplications";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";

const DepartmentCategory = () => {
  const [searchParams] = useSearchParams();
  const { globalContext } = useContext(GlobalContext);
  const { sourceCloud } = globalContext;
  const filterType = searchParams.get("type");
  const usersCount = searchParams.get("usersCount");
  const [usersList, setUsersList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewUsersApplications, setViewUsersApplications] = useState(null);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalUsers: 0,
    pageSize: 100,
    totalPages: 0,
  });
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    if (filterType && usersCount) {
      setPagination({
        ...pagination,
        totalUsers: +usersCount,
        totalPages: Math.ceil(+usersCount / pagination?.pageSize),
      });

      fetchUsersList();
    }
  }, []);

  const fetchUsersList = async (pageNo = pagination?.currentPage, pageSize = pagination?.pageSize) => {
    setIsLoading(true);
    let primaryApp = globalContext?.cloudsList?.find((data) => data?.primaryApp);
    let listOfDepts = [...sourceCloud[filterType] || [], filterType];
    let res = await getUsersByDepartment(primaryApp?.id, listOfDepts, pageNo, pageSize);
    if (res?.status === "OK") {
      setUsersList(res?.res);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }

  const handlePagination = (e) => {
    let value = e?.target?.value;
    if (value === "currentPage") {
      setPagination({ ...pagination, currentPage: e?.target?.value });
      fetchUsersList(e?.target?.value, pagination?.pageSize);
    } else {
      setPagination({ ...pagination, pageSize: e?.target?.value, totalPages: Math.ceil(pagination?.totalUsers / e?.target?.value) });
      fetchUsersList(1, e?.target?.value);
    }

  }


  return (
    <>
      <div className="cf_main_container" style={{ overflow: "hidden" }}>
        <SideNav activeTab="Dashboard" />
        <div className="cf_main_content_place">
          <TopNav pageName={`${filterType} Department Users`} backLink="/Dashboard" />

          <div
            className="cf_main_content_place_main"
            style={{
              padding: "10px 0",
              flexDirection: "column",
              gap: "15px",
              height: "calc(100vh - 0px)",
              overflow: "hidden",
            }}
          >
            <div className="cf_saas_options">
              <SearchComponent
                autoOpen={true}
                boxShadows={true}
                inputName="searchInput"
                inputPlaceHolder={`Search By Email or Department`}
                onInputSearch={(e) => setSearchInput(e?.searchInput)}
              />
            </div>
            <div
              className="cf_licenses_container_table"
              style={{ height: "calc(100% - 100px)", overflow: "auto" }}
            >

              <table className="cf_licenses_table">
                <thead>
                  <tr>
                    <th style={{ width: "15%", textAlign: "left" }}>Email</th>
                    <th style={{ width: "15%", textAlign: "left" }}>Department</th>
                  </tr>
                </thead>
                <tbody>
                  {
                    usersList?.sort((a, b) => a?.departmentName?.localeCompare(b?.departmentName))?.filter((data) => data?.email?.toLowerCase().includes(searchInput?.toLowerCase()) || data?.departmentName?.toLowerCase().includes(searchInput?.toLowerCase()))?.map((data) => {
                      return (
                        <tr key={data?.id}>
                          <td
                            class="cf_new_table_hide_text"
                          >
                            <span className="cf_mapping_email cf_make_link" onClick={() => setViewUsersApplications(data?.email || data?.emailId)}>
                              {data?.email || data?.emailId}
                            </span>
                          </td>
                          <td class="cf_new_table_hide_text">
                            <span className="cf_mapping_email cf_make_link" onClick={() => setViewUsersApplications(data?.email || data?.emailId)}>
                              {data?.departmentName ?? "-"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
              {isLoading ? getCFTextLoader() : ""}
            </div>
            <div className="cf_new_tables_footer">
              <span>Total Users: {pagination?.totalUsers} </span>
              <>
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
              </>
            </div>
          </div>
        </div>
      </div>
      {viewUsersApplications ?
        <DepartmentUsersApplications userEmail={viewUsersApplications} isVisible={true} setIsVisible={setViewUsersApplications} />
        : ""}
    </>
  )

}

export default DepartmentCategory;