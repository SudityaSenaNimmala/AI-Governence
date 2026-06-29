import React, { useState } from "react";
import ContentBreadCrumb from "./ContentBreadCrumb";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import "./css/Content.css";
import ContentMapping from "./ContentMapping/ContentMapping";
import ContentPerMissionMapping from "./ContentPerMissionMapping";
import ContentOptions from "./ContentOptions";
import ContentPreview from "./ContentPreview";
import Selection from "./Selection";

const Content = () => {
  const [contentState, setContentState] = useState({
    atPosition: 1,
    previousPosition: 0,
    nextPosition: 2,
  });
  return (
    <div className="cf_main_container">
      <SideNav activeTab="Migrate" subMenuActive="Content Migration" />
      <div className="cf_main_content_place">
        <TopNav pageName="Content Migration" />
        <div className="cf_main_content_place_main">
          <ContentBreadCrumb contentState={(e) => setContentState(e)} />
          <div
            className={
              contentState?.atPosition === 1
                ? "cf_content_mapping_placer"
                : `cf_d-none`
            }
          >
            <Selection type="CONTENT" />
          </div>
          <div
            className={
              contentState?.atPosition === 2
                ? "cf_content_mapping_placer"
                : `cf_d-none`
            }
          >
            <ContentMapping
              atPosition={contentState?.atPosition}
              previousPosition={contentState?.previousPosition}
            />
          </div>
          <div
            className={
              contentState?.atPosition === 3
                ? "cf_content_mapping_placer"
                : `cf_d-none`
            }
          >
            <ContentPerMissionMapping
              atPosition={contentState?.atPosition}
              previousPosition={contentState?.previousPosition}
            />
          </div>
          <div
            className={
              contentState?.atPosition === 4
                ? "cf_content_mapping_placer"
                : `cf_d-none`
            }
          >
            <ContentOptions
              atPosition={contentState?.atPosition}
              previousPosition={contentState?.previousPosition}
            />
          </div>
          <div
            className={
              contentState?.atPosition === 5 || contentState?.atPosition === 6
                ? "cf_content_mapping_placer"
                : `cf_d-none`
            }
          >
            <ContentPreview
              atPosition={contentState?.atPosition}
              previousPosition={contentState?.previousPosition}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Content;
