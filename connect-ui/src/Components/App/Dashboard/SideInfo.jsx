import React, { useContext, useEffect, useState } from "react";
import { AiOutlineAppstoreAdd } from "react-icons/ai";
import { TbUsersGroup } from "react-icons/tb";
import { FaCalendarDay, FaFileInvoiceDollar } from "react-icons/fa6";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { getCloudName } from "../../helpers/helpers";
import { getSaaSCosting } from "./DashboardActions/DashboardActions";

const SideInfo = () => {
  const { globalContext } = useContext(GlobalContext);
  const [infoData, setInfoData] = useState({
    totalClouds: 0,
    totalBilling: 0,
    totalActiveUsers: 0,
  });

  useEffect(() => {
    fetchSaaSCosting();
    if (globalContext?.cloudsList?.length > 0) {
      let totalCount = 0;
      globalContext?.cloudsList?.map((data) => {
        return data?.providerName
          ? (totalCount = totalCount + data["Active Users"])
            ? data["Active Users"]
            : 0
          : 0;
      });

      let totalClouds = 0;
      globalContext?.cloudsList?.map((data) => {
        return data?.providerName ? totalClouds++ : 0;
      });

      setInfoData({
        ...infoData,
        totalClouds: totalClouds,
        totalActiveUsers: totalCount,
      });
    }
  }, [globalContext?.cloudsList]);

  const fetchSaaSCosting = async () => {
    let res = await getSaaSCosting();
    if (res?.status === "OK") {
      setInfoData({ ...infoData, totalBilling: res?.res?.totalCost });
    }
  };

  return (
    <div className="cf_dashboard_sideInfo_div">
      <div className="cf_dashboard_sideInfo_tile">
        <div className="cf_dashboard_sideInfo_tile_title">
          <p>Applications</p>
        </div>
        <div className="cf_dashboard_sideInfo_tile_body">
          <div className="cf_dashboard_sideInfo_tile_body_side_1">
            <AiOutlineAppstoreAdd />
          </div>
          <div className="cf_dashboard_sideInfo_tile_body_side_2">
            <p>{infoData?.totalClouds}</p>
          </div>
        </div>
      </div>
      <div className="cf_dashboard_sideInfo_tile">
        <div className="cf_dashboard_sideInfo_tile_title">
          <p>Active Users</p>
        </div>
        <div className="cf_dashboard_sideInfo_tile_body">
          <div className="cf_dashboard_sideInfo_tile_body_side_1">
            <TbUsersGroup />
          </div>
          <div className="cf_dashboard_sideInfo_tile_body_side_2">
            <p>{infoData?.totalActiveUsers ? infoData?.totalActiveUsers : 0}</p>
          </div>
        </div>
      </div>
      <div className="cf_dashboard_sideInfo_tile">
        <div className="cf_dashboard_sideInfo_tile_title">
          <p>Total Spent</p>
        </div>
        <div className="cf_dashboard_sideInfo_tile_body">
          <div className="cf_dashboard_sideInfo_tile_body_side_1">
            <FaFileInvoiceDollar />
          </div>
          <div className="cf_dashboard_sideInfo_tile_body_side_2">
            <p>$ {infoData?.totalBilling ? infoData?.totalBilling : 0}</p>
          </div>
        </div>
      </div>
      <div className="cf_dashboard_sideInfo_tile">
        <div className="cf_dashboard_sideInfo_tile_title">
          <p>Renewals</p>
        </div>
        <div className="cf_dashboard_sideInfo_tile_body">
          <div className="cf_dashboard_sideInfo_tile_body_side_1">
            <FaCalendarDay />
          </div>
          <div className="cf_dashboard_sideInfo_tile_body_side_2">
            <p>0</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SideInfo;
