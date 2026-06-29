import moment from "moment";
import React, { useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getRandomArray } from "../../../../helpers/helpers";
import {
  downloadGlobalCSV,
  getMaxChar,
  notifyToast,
} from "../../../../helpers/utils";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../../Resuables/Loaders/Loaders";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import DMSEmailFormat from "../../../Migrations/Message/MessageDirectMessages/DMSEmailFormat";
import {
  getDownloadSaaSReport,
  getDownloadStatus,
  getSaaSGroupsData,
  getSaaSGroupsPagination,
  getVendorSearch,
} from "../../SaaSActions/SaaSActions";

const SaaSTeamsGroupsList = () => {
  const { type } = useParams();
  const [downloadStatus, setDownloadStatus] = useState({});
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [pagination, setPagination] = useState({
    publicCount: 0,
    privateCount: 0,
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const navigate = useNavigate();

  const [activeCloudFilter, setActiveCloudFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [teamsList, setTeamsList] = useState([]);
  const { memberId, providerName } = { ...globalContext?.saasCloud };

  useEffect(() => {
    if (globalContext?.groupsTeamsSummary?.totalTeams) {
      let res = globalContext?.groupsTeamsSummary;

      let totalCount = res?.teamsPublic + res?.teamsPrivate;
      let publicCount = res?.teamsPublic;
      let privateCount = res?.teamsPrivate;
      if (type === "Groups") {
        totalCount = res?.totalGroups;
        publicCount = res?.groupsPublic;
        privateCount = res?.groupsPrivate;
      }
      setPagination({
        ...pagination,
        publicCount: publicCount,
        privateCount: privateCount,
        totalPages: Math.ceil(totalCount / 100),
        currentPage: 1,
        totalDocuments: totalCount,
      });
    } else {
      setTeamsList([]);
      setIsLoading(true);
      getGroupsPaginationCounts();
    }
    getTeamsAndGroups();
  }, [providerName]);

  const getGroupsPaginationCounts = async () => {
    let res = await getSaaSGroupsPagination(memberId, providerName);
    if (res?.status === "OK" && res?.res) {
      let totalCount = res?.res?.teamsPublic + res?.res?.teamsPrivate;
      let publicCount = res?.res?.teamsPublic;
      let privateCount = res?.res?.teamsPrivate;
      if (type === "Groups") {
        totalCount = res?.res?.totalGroups;
        publicCount = res?.res?.groupsPublic;
        privateCount = res?.res?.groupsPrivate;
      }
      setPagination({
        ...pagination,
        publicCount: publicCount,
        privateCount: privateCount,
        totalPages: Math.ceil(totalCount / 100),
        currentPage: 1,
        totalDocuments: totalCount,
      });
      getTeamsAndGroups();
    }
  };

  const getTeamsAndGroups = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize
  ) => {
    setIsLoading(true);
    let res = await getSaaSGroupsData(
      memberId,
      providerName,
      providerName === "MIRO" ? pageNo : pageNo - 1,
      pageSize,
      type === "Teams" || type === "Channels"
    );
    if (res?.status === "OK" && res?.res) {
      setIsLoading(false);
      setTeamsList(res?.res);
    } else {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      getTeamsAndGroups(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      getTeamsAndGroups(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const searchDebounce = useRef(null);
  const searchTeamsGroupsList = async (e) => {
    setActiveCloudFilter(e);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        searchTeamsGroups(e);
      }, 500);
    } else {
      getTeamsAndGroups();
    }
  };

  const searchTeamsGroups = async (searchValue) => {
    setIsPageLoading(true);
    const encodedSearchValue = encodeURIComponent(searchValue);
    let res = await getVendorSearch(
      memberId,
      "teamgroups",
      encodedSearchValue,
      type !== "Groups",
      providerName
    );
    if (res?.status === "OK") {
      if (res?.res !== "No Data Found") {
        setIsPageLoading(false);
        setTeamsList(res?.res);
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
    P;
    setIsPageLoading(true);
    let res = await getDownloadStatus(
      memberId,
      type !== "Groups" ? "teams" : "groups"
    );
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setDownloadStatus({ ...res?.res });
      if (res?.res?.status === "PROCESSED") {
        downloadSaaSReport(type !== "Groups" ? "teams" : "groups");
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const downloadSaaSReport = async (action) => {
    setIsPageLoading(true);
    let res = await getDownloadSaaSReport(memberId, action);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.headers["content-type"] === "text/csv") {
        downloadGlobalCSV(res?.res, `${providerName}_${memberId}_${type}`);
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

  const restrictHeaderOwner = [
    "SHARE_FILE_BUSINESS",
    "SLACK",
    "GOOGLE_WORKSPACE",
    "HUBSPOT",
    "JIRA",
    "CONFLUENCE",
    "ATLASSIAN",
    "GITHUB",
  ];
  const restrictHeaders = [
    "SHARE_FILE_BUSINESS",
    "SLACK",
    "GOOGLE_WORKSPACE",
    "HUBSPOT",
    "JIRA",
    "CONFLUENCE",
    "ATLASSIAN",
  ];
  const restrictCreateAtHeaders = [
    "SHARE_FILE_BUSINESS",
    "SLACK",
    "GOOGLE_WORKSPACE",
    "HUBSPOT",
    "JIRA",
    "CONFLUENCE",
    "ATLASSIAN",
    "GITHUB",
  ];

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="SaaS Management" />
        <div className="cf_main_content_place">
          <TopNav pageName={`${type} List`} backLink="/Demo/Insights" />

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
              inputPlaceHolder={`Search By ${type} Name`}
              onInputSearch={(e) => searchTeamsGroupsList(e.searchInput)}
            />
            <span style={{ marginLeft: "auto" }}></span>
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
                    <th style={{ width: "200px" }}>Name</th>
                    <th style={{ width: "100px" }}>Type</th>
                    {/* {providerName === "HUBSPOT" ? ( */}
                    <th style={{ width: "100px", textAlign: "center" }}>
                      Members Count
                    </th>
                    {/* ) : (
                      ""
                    )} */}

                    {!restrictHeaderOwner.includes(providerName) ? (
                      <th style={{ width: "250px" }}>Owner</th>
                    ) : (
                      ""
                    )}
                    {!restrictHeaders.includes(providerName) ? (
                      <th style={{ width: "250px" }}>Email</th>
                    ) : (
                      ""
                    )}
                    {!restrictCreateAtHeaders.includes(providerName) ? (
                      <>
                        <th>Created At</th>
                      </>
                    ) : (
                      ""
                    )}
                    {/* <th>Status</th> */}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <>
                      <tr>
                        <td
                          colSpan={
                            providerName === "HUBSPOT"
                              ? 5
                              : !restrictHeaders.includes(providerName)
                              ? 6
                              : 3
                          }
                        >
                          {getCFTextLoader()}
                        </td>
                      </tr>
                      <tr style={{ visibility: "hidden" }}>
                        <td
                          className="cf_new_table_hide_text"
                          style={{ width: "200px" }}
                        >
                          <div className="cf_ManageClouds_table_image_container">
                            <img
                              src={cloudImageMapper(providerName)}
                              alt="SLACK"
                            />
                            <p>hyperlink-migration-in-edited-message</p>
                          </div>
                        </td>
                        <td
                          className="cf_new_table_hide_text"
                          style={{ width: "100px" }}
                        >
                          <p>Public</p>
                        </td>
                        {providerName === "HUBSPOT" ? (
                          <td className="cf_new_table_hide_text">
                            <p>10</p>
                          </td>
                        ) : (
                          ""
                        )}
                        {providerName !== "SHARE_FILE_BUSINESS" &&
                        providerName !== "HUBSPOT" ? (
                          <>
                            <td className="cf_new_table_hide_text">
                              <p>Microsoft Teams Services, James</p>
                            </td>
                            <td className="cf_new_table_hide_text">
                              <p>management-renamed140@pepperwood.club</p>
                            </td>
                            <td className="cf_new_table_hide_text">
                              <p>20th Aug 2024</p>
                            </td>
                          </>
                        ) : (
                          ""
                        )}
                      </tr>
                    </>
                  ) : (
                    teamsList?.map((team, index) => (
                      <tr key={index}>
                        <td
                          className="cf_new_table_hide_text"
                          style={{ width: "200px" }}
                        >
                          <div className="cf_ManageClouds_table_image_container">
                            <img
                              src={
                                team?.logoUrl ?? cloudImageMapper(providerName)
                              }
                              alt="SLACK"
                            />
                            <p
                              title={
                                team?.appName || team?.displayName || team?.name
                              }
                              dangerouslySetInnerHTML={{
                                __html: getMaxChar(
                                  team?.appName ||
                                    team?.displayName ||
                                    team?.name,
                                  50
                                ),
                              }}
                            ></p>
                          </div>
                        </td>
                        <td
                          className="cf_new_table_hide_text"
                          style={{ width: "100px" }}
                        >
                          <p>{team?.privateGroup ? "Private" : "Public"}</p>
                        </td>
                        {/* {providerName === "HUBSPOT" ? ( */}
                        <td
                          className="cf_new_table_hide_text"
                          style={{ textAlign: "center" }}
                        >
                          <p>{team?.membersCount}</p>
                        </td>
                        {!restrictHeaderOwner.includes(providerName) ? (
                          <td
                            className="cf_new_table_hide_text"
                            style={{ width: "250px" }}
                          >
                            <p>
                              {team?.owners ? (
                                <DMSEmailFormat
                                  emailList={team?.owners
                                    ?.map((item) => item.displayName)
                                    .join(",")}
                                  dmName={team?.appName}
                                />
                              ) : (
                                "-"
                              )}
                            </p>
                          </td>
                        ) : (
                          ""
                        )}
                        {!restrictHeaders.includes(providerName) ? (
                          <>
                            <td className="cf_new_table_hide_text">
                              <p title={team?.mail}>
                                {getMaxChar(team?.mail, 40)}
                              </p>
                            </td>
                          </>
                        ) : (
                          ""
                        )}
                        {!restrictCreateAtHeaders.includes(providerName) ? (
                          <td className="cf_new_table_hide_text">
                            <p>
                              {team?.createdTime
                                ? moment(team?.createdTime).format(
                                    "Do MMM YYYY"
                                  )
                                : "-"}
                            </p>
                          </td>
                        ) : (
                          ""
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="cf_new_tables_footer">
              <span>Total: {pagination?.totalDocuments} </span>
              <span>Public: {pagination?.publicCount} </span>
              <span>Private: {pagination?.privateCount} </span>
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

export default SaaSTeamsGroupsList;
