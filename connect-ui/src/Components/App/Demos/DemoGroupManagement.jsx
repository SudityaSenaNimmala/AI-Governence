import moment from "moment";
import { useContext, useEffect, useRef, useState } from "react";
import { BiFilterAlt } from "react-icons/bi";
import { SET_GROUPS_TEAMS_SUMMARY } from "../../../GlobalContext/action.types";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getRandomArray } from "../../helpers/helpers";
import {
  getMaxChar,
  newImplementation,
  noGroupsRequiredGroups,
  notifyToast,
  onlyTeamsRequired,
  onlyTeamsRequiredGroups,
} from "../../helpers/utils";
import CustomDropDown from "../../Resuables/CustomDropDown/CustomDropDown";
import { getCFLoader, getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import DMSEmailFormat from "../Migrations/Message/MessageDirectMessages/DMSEmailFormat";
import {
  getSaaSGroupsData,
  getSaaSGroupsPagination,
  getVendorSearch,
} from "../SaaSManagement/SaaSActions/SaaSActions";
import SaaSManageGroups from "./SaaSManageGroups/SaaSManageGroups";
import { RotateCw } from "lucide-react";

const DemoGroupManagement = ({
  setIsGroupSync,
  isGroupSync,
  checkSyncGroups,
}) => {
  const [type, setType] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [teamsList, setTeamsList] = useState([]);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [isSynced, setIsSynced] = useState(false);
  const [searchValue, setSearchValue] = useState(null);
  // const [isGroupSync, setIsGroupSync] = useState(false);
  const [groupsCount, setGroupsCount] = useState({
    total: 0,
    public: 0,
    private: 0,
  });
  const [pagination, setPagination] = useState({
    publicCount: 0,
    privateCount: 0,
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [titleName, setTitleName] = useState({
    s1: "Teams",
    s2: "Groups",
  });
  const [summary, setSummary] = useState({
    teamsPrivate: 0,
    teamsPublic: 0,
    teamsInSevenDays: 0,
    activeTeams: 0,
    groupsPrivate: 0,
    groupsPublic: 0,
    groupsInSevenDays: 0,
    activeGroups: 0,
    totalTeams: 0,
    totalGroups: 0,
  });
  const { memberId, providerName, id } = { ...globalContext?.saasCloud };

  console.log(groupsCount)

  const restrictHeaderOwner = [
    "SHARE_FILE_BUSINESS",
    "SLACK",
    "GOOGLE_WORKSPACE",
    "MICROSOFT_OFFICE_365",
    "HUBSPOT",
    "TERRAFORM",
    "JIRA",
    "CONFLUENCE",
    "ATLASSIAN",
    "GITHUB",
    "CLICKUP",
    "ZOOM",
    "DOCUSIGN",
    "ASANA",
    "PANDADOC",
    "INSIGHTFUL",
    "SENDGRID",
    "DROPBOX_BUSINESS",
    "BITBUCKET",
    "BOX_BUSINESS",
    ...newImplementation,
  ];
  const restrictHeaders = [
    "SHARE_FILE_BUSINESS",
    "SLACK",
    "HUBSPOT",
    "TERRAFORM",
    "JIRA",
    "CONFLUENCE",
    "ATLASSIAN",
    "CLICKUP",
    "ZOOM",
    "DOCUSIGN",
    "ASANA",
    "PANDADOC",
    "INSIGHTFUL",
    "SENDGRID",
    "DROPBOX_BUSINESS",
    "BITBUCKET",
    "BOX_BUSINESS",
    ...newImplementation,
  ];
  const restrictCreateAtHeaders = [
    "SHARE_FILE_BUSINESS",
    "SLACK",
    "GOOGLE_WORKSPACE",
    "MICROSOFT_OFFICE_365",
    "HUBSPOT",
    "TERRAFORM",
    "JIRA",
    "CONFLUENCE",
    "ATLASSIAN",
    "GITHUB",
    "CLICKUP",
    "DOCUSIGN",
    "ZOOM",
    "ASANA",
    "PANDADOC",
    "INSIGHTFUL",
    "SENDGRID",
    "DROPBOX_BUSINESS",
    "BITBUCKET",
    "BOX_BUSINESS",
    ...newImplementation,
  ];

  const organizationHeaders = ["BITBUCKET", "AHA", "SENTRY"];

  const restrictMembersCount = ["CANVA"];

  useEffect(() => {
    if (providerName === "SLACK") {
      setTitleName({ ...titleName, s1: "Channels" });
    }
  }, [providerName]);

  useEffect(() => {
    if (
      globalContext?.groupsTeamsSummary?.totalTeams ||
      globalContext?.groupsTeamsSummary?.totalGroups
    ) {
      setIsLoading(false);
      if (
        newImplementation.includes(providerName) &&
        globalContext?.groupsTeamsSummary?.groupSync
      ) {
        setSummary({ ...globalContext?.groupsTeamsSummary });
      } else {
        if (!newImplementation.includes(providerName)) {
          setSummary({ ...globalContext?.groupsTeamsSummary });
        }
      }
    } else {
      setSummary({
        teamsPrivate: 0,
        teamsPublic: 0,
        teamsInSevenDays: 0,
        activeTeams: 0,
        groupsPrivate: 0,
        groupsPublic: 0,
        groupsInSevenDays: 0,
        activeGroups: 0,
        totalTeams: 0,
        totalGroups: 0,
      });
      setIsLoading(true);
      getSaasSummary();
      getTeamsAndGroups();
    }
    if (!newImplementation.includes(providerName)) {
      setIsGroupSync(true);
    }
    setType(
      !noGroupsRequiredGroups.includes(providerName) &&
        !onlyTeamsRequiredGroups.includes(providerName)
        ? "Teams"
        : !noGroupsRequiredGroups.includes(providerName)
          ? "Teams"
          : !onlyTeamsRequiredGroups.includes(providerName)
            ? "Groups"
            : "Teams"
    );
    setSearchValue(null);
  }, [memberId]);

  const getSaasSummary = async () => {
    setIsPageLoading(true);
    let res = await getSaaSGroupsPagination(memberId, providerName, id);
    if (res?.status === "OK" && res?.res) {
      setIsPageLoading(false);
      if (newImplementation.includes(providerName)) {
        if (res?.res?.groupSync) {
          setIsGroupSync(res?.res?.groupSync);
          setIsSynced(res?.res?.groupSync);
          dispatch({
            type: SET_GROUPS_TEAMS_SUMMARY,
            payload: res?.res,
          });
          setSummary(res?.res);
          setType("Groups");
        } else {
          setIsPageLoading(false);
          setSummary(res?.res);
          let cpyObj = { ...res?.res };
          if (res?.res?.processStatus === "CONFLICT") {
            cpyObj.groupSync = true;
            setIsGroupSync(true);
            setIsSynced(true);
          }
          dispatch({
            type: SET_GROUPS_TEAMS_SUMMARY,
            payload: cpyObj,
          });
        }
      } else {
        setIsPageLoading(false);
        setSummary(res?.res);
        let cpyObj = { ...res?.res };
        if (res?.res?.processStatus === "CONFLICT") {
          cpyObj.groupSync = true;
          setIsGroupSync(true);
          setIsSynced(true);
        }
        dispatch({
          type: SET_GROUPS_TEAMS_SUMMARY,
          payload: cpyObj,
        });
      }
      setIsLoading(false);
    } else {
      setIsPageLoading(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (checkSyncGroups && !isGroupSync) {
      getSaasSummary();
    }
  }, [checkSyncGroups]);

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
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      setSearchValue(e);
      searchDebounce.current = setTimeout(async () => {
        searchTeamsGroups(e);
      }, 500);
    } else {
      setSearchValue(null);
      getTeamsAndGroups();
    }
  };

  const searchTeamsGroups = async (searchValue) => {
    setIsPageLoading(true);
    setTeamsList([]);
    const encodedSearchValue = encodeURIComponent(searchValue);
    let res = await getVendorSearch(
      memberId,
      "teamgroups",
      encodedSearchValue,
      type !== "Groups",
      providerName,
      id
    );
    if (res?.status === "OK") {
      if (newImplementation.includes(providerName)) {
        if (res?.res?.groupDtos?.length > 0) {
          setIsPageLoading(false);
          setGroupsCount({
            total: res?.res?.totalGroups,
            public: res?.res?.totalPublicGroups,
            private: res?.res?.totalPrivateGroups,
          });
          setTeamsList(res?.res?.groupDtos);
        } else {
          setIsPageLoading(false);
          notifyToast("error", "No Data Found");
        }
      } else {
        if (res?.res !== "No Data Found") {
          setIsPageLoading(false);
          setTeamsList(res?.res);
        } else {
          setIsPageLoading(false);
          notifyToast("error", res?.res);
        }
      }
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
    }
  };

  const getTeamsAndGroups = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize
  ) => {
    if (!type) {
      return;
    }
    if (newImplementation.includes(providerName) && !isSynced) {
      return;
    }
    setIsLoading(true);
    let res = await getSaaSGroupsData(
      memberId,
      providerName,
      pageNo - 1,
      pageSize,
      type === "Teams" || type === "Channels",
      id
    );
    if (res?.status === "OK" && res?.res) {
      setIsLoading(false);
      if (newImplementation.includes(providerName)) {
        setTeamsList(res?.res?.groupDtos);
        setGroupsCount({
          total: res?.res?.totalGroups,
          public: res?.res?.totalPublicGroups,
          private: res?.res?.totalGroups - res?.res?.totalPublicGroups,
        });
      } else {
        setTeamsList(res?.res);
      }
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (newImplementation.includes(providerName)) {
      getTeamsAndGroups();
    }
  }, [isSynced]);

  useEffect(() => {
    if (globalContext?.groupsTeamsSummary) {
      let res = globalContext?.groupsTeamsSummary;
      let totalCount = res?.teamsPublic + res?.teamsPrivate;
      let publicCount = res?.teamsPublic;
      let privateCount = res?.teamsPrivate;
      if (type === "Groups") {
        totalCount = res?.totalGroups;
        publicCount = res?.groupsPublic;
        privateCount = res?.groupsPrivate;
      }
      if (newImplementation.includes(providerName)) {
        totalCount = res?.groupsCount;
        publicCount = res?.groupsCount;
        privateCount = 0;
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
    }
    // getTeamsAndGroups();
  }, [globalContext?.groupsTeamsSummary]);

  useEffect(() => {
    if (!newImplementation.includes(providerName)) {
      getTeamsAndGroups();
    }
    let res = globalContext?.groupsTeamsSummary;
    let totalCount = res?.teamsPublic + res?.teamsPrivate;
    let publicCount = res?.teamsPublic;
    let privateCount = res?.teamsPrivate;
    if (type === "Groups") {
      totalCount = res?.totalGroups;
      publicCount = res?.groupsPublic;
      privateCount = res?.groupsPrivate;
    }
    if (newImplementation.includes(providerName)) {
      totalCount = res?.groupsCount;
      publicCount = res?.groupsCount;
      privateCount = 0;
    }

    setPagination({
      ...pagination,
      publicCount: publicCount,
      privateCount: privateCount,
      totalPages: Math.ceil(totalCount / 100),
      currentPage: 1,
      totalDocuments: totalCount,
    });
  }, [type]);

  return (
    <>
      {providerName !== "CLAUDE" && <div className="cf_new_dashboard_resourceApps_container_3row">
        <div className="cf_new_dashboard_info_pannel">
          <div className="cf_new_dashboard_info_pannel_title">
            <p>
              Total{" "}
              {providerName === "SLACK"
                ? `Channels`
                : onlyTeamsRequired.includes(providerName) ||
                  providerName === "INSIGHTFUL"
                  ? `Teams`
                  : `Groups`}
            </p>
          </div>
          <div
            className="cf_new_dashboard_info_pannel_body"
            style={{
              position: "relative",
              display: "flex",
              gap: "8px",
              alignItems: "baseline",
            }}
          >
            <p className="cf_new_dashboard_Data">
              {newImplementation.includes(providerName)
                ? groupsCount?.total || 0
                : summary?.totalGroups + summary?.totalTeams || 0}
            </p>

            {newImplementation.includes(providerName) ? (
              ""
            ) : !noGroupsRequiredGroups.includes(providerName) &&
              !onlyTeamsRequiredGroups.includes(providerName) ? (
              <p className="cf_new_dashboard_pannel_info">
                {`Teams: ${summary?.totalTeams}`} &nbsp;{" "}
                {`Groups: ${summary?.totalGroups}`}
              </p>
            ) : (
              ``
            )}
          </div>
        </div>
        <div className="cf_new_dashboard_info_pannel">
          <div className="cf_new_dashboard_info_pannel_title">
            <p>Total Public</p>
          </div>
          <div
            className="cf_new_dashboard_info_pannel_body"
            style={{
              position: "relative",
              display: "flex",
              gap: "8px",
              alignItems: "baseline",
            }}
          >
            <p className="cf_new_dashboard_Data">
              {newImplementation.includes(providerName)
                ? groupsCount?.public || 0
                : summary?.groupsPublic + summary?.teamsPublic || 0}
            </p>
            {newImplementation.includes(providerName) ? (
              ""
            ) : !noGroupsRequiredGroups.includes(providerName) &&
              !onlyTeamsRequiredGroups.includes(providerName) ? (
              <p className="cf_new_dashboard_pannel_info">
                {`Teams: ${summary?.teamsPublic}`} &nbsp;{" "}
                {`Groups: ${summary?.groupsPublic}`}
              </p>
            ) : (
              ``
            )}
          </div>
        </div>
        <div className="cf_new_dashboard_info_pannel">
          <div className="cf_new_dashboard_info_pannel_title">
            <p>Total Private</p>
          </div>
          <div
            className="cf_new_dashboard_info_pannel_body"
            style={{
              position: "relative",
              display: "flex",
              gap: "8px",
              alignItems: "baseline",
            }}
          >
            <p className="cf_new_dashboard_Data" style={{ color: "#001a6f" }}>
              {newImplementation.includes(providerName)
                ? groupsCount?.private || 0
                : summary?.groupsPrivate + summary?.teamsPrivate || 0}
            </p>
            {newImplementation.includes(providerName) ? (
              ""
            ) : !noGroupsRequiredGroups.includes(providerName) &&
              !onlyTeamsRequiredGroups.includes(providerName) ? (
              <p className="cf_new_dashboard_pannel_info">
                {`Teams: ${summary?.teamsPrivate}`} &nbsp;{" "}
                {`Groups: ${summary?.groupsPrivate}`}
              </p>
            ) : (
              ``
            )}
          </div>
        </div>
      </div>}
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
          defaultValue={searchValue}
          inputPlaceHolder={`Search By Name`}
          onInputSearch={(e) => searchTeamsGroupsList(e.searchInput)}
        />
        <span style={{ marginLeft: "auto" }}></span>
        {summary?.groupSync && summary?.processStatus !== "NOT_PROCESSED" && (
          <div
            className="CF_d-flex ai-center"
            style={{ gap: "8px", paddingRight: "40px" }}
          >
            <p
              style={{ fontSize: "12px", fontWeight: "500", color: "#0062ff" }}
            >
              Group Members are being synced...
            </p>
            <div
              className="cf_dashboard_analytics_edit CF_Pointer"
              style={{ marginLeft: "auto", visibility: "visible" }}
              onClick={() => getSaasSummary()}
              title="Check Status"
            >
              <RotateCw size={12} className="CF_Pointer" title="Check Status" />
            </div>
          </div>
        )}
      </div>
      <div
        className="cf_main_content_place_main CF_d-flex"
        style={{
          padding: "10px 0 0 0",
          flexDirection: "column",
          height: "fit-content",
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
                {organizationHeaders?.includes(providerName) ? (
                  <th style={{ width: "200px" }}>Organization</th>
                ) : (
                  ""
                )}
                {!restrictHeaders.includes(providerName) ? (
                  <th style={{ width: "250px" }}>Email</th>
                ) : (
                  ""
                )}
                {newImplementation.includes(providerName) ? (
                  ""
                ) : (
                  <th style={{ width: "100px" }}>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                      <span>Type</span>
                      <CustomDropDown
                        customDropDownStyles={{
                          width: "120px",
                          right: "-100%",
                        }}
                        defaultVal={
                          type === "Groups"
                            ? { key: "Groups", value: "Groups" }
                            : { key: "Teams", value: "Teams" }
                        }
                        dropDownList={
                          !noGroupsRequiredGroups.includes(providerName) &&
                            !onlyTeamsRequiredGroups.includes(providerName)
                            ? [
                              { key: "Teams", value: "Teams" },
                              { key: "Groups", value: "Groups" },
                            ]
                            : !noGroupsRequiredGroups.includes(providerName)
                              ? [{ key: "Teams", value: "Teams" }]
                              : !onlyTeamsRequiredGroups.includes(providerName)
                                ? [{ key: "Groups", value: "Groups" }]
                                : ""
                        }
                        selectFilter={(e) => setType(e.key)}
                      >
                        <span className="CF_Pointer CF_d-flex ai-center">
                          <BiFilterAlt />
                        </span>
                      </CustomDropDown>
                    </div>
                  </th>
                )}
                <th style={{ width: "100px" }}>Type</th>
                {/* {providerName === "HUBSPOT" ? ( */}
                {!restrictMembersCount.includes(providerName) ? (
                  <th style={{ width: "100px", textAlign: "center" }}>
                    Members
                  </th>
                ) : (
                  ""
                )}

                {!restrictHeaderOwner.includes(providerName) ? (
                  <th style={{ width: "250px" }}>Owner</th>
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
                        providerName === "HUBSPOT" ||
                          providerName === "TERRAFORM"
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
                        <img src={cloudImageMapper(providerName)} alt="SLACK" />
                        <p>hyperlink-migration-in-edited-message</p>
                      </div>
                    </td>
                    {organizationHeaders?.includes(providerName) ? (
                      <td className="cf_new_table_hide_text">
                        <p>Organization</p>
                      </td>
                    ) : (
                      ""
                    )}
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>Public</p>
                    </td>
                    {providerName === "HUBSPOT" ||
                      providerName === "TERRAFORM" ? (
                      <td className="cf_new_table_hide_text">
                        <p>10</p>
                      </td>
                    ) : (
                      ""
                    )}
                    {providerName !== "SHARE_FILE_BUSINESS" &&
                      providerName !== "HUBSPOT" &&
                      providerName !== "TERRAFORM" ? (
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
                          src={team?.logoUrl ?? cloudImageMapper(providerName)}
                          alt="SLACK"
                        />
                        <p
                          className={
                            restrictMembersCount.includes(providerName)
                              ? ""
                              : `cf_make_link`
                          }
                          onClick={() =>
                            restrictMembersCount.includes(providerName)
                              ? null
                              : setSelectedTeam(team)
                          }
                          title={
                            team?.appName ||
                            team?.displayName ||
                            team?.name ||
                            team?.groupName
                          }
                          dangerouslySetInnerHTML={{
                            __html: getMaxChar(
                              team?.appName ||
                              team?.displayName ||
                              team?.name ||
                              team?.groupName,
                              50
                            ),
                          }}
                        ></p>
                      </div>
                    </td>
                    {organizationHeaders?.includes(providerName) ? (
                      <td className="cf_new_table_hide_text">
                        <p>{team?.organization || "-"}</p>
                      </td>
                    ) : (
                      ""
                    )}
                    {!restrictHeaders.includes(providerName) ? (
                      <>
                        <td className="cf_new_table_hide_text">
                          <p title={team?.mail || team?.groupEmail}>
                            {getMaxChar(team?.mail || team?.groupEmail, 40)}
                          </p>
                        </td>
                      </>
                    ) : (
                      ""
                    )}
                    {newImplementation.includes(providerName) ? (
                      ""
                    ) : (
                      <td
                        className="cf_new_table_hide_text"
                        style={{ width: "100px" }}
                      >
                        <p>{type}</p>
                      </td>
                    )}
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>{team?.privateGroup ? "Private" : "Public"}</p>
                    </td>
                    {!restrictMembersCount.includes(providerName) ? (
                      <td
                        className="cf_new_table_hide_text"
                        style={{ textAlign: "center" }}
                      >
                        <p>
                          {newImplementation.includes(providerName)
                            ? team?.members?.length ||
                            0 + team?.owners?.length ||
                            0
                            : team?.membersCount}
                        </p>
                      </td>
                    ) : (
                      ""
                    )}
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
                    {!restrictCreateAtHeaders.includes(providerName) ? (
                      <td className="cf_new_table_hide_text">
                        <p>
                          {team?.createdTime
                            ? moment(team?.createdTime).format("Do MMM YYYY")
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
          <span>
            Total:{" "}
            {searchValue ? groupsCount?.total : pagination?.totalDocuments}{" "}
          </span>
          <span>Public: {groupsCount?.public || 0} </span>
          <span>Private: {groupsCount?.private || 0} </span>
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
      {selectedTeam && (
        <SaaSManageGroups
          selectedTeam={selectedTeam}
          setSelectedTeam={setSelectedTeam}
          providerName={providerName}
          currentGroupsList={teamsList}
          setTeamsList={setTeamsList}
          isPageLoading={isPageLoading}
          setIsPageLoading={setIsPageLoading}
        />
      )}
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default DemoGroupManagement;
