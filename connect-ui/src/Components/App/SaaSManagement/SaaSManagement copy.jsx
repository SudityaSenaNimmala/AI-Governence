import React, { useContext, useEffect, useState } from "react";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import "./css/SaaSManagement.css";
import { GrAppsRounded, GrLicense } from "react-icons/gr";
import { FaUser } from "react-icons/fa6";
import { MdGroups } from "react-icons/md";
import { IoIosGlobe } from "react-icons/io";
import { TbReportAnalytics } from "react-icons/tb";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import SelectDropDown from "../../Resuables/SelectDropDown/SelectDropDown";
import { cloudImageMapper } from "../../helpers/helpers";
import {
  RESET_SAAS_DATA,
  SET_SAAS_CLOUD,
} from "../../../GlobalContext/action.types";
import { useNavigate } from "react-router-dom";
import SaaSDownload from "./SaaS/SaaSDownload/SaaSDownload";

const SaaSManagement = () => {
  const navigate = useNavigate();
  const [allCloudsInfo, setAllCloudsInfo] = useState([]);
  const [navigateTo, setNavigateTo] = useState("");
  const { globalContext, dispatch } = useContext(GlobalContext);
  useEffect(() => {
    let cloudPush = [];
    globalContext?.cloudsList?.length > 0
      ? globalContext?.cloudsList?.map((data) => {
          data.imageSrc = cloudImageMapper(
            data?.cloudName ?? data?.providerName
          );
          data.displayName = data?.emailId ?? data?.adminEmail;
          return data?.providerName ? cloudPush.push(data) : "";
        })
      : "";
    return setAllCloudsInfo(cloudPush);
  }, [globalContext?.cloudsList]);
  let saasOptions = [
    {
      icon: <GrAppsRounded />,
      title: "Resource Apps",
      path: "#",
    },
    {
      icon: <GrLicense />,
      title: "License Management",
      path: "#",
    },
    {
      icon: <FaUser />,
      title: "User Management",
      path: "#",
    },
    {
      icon: <MdGroups />,
      title: "Group Management",
      path: "#",
    },
    {
      icon: <IoIosGlobe />,
      title: "Domains",
      path: "#",
    },
    {
      icon: <TbReportAnalytics />,
      title: "Download Reports",
      path: "#",
    },
  ];

  useEffect(() => {
    if (navigateTo === "Resource Apps") {
      navigate("/SaaS/ResourceApps");
    } else if (navigateTo === "License Management") {
      navigate("/SaaS/License");
    } else if (navigateTo === "Domains") {
      navigate("/SaaS/Domains");
    } else if (navigateTo === "Group Management") {
      navigate("/SaaS/TeamsGroups");
    } else if (navigateTo === "User Management") {
      navigate("/SaaS/UserManagement");
    }
  }, [navigateTo]);

  const selectSaaSVendor = (e) => {
    dispatch({ type: SET_SAAS_CLOUD, payload: e });
    dispatch({
      type: RESET_SAAS_DATA,
      payload: "",
    });
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="SaaS Management" />
        <div className="cf_main_content_place">
          <TopNav pageName="SaaS Management" />
          <div style={{ height: "50px", marginTop: "30px" }}>
            <SelectDropDown
              onSelect={(e) => selectSaaSVendor(e)}
              defaultSelected={globalContext?.saasCloud ?? {}}
              placeHolder="Select Cloud"
              dropDownContent={allCloudsInfo}
            />
          </div>
          <div className="cf_main_content_place_main cf_saas_options_contatiner">
            {saasOptions?.map((data) => {
              return (
                <div
                  className="cf_saas_options_pannels"
                  key={data?.title}
                  onClick={() => setNavigateTo(data?.title)}
                >
                  <div className="cf_saas_options_pannels_icon_container">
                    <div className="cf_saas_options_pannels_icon_div">
                      {data?.icon}
                    </div>
                  </div>
                  <div className="cf_saas_options_pannels_title_container">
                    <h3>{data?.title}</h3>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {navigateTo === "Download Reports" ? (
        <SaaSDownload navigateTo={setNavigateTo} />
      ) : (
        ""
      )}
    </>
  );
};

export default SaaSManagement;
