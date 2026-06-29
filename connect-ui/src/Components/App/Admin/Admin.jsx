import React from "react";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import "./css/Admin.css";
const Admin = () => {
  return (
    <div className="cf_main_container">
      <SideNav activeTab="" />
      <div className="cf_main_content_place">
        <TopNav pageName="Admin" />
        <div
          className="cf_main_content_place_main CF_d-flex CF_flex-d-column"
          style={{ gap: "30px" }}
        ></div>
      </div>
    </div>
  );
};

export default Admin;
