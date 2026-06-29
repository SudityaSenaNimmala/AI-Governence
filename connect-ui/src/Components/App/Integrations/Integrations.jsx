import React from "react";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import CloudsList from "./CloudsList";
import "./css/Integrations.css";
import { useParams } from "react-router-dom";
import ManageClouds from "./ManageClouds";
const Integrations = () => {
  const { type } = useParams();
  return (
    <div className="cf_main_container">
      <SideNav
        activeTab="Integrations"
        subMenuActive={
          type === "Manage" ? "Manage Applications" : "Add Applications"
        }
      />
      <div className="cf_main_content_place">
        <TopNav
          pageName={
            type === "Manage" ? "Manage Applications" : "Add Applications"
          }
        />
        <div
          className="cf_main_content_place_main"
          style={{ padding: "10px 0" }}
        >
          {type === "Manage" ? <ManageClouds /> : <CloudsList />}
        </div>
      </div>
    </div>
  );
};

export default Integrations;
