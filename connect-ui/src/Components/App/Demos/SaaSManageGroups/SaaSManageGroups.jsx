import { useEffect, useState } from "react";
import Popup from "../../../Resuables/Popup/Popup";
import TabSwitcher from "../../../Resuables/TabSwitcher/TabSwitcher";
import SvgName from "../../../Testing/SvgName";
import VerticalTabs from "../../../Resuables/VerticalTabs/VerticalTabs";
import SaaSManageGroupMembers from "./SaaSManageGroupMembers";
import moment from "moment";
import UserAIUsageInsights from "../AIUsageInsights/UserAIUsageInsights";

const SaaSManageGroups = ({
  selectedTeam,
  setSelectedTeam,
  providerName,
  currentGroupsList,
  setTeamsList,
  isPageLoading,
  setIsPageLoading,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [type, setType] = useState("public");
  const [currentTab, setCurrentTab] = useState("");
  const [tabMenu, setTabMenu] = useState([]);
  const [currentTeam, setCurrentTeam] = useState({});
  // const [isPageLoading, setIsPageLoading] = useState(false);
  useEffect(() => {
    if (selectedTeam) {
      setCurrentTeam(selectedTeam);
    }
  }, [selectedTeam]);

  useEffect(() => {
    if (providerName === "GOOGLE_WORKSPACE") {
      setTabMenu([
        {
          id: "OWNERS",
          name: "Owners",
        },
        {
          id: "MEMBERS",
          name: "Members",
        },
      ]);
      setCurrentTab("OWNERS");
    } else if (providerName === "GITHUB") {
      setTabMenu([
        {
          id: "AI_USAGE_INSIGHTS",
          name: "AI Usage Insights",
        },
        {
          id: "MEMBERS",
          name: "Members",
        },
      ]);
      setCurrentTab("AI_USAGE_INSIGHTS");
    } else {
      setTabMenu([
        {
          id: "OWNERS",
          name: providerName === "GUSTO" ? "Employees" : "Owners",
        },
        {
          id: "MEMBERS",
          name: providerName === "GUSTO" ? "Contractors" : "Members",
        },
      ]);
      setCurrentTab("OWNERS");
    }
  }, [providerName]);

  useEffect(() => {
    if (Object.keys(currentTeam).length > 0) {
      setIsVisible(true);
      setType(currentTeam?.teamsChannel ? "Team" : "Group");
    } else {
      setIsVisible(false);
    }
  }, [currentTeam]);

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: ``,
        popupWidth: "60%",
        type: "side",
        popupHeight: "calc(100% - 0px)",
        popupTop: "00px",
        maxHeight: "100%",
        overflowY: "auto",
        parentStyles: {
          justifyContent: "flex-end",
        },
      }}
      toggleOpen={setSelectedTeam}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "0 15px 15px 15px",
          height: "100%",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div className="cf_manage_groups_header">
          <SvgName
            type="square"
            name={
              currentTeam?.appName ||
              currentTeam?.displayName ||
              currentTeam?.name ||
              currentTeam?.groupName
            }
          />
          <div className="cf_manage_groups_header_title">
            <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
              <p
                title={
                  currentTeam?.appName ||
                  currentTeam?.displayName ||
                  currentTeam?.name ||
                  currentTeam?.groupName
                }
                dangerouslySetInnerHTML={{
                  __html:
                    currentTeam?.appName ||
                    currentTeam?.displayName ||
                    currentTeam?.name ||
                    currentTeam?.groupName,
                }}
              ></p>
            </div>
            <p
              style={{
                fontSize: "12px",
                color: "#64748b",
                fontWeight: "400",
              }}
            >
              {currentTeam?.privateGroup ? "Private " : "Public "}
              {type}
            </p>
            <div className="CF_d-flex ai-center" style={{ gap: "15px" }}>
              {currentTeam?.mail ||
                (currentTeam?.groupEmail && (
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#64748b",
                      fontWeight: "500",
                    }}
                  >
                    {currentTeam?.mail || currentTeam?.groupEmail}
                  </p>
                ))}
              <span style={{ marginLeft: "auto" }}></span>
              {/* {currentTeam?.owners?.length > 0 && ( */}
              <p
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  fontWeight: "500",
                }}
              >
                Owners:{" "}
                {currentTeam?.owners?.length ? currentTeam?.owners?.length : 0}
              </p>
              {/* // )} */}
              {/* {currentTeam?.members?.length > 0 && ( */}
              <p
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  fontWeight: "500",
                }}
              >
                Members:{" "}
                {currentTeam?.members?.length
                  ? currentTeam?.members?.length
                  : 0}
              </p>
              {/* )} */}
              {currentTeam?.createdTime && (
                <p
                  style={{
                    fontSize: "12px",
                    color: "#64748b",
                    fontWeight: "500",
                    marginLeft: "auto",
                  }}
                >
                  Created on:{" "}
                  {currentTeam?.createdTime
                    ? moment(currentTeam?.createdTime).format("Do MMM YYYY")
                    : 0}
                </p>
              )}
            </div>
          </div>
        </div>
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{
            padding: "0 5px",
            flexDirection: "column",
            height: "fit-content",
            position: "sticky",
            top: "0",
            zIndex: "99999999",
            backgroundColor: "#fff",
          }}
        >
          <TabSwitcher
            tabMenu={tabMenu}
            returnCurrentTab={(e) => setCurrentTab(e)}
            currentTab={currentTab}
          />
          {currentTab === "OWNERS" && (
            <SaaSManageGroupMembers
              usersList={currentTeam?.owners}
              type="Owners"
              team={currentTeam}
              vendorName={providerName}
              setCurrentTeam={setCurrentTeam}
              currentGroupsList={currentGroupsList}
              setTeamsList={setTeamsList}
              setIsPageLoading={setIsPageLoading}
            />
          )}
          {currentTab === "MEMBERS" && (
            <SaaSManageGroupMembers
              usersList={currentTeam?.members}
              type="Members"
              team={currentTeam}
              setCurrentTeam={setCurrentTeam}
              vendorName={providerName}
              currentGroupsList={currentGroupsList}
              setTeamsList={setTeamsList}
              setIsPageLoading={setIsPageLoading}
            />
          )}
          {currentTab === "AI_USAGE_INSIGHTS" && (
            <UserAIUsageInsights
              selectedUser={selectedTeam}
              setSelectedUser={setSelectedTeam}
              isPageLoading={isPageLoading}
              setIsPageLoading={setIsPageLoading}
              customPage={true}
            />
          )}
        </div>
      </div>
    </Popup>
  );
};

export default SaaSManageGroups;
