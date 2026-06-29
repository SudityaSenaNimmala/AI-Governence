import React, { useContext, useEffect, useState } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { getCloudsList, notifyToast } from "../../helpers/utils";
import { SET_CLOUDS_LIST } from "../../../GlobalContext/action.types";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import { IoTrashOutline } from "react-icons/io5";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import {
  deleteVendor,
  saveApiKey,
} from "./IntegrationActions/IntegrationActions";
import Popup from "../../Resuables/Popup/Popup";
import { GrKey } from "react-icons/gr";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";

const ManageCloudsOld = () => {
  const [apiKey, setApiKey] = useState("");
  const [isVisible, setIsVisible] = useState("");
  const [isApiKeySaving, setIsApiKeySaving] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [cloudsList, setCloudsList] = useState([]);
  const [boardClouds] = useState(["LUCID", "MIRO", "MURAL", "SMARTSHEET"]);
  useEffect(() => {
    getClouds();
  }, []);
  const getClouds = async () => {
    setIsPageLoading(true);
    let cloudsApiList = await getCloudsList();

    if (cloudsApiList?.status === "OK") {
      setIsPageLoading(false);
      setCloudsList(cloudsApiList?.res);
    } else {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    dispatch({
      type: SET_CLOUDS_LIST,
      payload: cloudsList,
    });
  }, [cloudsList]);

  const deleteHandel = async (memberId, vendorName) => {
    let res = await deleteVendor(memberId, vendorName);
    notifyToast("success", "Cloud Deleted Successfully");
    getClouds();
  };

  const startSaveApiKey = async () => {
    setIsApiKeySaving(true);
    let res = await saveApiKey(
      isVisible.split("|")[0],
      isVisible.split("|")[1],
      apiKey
    );
    if (res?.status === "OK") {
      setApiKey("");
      setIsVisible("");
      setIsApiKeySaving(false);
      notifyToast("success", "API Key Saved Successfully");
      getClouds();
    } else {
      setApiKey("");
      setIsVisible("");
      setIsApiKeySaving(false);
      notifyToast("success", "Failed To Save API Key");
    }
  };

  return (
    <>
      <br />
      {globalContext?.cloudsList?.map((data) => {
        return data?.providerName ? (
          <div className="cf_added_clouds_div">
            <div className="cf_added_clouds_div_icon">
              <img
                src={cloudImageMapper(data?.providerName ?? data?.cloudName)}
                alt={data?.providerName}
              />
            </div>
            <div className="cf_added_clouds_div_body">
              <div className="cf_added_clouds_div_body_title">
                <p>{getCloudName(data?.providerName ?? data?.cloudName)}</p>
              </div>
              <div className="cf_added_clouds_div_body_domain">
                <p className="cf_added_clouds_div_body_domain_res">
                  {" "}
                  {data?.domainName}
                </p>
              </div>
              <div className="cf_added_clouds_div_body_domain">
                <p className="cf_added_clouds_div_body_domain_res">
                  {" "}
                  {data?.adminEmail}
                </p>
              </div>
              {boardClouds?.includes(data?.providerName) && !data?.apiKey ? (
                <div
                  className="cf_added_clouds_div_body_domain"
                  style={{ marginLeft: "auto" }}
                  onClick={() => {
                    setApiKey("");
                    setIsApiKeySaving(false);
                    setIsVisible(`${data?.memberId}|${data?.providerName}`);
                  }}
                >
                  <p
                    className="cf_added_clouds_div_body_domain_res"
                    style={{ cursor: "pointer" }}
                  >
                    {" "}
                    <GrKey />
                  </p>
                </div>
              ) : (
                <div
                  className="cf_added_clouds_div_body_domain"
                  style={{ marginLeft: "auto" }}
                  onClick={() =>
                    deleteHandel(data?.memberId, data?.providerName)
                  }
                >
                  <p className="cf_added_clouds_div_body_domain_res">
                    {" "}
                    {/* <GrKey /> */}
                  </p>
                </div>
              )}
              <div
                className="cf_added_clouds_div_body_domain"
                style={{ marginLeft: "auto" }}
                onClick={() => deleteHandel(data?.memberId, data?.providerName)}
              >
                <p className="cf_added_clouds_div_body_domain_res">
                  {" "}
                  <IoTrashOutline />
                </p>
              </div>
            </div>
          </div>
        ) : (
          ""
        );
      })}
      {isPageLoading ? getCFLoader() : ""}
      <Popup
        options={{
          isOpen: isVisible,
          title: `${getCloudName(isVisible?.split("|")[1])} API Key`,
          popupWidth: "50%",
          popupHeight: "200px",
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{ padding: "0 10px", flexDirection: "column", gap: "30px" }}
        >
          <TextInput
            type="text"
            autoFocus={true}
            inputWidth="100%"
            defaultValue={apiKey}
            inputName="domainName"
            placeHolder="API Key *"
            getInputText={(val) => setApiKey(val)}
          />
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={isApiKeySaving}
            isDisabled={apiKey?.length === 0 || isApiKeySaving}
            buttonName="Save"
            buttonClickAction={() => startSaveApiKey()}
          />
        </div>
      </Popup>
    </>
  );
};

export default ManageCloudsOld;
