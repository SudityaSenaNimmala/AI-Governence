import React, { useContext, useEffect, useRef, useState } from "react";
import {
  cloudImageMapper,
  getCloudName,
  getRandomArray,
} from "../../../helpers/helpers";
import {
  downloadGlobalCSV,
  getMaxChar,
  makeDataForCalender,
  notifyToast,
} from "../../../helpers/utils";
import CustomToolTip from "../../../Resuables/CustomToolTip/CustomToolTip";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import {
  getDownloadSaaSReport,
  getDownloadStatus,
  getVendorSearch,
} from "../../SaaSManagement/SaaSActions/SaaSActions";
import {
  getSaaSCostingWithAppList,
  getUniqueUsersList,
} from "../DashboardActions/DashboardActions";
import { BiFilterAlt } from "react-icons/bi";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";

const UsersList = () => {
  const [downloadStatus, setDownloadStatus] = useState({});
  const [isPageLoading, setIsPageLoading] = useState(false);
  const { globalContext } = useContext(GlobalContext);
  const [activeCloudFilter, setActiveCloudFilter] = useState("");
  const [filters, setFilters] = useState({ key: "ALL", value: "All" });
  const [isLoading, setIsLoading] = useState(true);
  const [usersList, setUsersList] = useState([]);
  const [pagination, setPagination] = useState({
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });

  useEffect(() => {
    // fetchSaaSCosting();
    fetchUniqueUsersList();
    // getCSVStatus();
    // fetchSaaSUsersList();
  }, [filters]);

  // const fetchSaaSCosting = async () => {
  //   let res = await getSaaSCostingWithAppList();
  //   if (res?.status === "OK") {
  //     setPagination({
  //       totalDocuments: res?.res?.totalUniqueUserCount,
  //       currentPage: 1,
  //       pageSize: 100,
  //       totalPages: Math.ceil(res?.res?.totalUniqueUserCount / 100),
  //     });
  //   }
  // };

  const fetchUniqueUsersList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    cloudName = filters?.key
  ) => {
    setUsersList([]);
    setIsLoading(true);
    let res = await getUniqueUsersList(pageNo, pageSize, cloudName);
    if (res?.status === "OK") {
      setIsLoading(false);
      setUsersList(res?.res?.data);
      if (pageNo === 1) {
        setPagination({
          totalDocuments: res?.res?.totalDocuments,
          currentPage: 1,
          pageSize: pageSize,
          totalPages: Math.ceil(res?.res?.totalDocuments / pageSize),
        });
      }
    } else {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchUniqueUsersList(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchUniqueUsersList(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const searchDebounce = useRef(null);
  const searchUsersList = async (e) => {
    setActiveCloudFilter(e);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        searchUsers(e);
      }, 500);
    } else {
      fetchUniqueUsersList();
    }
  };

  const searchUsers = async (searchValue) => {
    setIsPageLoading(true);
    let res = await getVendorSearch(
      "UNIQUUSERSSEARCH",
      "unqusers",
      searchValue?.trim(),
      false,
      filters?.key
    );
    if (res?.status === "OK") {
      if (res?.res !== "No Data Found") {
        setIsPageLoading(false);
        setUsersList(res?.res?.data);
        setPagination({
          totalDocuments: res?.res?.totalDocuments,
          currentPage: 1,
          pageSize: 100,
          totalPages: Math.ceil(res?.res?.totalDocuments / 100),
        });
      } else {
        setIsPageLoading(false);
        notifyToast("error", res?.res);
      }
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
    }
  };

  const getCSVStatus = async () => {
    setIsPageLoading(true);
    let res = await getDownloadStatus("UNIQUUSERSSEARCH", "unqusers");
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setDownloadStatus({ ...res?.res });
      if (res?.res?.status === "PROCESSED") {
        downloadSaaSReport("users");
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const downloadSaaSReport = async (action) => {
    setIsPageLoading(true);
    let res = await getDownloadSaaSReport("UNIQUUSERSSEARCH", "unqusers");
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.headers["content-type"] === "text/csv") {
        downloadGlobalCSV(res?.res, `UniqueUsersList`);
        setDownloadStatus({
          ...downloadStatus,
          status: "Downloaded",
        });
      } else {
        setDownloadStatus({
          ...downloadStatus,
          status: "IN_PROGRESS",
        });
      }
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed Downloading CSV");
    }
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Dashboard" />
        <div className="cf_main_content_place">
          <TopNav pageName="Users List" backLink="/Dashboard" />
          <div
            className="cf_saas_options"
            style={{ marginTop: "10px", height: "40px" }}
          >
            <SearchComponent
              autoOpen={true}
              boxShadows={true}
              inputName="searchInput"
              customStyles={{ width: "350px", height: "40px" }}
              customButtonStyles={{
                background: "transparent",
                color: "rgb(255, 255, 255)",
                fontWeight: "bolder",
                height: "35px",
              }}
              inputPlaceHolder={`Search By User Email or Name`}
              onInputSearch={(e) => searchUsersList(e.searchInput)}
            />
            <span style={{ marginLeft: "auto" }}></span>
            {/* <ActionButton
              customClass="CF_d-flex ai-center"
              customStyles={{
                backgroundColor: "#f2f2f2",
                height: "40px",
              }}
              buttonType="button"
              buttonClickAction={() =>
                downloadStatus?.status === "IN_PROGRESS"
                  ? getCSVStatus()
                  : downloadSaaSReport("users")
              }
            >
              {downloadStatus?.status === "IN_PROGRESS" ? (
                <RotateCw size={18} strokeWidth={2} title="Check Status" />
              ) : (
                <FileDown size={18} strokeWidth={2} />
              )}
            </ActionButton> */}
          </div>
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{
              padding: "10px 0 0 0",
              flexDirection: "column",
              height: "calc(100vh - 130px)",
            }}
          >
            <div
              className="cf_new_tables_div"
              style={{ height: "calc(100% - 50px)" }}
            >
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "20%" }}>Email/Name</th>
                    <th style={{ width: "80%" }}>
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "10px" }}
                      >
                        <span
                          className="CF_d-flex cf_mapping_email"
                          style={{ gap: "10px", width: "fit-content" }}
                        >
                          Applications
                        </span>
                        <CustomDropDown
                          isCloudsList={true}
                          customDropDownStyles={{
                            width: "fit-content",
                            left: "-100%",
                          }}
                          defaultVal={filters}
                          dropDownList={[
                            { key: "ALL", value: "All" },
                            ...globalContext?.cloudsList?.reduce(
                              (acc, curr) => {
                                if (
                                  curr?.providerName !== "OTHERS" &&
                                  curr?.providerName
                                ) {
                                  acc.push({
                                    key: curr?.providerName,
                                    value: curr?.providerName,
                                  });
                                }
                                return acc;
                              },
                              []
                            ),
                          ]}
                          selectFilter={(e) => setFilters(e)}
                        >
                          <span className="CF_Pointer CF_d-flex ai-center">
                            <BiFilterAlt />
                          </span>
                        </CustomDropDown>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <>
                      <tr>
                        <td colSpan={2}>{getCFTextLoader()}</td>
                      </tr>
                      <tr style={{ visibility: "hidden" }}>
                        <td className="cf_new_table_hide_text">
                          <p>vimalesh.t_cloudfuze...odclub.onmicrosoft.com</p>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <p>User</p>
                        </td>
                      </tr>
                    </>
                  ) : (
                    usersList?.map((res, index) => (
                      <tr key={res?.email || res?.firstName}>
                        <td className="cf_new_table_hide_text">
                          <CustomToolTip title={res?.email} customWidth={true}>
                            <p>{getMaxChar(res?.email, 40)}</p>
                          </CustomToolTip>
                        </td>
                        {/* //   return <div className={`bg_35-${cloud}`}></div>; */}
                        <td className="cf_new_table_hide_text">
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "8px" }}
                          >
                            {res?.vendorAdminCloudId?.map((cloud) => {
                              return (
                                <div className="cf_cloudImageCloadDiv CF_Pointer">
                                  <CustomToolTip
                                    title={getCloudName(cloud?.split(":")[0])}
                                  >
                                    <div className="cf_cloudImageCloadDiv CF_Pointer">
                                      <img
                                        src={cloudImageMapper(
                                          cloud?.split(":")[0]
                                        )}
                                      />
                                    </div>
                                  </CustomToolTip>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
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
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default UsersList;
