import { useEffect, useState } from "react";
import { onBoardFields } from "../../../helpers/utils";
import MultiSelectInputDropDown from "../../../Resuables/InputsComponents/MultiSelectInputDropDown";
import SalesForceLanguages from "../../../helpers/JSON/SalesForceLanguages.json";
import SalesForceRegions from "../../../helpers/JSON/SalesForceRegions.json";
import SalesForceTimeZones from "../../../helpers/JSON/SalesForceTimeZones.json";
import { getSaaSRolesForApplication } from "../../SaaSManagement/SaaSActions/SaaSActions";
const OnBoardHandleUserOptions = ({
  currentProvider,
  infoMap = {},
  selectMap = {},
  handleSelectFromMultiList = () => {},
  setSelectedUserInfoMapInternal = {},
  keyToCheck = "",
}) => {
  const [userInfoMap, setUserInfoMap] = useState({});
  const [selectedUserInfoMap, setSelectedUserInfoMap] = useState({});
  const [data, setData] = useState(currentProvider);
  useEffect(() => {
    if (infoMap) {
      setUserInfoMap(infoMap);
    }
    if (selectMap) {
      setSelectedUserInfoMap(selectMap);
    }
  }, []);

  useEffect(() => {
    if (currentProvider?.providerName && currentProvider?.id) {
      setData(currentProvider);
    }
  }, [currentProvider]);

  useEffect(() => {
    if (userInfoMap) {
      setSelectedUserInfoMapInternal(userInfoMap);
    }
  }, [userInfoMap]);

  useEffect(() => {
    if (selectMap) {
      setSelectedUserInfoMap(selectMap);
    }
  }, [selectMap]);

  const handleSelectFromMultiListInternal = (e, eData, action, type) => {
    handleSelectFromMultiList(e, eData, action, type, data);
  };

  const getRolesInternal = async (action, cloudInfo = data) => {
    if (userInfoMap[keyToCheck || `${cloudInfo?.providerName}|${cloudInfo?.id}`]?.[action]) {
      return true;
    }

    let salesForceActionResponse = null;

    if (action === "TIMEZONE" && cloudInfo?.providerName === "SALESFORCE") {
      salesForceActionResponse = SalesForceTimeZones;
    }
    if (action === "LANGUAGE" && cloudInfo?.providerName === "SALESFORCE") {
      salesForceActionResponse = SalesForceLanguages;
    }
    if (action === "REGION" && cloudInfo?.providerName === "SALESFORCE") {
      salesForceActionResponse = SalesForceRegions;
    }
    if (cloudInfo?.providerName === "TRELLO") {
      salesForceActionResponse = currentProvider?.organizationNames?.reduce(
        (acc, res) => {
          acc.push({
            id: res,
            roleName: res,
            roleFor: "CUSTOM_ACTION",
            customName: true,
          });
          return acc;
        },
        []
      );
    }

    if (salesForceActionResponse) {
      setUserInfoMap((prev) => ({
        ...prev,
        [keyToCheck || `${cloudInfo?.providerName}|${cloudInfo?.id}`]: {
          ...userInfoMap[keyToCheck || `${cloudInfo?.providerName}|${cloudInfo?.id}`],
          [action]: salesForceActionResponse,
        },
      }));
      return true;
    }

    let res = await getSaaSRolesForApplication(cloudInfo?.providerName, action, cloudInfo?.id);
    if (res?.status === "OK") {
      setUserInfoMap((prev) => ({
        ...prev,
        [keyToCheck || `${cloudInfo?.providerName}|${cloudInfo?.id}`]: {
          ...userInfoMap[keyToCheck || `${cloudInfo?.providerName}|${cloudInfo?.id}`],
          [action]: res?.res,
        },
      }));
      return true;
    } else {
      return false;
    }
  };

  return onBoardFields[data?.providerName]?.map((field) => (
    <div
      className="cf_workdflow_cloud_license_item"
      style={{ flexDirection: "column", gap: "4px" }}
    >
      <p
        className="cf_sub_heading"
        style={{ color: "#64748b", fontWeight: "500" }}
      >
        {field?.name}
      </p>
      <MultiSelectInputDropDown
        parentStyle={{ maxWidth: "100%" }}
        childrenStyle={{ maxWidth: "300px" }}
        loadAction={() => getRolesInternal(field?.id)}
        displayFields={field?.displayFields || ["roleName"]}
        options={{
          inputType: field?.inputType || "radio",
          inputName: field?.id,
          name: field?.name,
        }}
        suggestedData={
          userInfoMap[keyToCheck || 
            `${currentProvider?.providerName}|${currentProvider?.id}`]?.
          [field?.id] || []
        }
        selectedData={
          selectedUserInfoMap[keyToCheck || `${currentProvider?.providerName}|${currentProvider?.id}`]?.
          [field?.id] || []
        }
        handleSelection={handleSelectFromMultiListInternal}
      />
    </div>
  ));
};

export default OnBoardHandleUserOptions;
