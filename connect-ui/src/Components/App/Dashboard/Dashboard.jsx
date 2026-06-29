import React, { useContext, useEffect, useState } from "react";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import { getCloudsList } from "../../helpers/utils";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { SET_CLOUDS_LIST } from "../../../GlobalContext/action.types";
import "./css/Dashboard.css";
import SideInfo from "./SideInfo";
import SideInfoGraph from "./SideInfoGraph";

const Dashboard = () => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [cloudsList, setCloudsList] = useState([]);

  useEffect(() => {
    const getClouds = async () => {
      // let cloudsApiList = await getCloudsList();
      // setCloudsList(cloudsApiList?.res);
    };
    if (globalContext?.userId) {
      getClouds();
    }
  }, [globalContext?.userId]);

  useEffect(() => {
    dispatch({
      type: SET_CLOUDS_LIST,
      payload: cloudsList,
    });
  }, [cloudsList]);
  return (
    <div className="cf_main_container">
      <SideNav />
      <div className="cf_main_content_place">
        <TopNav />
        <div className="cf_main_content_place_main CF_d-flex">
          <SideInfo />
          <SideInfoGraph />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
