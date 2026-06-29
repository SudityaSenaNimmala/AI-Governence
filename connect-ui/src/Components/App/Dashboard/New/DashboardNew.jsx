import React, { useState } from "react";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import DTopInfo from "./DTopInfo";
import "./CSS/DashBoardNew.css";
import DBottomInfo from "./DBottomInfo";

const DashboardNew = () => {
  const [billingData, setBillingData] = useState({});
  return (
    <div className="cf_main_container">
      <SideNav />
      <div className="cf_main_content_place">
        <TopNav />
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
        >
          <DTopInfo setBillingData={(e) => setBillingData(e)} />
          <DBottomInfo billingInfo={billingData} />
        </div>
      </div>
    </div>
  );
};

export default DashboardNew;
