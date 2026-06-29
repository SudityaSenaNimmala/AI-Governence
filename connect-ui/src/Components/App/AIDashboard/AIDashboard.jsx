import React, { useState } from "react";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import DTopInfo from "../Dashboard/New/DTopInfo";
import DBottomInfo from "../Dashboard/New/DBottomInfo";
import AITopDasboard from "./AITopDasboard";

const AIDashboard = () => {
  const [billingData, setBillingData] = useState({});
  return (
    <div className="cf_main_container">
      <SideNav activeTab="AI Insights" />
      <div className="cf_main_content_place">
        <TopNav pageName="AI Insights" />
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
        >
          <AITopDasboard />
          {/* <DBottomInfo billingInfo={billingData} /> */}
        </div>
      </div>
    </div>
  );
};

export default AIDashboard;
