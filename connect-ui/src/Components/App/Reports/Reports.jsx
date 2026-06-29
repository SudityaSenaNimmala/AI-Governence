import React, { useEffect, useState } from "react";
import TopNav from "../../Resuables/Nav/TopNav";
import SideNav from "../../Resuables/Nav/SideNav";
import ContentReports from "./ContentReports/ContentReports";
import "./css/Reports.css";
import MessageReports from "./MessageReports/MessageReports";
import { Link, useParams } from "react-router-dom";

const Reports = () => {
  const { type } = useParams();
  const reportsMapper = {
    Content: "Content Reports",
    Collaborations: "Collaborations Reports",
    Email: "Email Reports",
    Canvas: "Canvas Reports",
  };
  const [reportsActive, setReportsActive] = useState(
    reportsMapper[type] ?? "Content Reports"
  );
  const [isSideNavOpen, setIsSideNavOpen] = useState(false);
  useEffect(() => {
    setReportsActive(reportsMapper[type] ?? "Content Reports");
  }, [type]);
  return (
    <div className="cf_main_container">
      <SideNav
        activeTab="Reports"
        subMenuActive={reportsMapper[type] ?? "Content Reports"}
      />
      <div className="cf_main_content_place">
        <TopNav pageName={reportsMapper[type] ?? "Content Reports"} />
        {reportsActive === "Content Reports" ? (
          <div
            className="cf_main_content_place_main"
            style={{ padding: "0", height: "fit-content" }}
          >
            <ContentReports />
          </div>
        ) : (
          ""
        )}
        {reportsActive === "Collaborations Reports" ? (
          <div className="cf_main_content_place_main" style={{ padding: "0" }}>
            <MessageReports />
          </div>
        ) : (
          ""
        )}
      </div>
    </div>
  );
};

export default Reports;
