import React, { useState } from "react";
import BoardBreadCrumbs from "./CanvasBreadCrumbs";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
const Canvas = () => {
  const [contentState, setContentState] = useState({
    atPosition: 1,
  });
  return (
    <div className="cf_main_container">
      <SideNav activeTab="Migrations" />
      <div className="cf_main_content_place">
        <TopNav pageName="Canvas Migration" />
        <div className="cf_main_content_place_main">
          <BoardBreadCrumbs contentState={(e) => setContentState(e)} />
        </div>
      </div>
    </div>
  );
};

export default Canvas;
