import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  SET_CLOUDS_LIST,
  SET_MAPPED_PAIRS,
  SET_SELECTED_DESTINATION_CLOUD,
  SET_SELECTED_SOURCE_CLOUD,
} from "../../../GlobalContext/action.types";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import {
  cloudImageMapper,
  collaboratorsCloudsList,
  getCloudName,
} from "../../helpers/helpers";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import SelectDropDown from "../../Resuables/SelectDropDown/SelectDropDown";
import "./css/Migrations.css";
import {
  getExchangeUser,
  getMessageUser,
} from "../Login/AuthActions/AuthActions";
import { getCloudsList } from "../../helpers/utils";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
const Migrations = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState("Content");
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [allCloudsInfo, setAllCloudsInfo] = useState({
    source: [],
    destination: [],
  });

  const getSelectedVal = (action, cloudData) => {
    if (!cloudData || !allCloudsInfo) return;

    if (
      cloudData?.cloudName === "MICROSOFT_TEAMS" ||
      cloudData?.cloudName === "GOOGLE_CHAT" ||
      cloudData?.cloudName === "FACEBOOK_WORKPLACE" ||
      cloudData?.cloudName === "SLACK"
    ) {
      setSource("Collaborations");
    } else if (
      cloudData?.cloudName === "LUCID" ||
      cloudData?.cloudName === "MIRO" ||
      cloudData?.cloudName === "MURAL"
    ) {
      setSource("Canvas");
    } else {
      setSource("Content");
    }

    const currentSources = Array.isArray(allCloudsInfo.source)
      ? [...allCloudsInfo.source]
      : [];
    const currentDestinations = Array.isArray(allCloudsInfo.destination)
      ? [...allCloudsInfo.destination]
      : [];

    if (action === "SOURCE") {
      const updatedDestinations = currentDestinations.map((dest) => ({
        ...dest,
        isDisabled: dest.id === cloudData.id,
      }));

      setAllCloudsInfo((prev) => ({
        ...prev,
        destination: updatedDestinations,
      }));

      dispatch({
        type: SET_SELECTED_SOURCE_CLOUD,
        payload: cloudData,
      });
    } else {
      const updatedSources = currentSources.map((source) => ({
        ...source,
        isDisabled: source.id === cloudData.id,
      }));

      setAllCloudsInfo((prev) => ({
        ...prev,
        source: updatedSources,
      }));

      dispatch({
        type: SET_SELECTED_DESTINATION_CLOUD,
        payload: cloudData,
      });
    }
  };

  const getXchangeUser = async () => {
    setIsLoading(true);
    let res = await getExchangeUser();
    if (res?.status === "OK") {
      let migration = {
        content: res?.res,
      };
      localStorage.setItem("CFUser", JSON.stringify(migration));
      fetchMessageUser();
    } else {
      fetchMessageUser();
    }
  };

  const fetchMessageUser = async () => {
    setIsLoading(true);

    let res = await getMessageUser();
    if (res?.status === "OK") {
      let user = JSON.parse(localStorage.CFUser);
      user.message = res?.res;
      localStorage.removeItem("bToken");
      localStorage.setItem("CFUser", JSON.stringify(user));
      fetchData();
    }
  };

  const fetchData = async () => {
    let newArr = [];
    let clouds = await getCloudsList("MIGRATION");
    if (clouds?.res?.length > 0) {
      clouds?.res?.map((data) => {
        let newData = {
          ...data,
          name: getCloudName(data?.cloudName ?? data?.providerName),
          tag: collaboratorsCloudsList.includes(data?.providerName)
            ? "Collaborators"
            : "",
          "Total Users": data?.usersCount ?? data?.totolClouds ?? 0,
          "Active Users": data?.activeUsers ?? data?.provisionedClouds ?? 0,
          "In Active Users": data?.inActiveUSers ?? data?.notProvisioned ?? 0,
          "Total Groups": 0,
          "Total Resource Apps": 0,
        };
        return newArr.push(newData);
      });
      setIsLoading(false);
      newArr = newArr.sort((a, b) => b["Active Users"] - a["Active Users"]);
      dispatch({
        type: SET_CLOUDS_LIST,
        payload: newArr,
      });
      // setAppData(newArr);

      let cloudPush = [];
      let cloudPushDestination = [];
      newArr?.length > 0
        ? newArr?.map((data) => {
            data.imageSrc = cloudImageMapper(data?.cloudName);
            data.displayName = data?.emailId;
            data?.cloudName === "SLACK" ||
            data?.cloudName === "MICROSOFT_TEAMS" ||
            data?.cloudName === "MS_VIVA_ENGAGE" ||
            data?.cloudName === "GOOGLE_CHAT"
              ? cloudPushDestination.push(data)
              : "";
            return data?.cloudName === "SLACK" ||
              data?.cloudName === "MICROSOFT_TEAMS" ||
              data?.cloudName === "FACEBOOK_WORKPLACE" ||
              data?.cloudName === "GOOGLE_CHAT"
              ? cloudPush.push(data)
              : "";
          })
        : "";
      return setAllCloudsInfo({
        source: cloudPush,
        destination: cloudPushDestination,
      });
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let users = JSON.parse(localStorage.CFUser);
    if (!users?.content) {
      getXchangeUser();
    }
    if (!users?.message) {
      fetchMessageUser();
    }
    if (users?.content || users?.message) {
      let cloudPush = [];
      let cloudPushDestination = [];
      globalContext?.cloudsList?.length > 0
        ? globalContext?.cloudsList?.map((data) => {
            data.imageSrc = cloudImageMapper(data?.cloudName);
            data.displayName = data?.emailId;
            data?.cloudName === "SLACK" ||
            data?.cloudName === "MICROSOFT_TEAMS" ||
            data?.cloudName === "MS_VIVA_ENGAGE" ||
            data?.cloudName === "GOOGLE_CHAT"
              ? cloudPushDestination.push(data)
              : "";
            return data?.cloudName === "SLACK" ||
              data?.cloudName === "MICROSOFT_TEAMS" ||
              data?.cloudName === "FACEBOOK_WORKPLACE" ||
              data?.cloudName === "GOOGLE_CHAT"
              ? cloudPush.push(data)
              : "";
          })
        : "";
      return setAllCloudsInfo({
        source: cloudPush,
        destination: cloudPushDestination,
      });
    }
  }, []);

  useEffect(() => {
    dispatch({
      type: SET_MAPPED_PAIRS,
      payload: [],
    });
  }, []);

  useEffect(() => {
    if (globalContext?.destinationCloud && globalContext?.sourceCloud) {
      if (
        globalContext?.destinationCloud?.cloudName === "MS_VIVA_ENGAGE" ||
        globalContext?.destinationCloud?.cloudName === "MICROSOFT_TEAMS" ||
        globalContext?.destinationCloud?.cloudName === "GOOGLE_CHAT" ||
        globalContext?.destinationCloud?.cloudName === "SLACK"
      ) {
        setSource("Collaborations");
      } else if (
        globalContext?.destinationCloud?.cloudName === "LUCID" ||
        globalContext?.destinationCloud?.cloudName === "MIRO" ||
        globalContext?.destinationCloud?.cloudName === "MURAL"
      ) {
        setSource("Canvas");
      } else {
        setSource("Content");
      }
    }
  }, [globalContext?.sourceCloud, globalContext?.destinationCloud]);

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Migrations" />
        <div className="cf_main_content_place">
          <TopNav pageName="Migrations" />
          <div className="cf_main_content_place_main">
            <div className="cf_migrations_div">
              <SelectDropDown
                onSelect={(e) => getSelectedVal("SOURCE", e)}
                defaultSelected={globalContext?.sourceCloud ?? {}}
                placeHolder="Select Source Cloud"
                dropDownContent={allCloudsInfo?.source}
              />
              <SelectDropDown
                onSelect={(e) => getSelectedVal("DESTINATION", e)}
                defaultSelected={globalContext?.destinationCloud ?? {}}
                placeHolder="Select Destination Cloud"
                dropDownContent={allCloudsInfo?.destination}
              />
              {/* <TextInput
              inputWidth="100%"
              type="text"
              placeHolder="Data Type"
              inputName="userName"
              autoFocus={true}
              getInputText={(val, name) => console.log(val, name)}
              />
            <TextInput
              inputWidth="100%"
              type="text"
              placeHolder="Users"
              inputName="userName"
              autoFocus={true}
              getInputText={(val, name) => console.log(val, name)}
              />
              <TextInput
              inputWidth="100%"
              type="date"
              placeHolder=""
              inputName="userName"
              autoFocus={true}
              getInputText={(val, name) => console.log(val, name)}
              /> */}
              <Link
                to={`/Migrations/${source}`}
                className={
                  !(
                    globalContext?.destinationCloud?.cloudName &&
                    globalContext?.sourceCloud?.cloudName
                  )
                    ? "cf_button_disabled"
                    : ""
                }
              >
                <ButtonComponent
                  buttonName="Start Migration"
                  inputWidth="100%"
                  isDisabled={
                    !(
                      globalContext?.destinationCloud?.cloudName &&
                      globalContext?.sourceCloud?.cloudName
                    )
                  }
                />
              </Link>
            </div>
          </div>
        </div>
      </div>
      {isLoading ? getCFLoader() : ""}
    </>
  );
};

export default Migrations;
