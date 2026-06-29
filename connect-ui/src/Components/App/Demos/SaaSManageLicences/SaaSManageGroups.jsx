import { useEffect, useState } from "react";
import Popup from "../../../Resuables/Popup/Popup";
import TabSwitcher from "../../../Resuables/TabSwitcher/TabSwitcher";
import SvgName from "../../../Testing/SvgName";
import VerticalTabs from "../../../Resuables/VerticalTabs/VerticalTabs";
import SaaSManageGroupMembers from "./SaaSManageGroupMembers";
import moment from "moment";

const SaaSManageGroups = ({ selectedTeam, setSelectedTeam, providerName }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [type, setType] = useState("public");
  const [currentTab, setCurrentTab] = useState("");
  const [tabMenu, setTabMenu] = useState([]);

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
    } else {
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
    }
  }, [providerName]);

  useEffect(() => {
    if (Object.keys(selectedTeam).length > 0) {
      setIsVisible(true);
      setType(selectedTeam?.teamsChannel ? "Team" : "Group");
    } else {
      setIsVisible(false);
    }
  }, [selectedTeam]);

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: ``,
        popupWidth: "60%",
        type: "side",
        popupHeight: "calc(100% - 60px)",
        popupTop: "60px",
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
              selectedTeam?.appName ||
              selectedTeam?.displayName ||
              selectedTeam?.name ||
              selectedTeam?.groupName
            }
          />
          <div className="cf_manage_groups_header_title">
            <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
              {/* {selectedTeam?.privateGroup ? (
                <Lock size={18} strokeWidth={1.5} color="#454545" />
              ) : (
                <Users size={18} strokeWidth={1.5} color="#454545" />
              )} */}
              <p
                title={
                  selectedTeam?.appName ||
                  selectedTeam?.displayName ||
                  selectedTeam?.name ||
                  selectedTeam?.groupName
                }
                dangerouslySetInnerHTML={{
                  __html:
                    selectedTeam?.appName ||
                    selectedTeam?.displayName ||
                    selectedTeam?.name ||
                    selectedTeam?.groupName,
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
              {selectedTeam?.privateGroup ? "Private " : "Public "}
              {type}
            </p>
            <div className="CF_d-flex ai-center" style={{ gap: "15px" }}>
              {selectedTeam?.mail ||
                (selectedTeam?.groupEmail && (
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#64748b",
                      fontWeight: "500",
                    }}
                  >
                    {selectedTeam?.mail || selectedTeam?.groupEmail}
                  </p>
                ))}
              <span style={{ marginLeft: "auto" }}></span>
              {/* {selectedTeam?.owners?.length > 0 && ( */}
              <p
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  fontWeight: "500",
                }}
              >
                Owners Count:{" "}
                {selectedTeam?.owners?.length
                  ? selectedTeam?.owners?.length
                  : "-"}
              </p>
              {/* // )} */}
              {/* {selectedTeam?.members?.length > 0 && ( */}
              <p
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  fontWeight: "500",
                }}
              >
                Members Count:{" "}
                {selectedTeam?.members?.length
                  ? selectedTeam?.members?.length
                  : 0}
              </p>
              {/* )} */}
              {selectedTeam?.createdTime && (
                <p
                  style={{
                    fontSize: "12px",
                    color: "#64748b",
                    fontWeight: "500",
                    marginLeft: "auto",
                  }}
                >
                  Created on:{" "}
                  {selectedTeam?.createdTime
                    ? moment(selectedTeam?.createdTime).format("Do MMM YYYY")
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
              usersList={selectedTeam?.owners}
              type="Owners"
              vendorName={providerName}
            />
          )}
          {currentTab === "MEMBERS" && (
            <SaaSManageGroupMembers
              usersList={selectedTeam?.members}
              type="Members"
              vendorName={providerName}
            />
          )}
        </div>
      </div>
    </Popup>
  );
};

export default SaaSManageGroups;
