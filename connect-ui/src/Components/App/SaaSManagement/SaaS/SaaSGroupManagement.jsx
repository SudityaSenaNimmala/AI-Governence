import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { SET_GROUPS_TEAMS_SUMMARY } from "../../../../GlobalContext/action.types";
import PiCharts from "../../../Resuables/Charts/PiCharts";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import { getSaaSGroupsPagination } from "../SaaSActions/SaaSActions";
import "../css/SaaSManagement.css";
import { noGroupsRequiredGroups, onlyTeamsRequiredGroups } from "../../../helpers/utils";

const SaaSGroupManagement = () => {
  const navigate = useNavigate();
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [titleName, setTitleName] = useState({
    s1: "Teams",
    s2: "Groups",
  });
  const [isLoading, setIsLoading] = useState(true);
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
  const { memberId, providerName } = { ...globalContext?.saasCloud };

  useEffect(() => {
    if (providerName === "SLACK") {
      setTitleName({ ...titleName, s1: "Channels" });
    }
  }, [providerName]);

  useEffect(() => {
    if (globalContext?.groupsTeamsSummary?.totalTeams) {
      setIsLoading(false);
      setSummary({ ...globalContext?.groupsTeamsSummary });
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
    }
  }, [providerName]);

  const getSaasSummary = async () => {
    let res = await getSaaSGroupsPagination(memberId, providerName);
    if (res?.status === "OK" && res?.res) {
      setSummary(res?.res);
      dispatch({
        type: SET_GROUPS_TEAMS_SUMMARY,
        payload: res?.res,
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="cf_main_container">
      <SideNav activeTab="SaaS Management" />
      <div className="cf_main_content_place">
        <TopNav
          pageName={
            onlyTeamsRequiredGroups.includes(providerName)
              ? `${titleName?.s1}`
              : !noGroupsRequiredGroups.includes(providerName)
              ? `${titleName?.s1} & Groups`
              : `Groups`
          }
          backLink="/SaaSManagement/Menu"
        />
        <div
          className="cf_main_content_place_main cf_saas_options_contatiner"
          style={{ padding: "0 0 20px 0" }}
        >
          <div className="cf_groups_container">
            {!noGroupsRequiredGroups.includes(providerName) ? (
              <div className="cf_groups_summary">
                <div className="cf_groups_summary_title">
                  {titleName?.s1} Summary
                </div>
                <div className="cf_groups_summary_body">
                  <div className="cf_groups_summary_body_content">
                    <div className="cf_groups_summary_body_content_count">
                      {summary?.totalTeams}
                    </div>
                    <div className="cf_groups_summary_body_content_title">
                      Total {titleName?.s1}
                    </div>
                  </div>
                  <div className="cf_groups_summary_body_content">
                    <div className="cf_groups_summary_body_content_count">
                      {summary?.teamsInSevenDays}
                    </div>
                    <div className="cf_groups_summary_body_content_title">
                      New in last 7 days
                    </div>
                  </div>
                  <div className="cf_groups_summary_body_content">
                    <div className="cf_groups_summary_body_content_count">
                      {summary?.teamsPublic}
                    </div>
                    <div className="cf_groups_summary_body_content_title">
                      Public {titleName?.s1}
                    </div>
                  </div>
                  <div className="cf_groups_summary_body_content">
                    <div className="cf_groups_summary_body_content_count">
                      {summary?.teamsPrivate}
                    </div>
                    <div className="cf_groups_summary_body_content_title">
                      Private {titleName?.s1}
                    </div>
                  </div>
                  {/* <div className="cf_groups_summary_body_content">
                    <div className="cf_groups_summary_body_content_count">
                      {summary?.activeTeams}
                    </div>
                    <div className="cf_groups_summary_body_content_title">
                      Active
                    </div>
                  </div> */}
                  <div
                    className="cf_groups_summary_body_content"
                    style={{
                      height: "20px",
                      display: "flex",
                    }}
                  >
                    <div
                      className="cf_groups_summary_body_content_title cf_make_link"
                      style={{ marginLeft: "auto", width: "auto" }}
                      onClick={() =>
                        navigate(`/SaaS/TeamsGroups/${titleName?.s1}/List`)
                      }
                    >
                      View {titleName?.s1}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              ""
            )}
            {!onlyTeamsRequiredGroups.includes(providerName) ? (
              <div className="cf_groups_summary">
                <div className="cf_groups_summary_title">Groups Summary</div>
                <div className="cf_groups_summary_body">
                  <div className="cf_groups_summary_body_content">
                    <div className="cf_groups_summary_body_content_count">
                      {summary?.totalGroups}
                    </div>
                    <div className="cf_groups_summary_body_content_title">
                      Total Groups
                    </div>
                  </div>
                  <div className="cf_groups_summary_body_content">
                    <div className="cf_groups_summary_body_content_count">
                      {summary?.groupsInSevenDays}
                    </div>
                    <div className="cf_groups_summary_body_content_title">
                      New in last 7 days
                    </div>
                  </div>
                  <div className="cf_groups_summary_body_content">
                    <div className="cf_groups_summary_body_content_count">
                      {summary?.groupsPublic}
                    </div>
                    <div className="cf_groups_summary_body_content_title">
                      Public Groups
                    </div>
                  </div>
                  <div className="cf_groups_summary_body_content">
                    <div className="cf_groups_summary_body_content_count">
                      {summary?.groupsPrivate}
                    </div>
                    <div className="cf_groups_summary_body_content_title">
                      Private Groups
                    </div>
                  </div>
                  {/* <div className="cf_groups_summary_body_content">
                  <div className="cf_groups_summary_body_content_count">
                    {summary?.activeGroups}
                  </div>
                  <div className="cf_groups_summary_body_content_title">
                    Active
                  </div>
                </div> */}
                  <div
                    className="cf_groups_summary_body_content"
                    style={{
                      height: "20px",
                      display: "flex",
                    }}
                  >
                    <div
                      className="cf_groups_summary_body_content_title cf_make_link"
                      style={{ marginLeft: "auto", width: "auto" }}
                      onClick={() => navigate("/SaaS/TeamsGroups/Groups/List")}
                    >
                      View Groups
                    </div>
                  </div>
                  {/* <div
                  className="cf_groups_summary_body_content"
                  style={{ height: "20px" }}
                >
                  <div className="cf_groups_summary_body_content_title">
                    Total Groups
                  </div>
                </div> */}
                </div>
              </div>
            ) : (
              ""
            )}
          </div>
          <div
            className="cf_resource_apps_graph_container"
            style={{ height: "380px" }}
          >
            {isLoading ? (
              getCFTextLoader()
            ) : (
              <>
                {!noGroupsRequiredGroups.includes(providerName) ? (
                  <PiCharts
                    title={`${titleName?.s1} Summary`}
                    graphData={[
                      {
                        name: `Public ${titleName?.s1}`,
                        y: summary?.teamsPublic ?? 0,
                        color: "#0062ff",
                      },
                      {
                        name: `Private ${titleName?.s1}`,
                        y: summary?.teamsPrivate ?? 0,
                        color: "#AFDBF5",
                      },
                    ]}
                  />
                ) : (
                  ""
                )}
                {!onlyTeamsRequiredGroups.includes(providerName) ? (
                  <PiCharts
                    title="Group's Summary"
                    graphData={[
                      {
                        name: "Public Groups",
                        y: summary?.groupsPublic ?? 0,
                        color: "#28a745",
                      },
                      {
                        name: "Private Groups",
                        y: summary?.groupsPrivate,
                        color: "#8fbc8f",
                      },
                    ]}
                  />
                ) : (
                  ""
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaaSGroupManagement;
