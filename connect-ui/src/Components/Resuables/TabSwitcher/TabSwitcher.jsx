import React, { useEffect, useState } from "react";
import "./css/TabSwitcher.css";
import {
  getSelectedDestinationCloudName,
  getSelectedSourceCloudName,
} from "../../helpers/utils";

const TabSwitcher = (props) => {
  const [activeTab, setActiveTab] = useState(
    props?.currentTab ?? props?.tabMenu[0]?.id
  );

  const changeTab = (tabName) => {
    props?.returnCurrentTab(tabName);
    setActiveTab(tabName);
  };

  useEffect(() => {
    if (props?.currentTab) {
      setActiveTab(props?.currentTab);
    }
    if (props?.currentTab === "PUBLIC_CHANNELS") {
      props?.changeExistingTeams(localStorage?.publicExistingTeams === "true");
    }
    if (props?.currentTab === "PRIVATE_CHANNELS") {
      props?.changeExistingTeams(localStorage?.privateExistingTeams === "true");
    }
  }, [props?.currentTab]);

  return (
    <div className="cf_tabSwitcher_div">
      {props?.tabMenu?.map((data) => {
        return (
          <div
            className={`cf_tabs ${
              activeTab === data?.id ? `cf_tabs_active` : ""
            }`}
            key={data?.id}
            onClick={() => changeTab(data?.id)}
          >
            {data?.name}
          </div>
        );
      })}
      <span style={{ marginLeft: "auto" }}></span>
      {getSelectedSourceCloudName() === "SLACK" &&
      getSelectedDestinationCloudName() === "MICROSOFT_TEAMS" ? (
        props?.currentTab === "PUBLIC_CHANNELS" ||
        props?.currentTab === "PRIVATE_CHANNELS" ? (
          <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
            <p>Migrate To Existing Team :</p>
            <label className="switch">
              <input
                type="checkbox"
                id="splitChannels"
                checked={props?.existingTeamsValue}
                onChange={(e) => props?.changeExistingTeams(e.target.checked)}
              />
              <span className="slider round" style={{ top: "6px" }}></span>
            </label>
          </div>
        ) : (
          ""
        )
      ) : (
        ""
      )}
      {props?.children}
    </div>
  );
};

export default TabSwitcher;
