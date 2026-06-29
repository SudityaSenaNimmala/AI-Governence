import React, { useContext, useState } from "react";
import { FaRegUser } from "react-icons/fa6";
import { FaAngleUp, FaAngleDown } from "react-icons/fa6";
import { getUserFoldersList } from "../../ContentActions/ContentActions";
import ContentFolderStructure from "./ContentFolderStructure";
import { getCFTextLoader } from "../../../../../Resuables/Loaders/Loaders";
import { GlobalContext } from "../../../../../../GlobalContext/GlobalContext";
import {
  SET_DESTINATION_MAPPING,
  SET_SOURCE_MAPPING,
} from "../../../../../../GlobalContext/action.types";
import {
  getSelectedDestinationCloudName,
  getSelectedSourceCloudName,
} from "../../../../../helpers/utils";
import CustomToolTip from "../../../../../Resuables/CustomToolTip/CustomToolTip";

const DomainUsersList = (props) => {
  const { domainsList, isLoading, folderMapping, action } = props;
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [selectedDomainUser, setSelectedDomainUser] = useState({});
  const [foldersList, setFoldersList] = useState([]);
  const setUser = (data) => {
    setSelectedDomainUser(data);
    getFoldersList(data);
  };
  const getFoldersList = async (data) => {
    setIsFolderLoading(true);
    const list = await getUserFoldersList(data?.id, data?.rootFolderId, 1, 50);
    setFoldersList(list?.res);
    setIsFolderLoading(false);
  };

  const selectUserForMigration = (e, data) => {
    let childInput = document.querySelectorAll(
      '[data-superparentid="' + data?.id + '"] input[type="checkbox"]'
    );

    childInput.forEach((inp) => {
      inp.checked = e.target.checked;
      inp.disabled = e.target.checked;
    });

    if (e.target.checked) {
      if (action === "SOURCE") {
        dispatch({
          type: SET_SOURCE_MAPPING,
          payload: [
            {
              sourcePath:
                getSelectedSourceCloudName() === "BOX_BUSINESS" &&
                getSelectedDestinationCloudName() === "ONEDRIVE_BUSINESS_ADMIN"
                  ? "/"
                  : data?.sourcePath,
              sourceFolderId:
                getSelectedSourceCloudName() === "BOX_BUSINESS" &&
                getSelectedDestinationCloudName() === "ONEDRIVE_BUSINESS_ADMIN"
                  ? "root"
                  : data?.rootFolderId,
              sourceCloudId: data?.id,
            },
          ],
        });
      } else {
        dispatch({
          type: SET_DESTINATION_MAPPING,
          payload: [
            {
              destPath:
                getSelectedSourceCloudName() === "BOX_BUSINESS" &&
                getSelectedDestinationCloudName() === "ONEDRIVE_BUSINESS_ADMIN"
                  ? "/"
                  : data?.sourcePath,
              destFolderId:
                getSelectedSourceCloudName() === "BOX_BUSINESS" &&
                getSelectedDestinationCloudName() === "ONEDRIVE_BUSINESS_ADMIN"
                  ? "root"
                  : data?.rootFolderId,
              destCloudId: data?.id,
            },
          ],
        });
      }
    }
  };

  const generateInput = (data) => {
    if (action === "SOURCE") {
      return (
        <>
          {folderMapping ? (
            selectedDomainUser?.id === data?.id ? (
              <span
                className="CF_d-flex CF_Pointer"
                onClick={() => setSelectedDomainUser({})}
              >
                <FaAngleUp />
              </span>
            ) : (
              <span
                className="CF_d-flex CF_Pointer"
                onClick={() => setUser(data)}
              >
                <FaAngleDown />
              </span>
            )
          ) : (
            ""
          )}
          <span className="CF_d-flex">
            <input
              type={folderMapping && action === "SOURCE" ? "checkbox" : "radio"}
              onChange={(e) => selectUserForMigration(e, data)}
              id={`input_${action}`}
              name={`USERS_${action}`}
              disabled={data?.flag}
            />
          </span>
        </>
      );
    } else {
      if (
        getSelectedDestinationCloudName() === "ONEDRIVE_BUSINESS_ADMIN" &&
        data?.rootFolderId === "/"
      ) {
        return (
          <>
            <span className="CF_d-flex">
              <CustomToolTip title={`User authentication failed`}>
                <FaAngleDown className="cf_disabled" />
              </CustomToolTip>
            </span>
            <span>
              <input type={"radio"} disabled />
            </span>
          </>
        );
      } else {
        return (
          <>
            {folderMapping ? (
              selectedDomainUser?.id === data?.id ? (
                <span
                  className="CF_d-flex CF_Pointer"
                  onClick={() => setSelectedDomainUser({})}
                >
                  <FaAngleUp />
                </span>
              ) : (
                <span
                  className="CF_d-flex CF_Pointer"
                  onClick={() => setUser(data)}
                >
                  <FaAngleDown />
                </span>
              )
            ) : (
              ""
            )}
            <span className="CF_d-flex">
              <input
                type={
                  folderMapping && action === "SOURCE" ? "checkbox" : "radio"
                }
                onChange={(e) => selectUserForMigration(e, data)}
                id={`input_${action}`}
                data-parentId={data?.id}
                name={`USERS_${action}`}
                disabled={data?.flag}
              />
            </span>
          </>
        );
      }
    }
  };

  return (
    <>
      {isLoading
        ? getCFTextLoader()
        : domainsList?.cloudDetail?.map((data, index) => (
            <div
              key={data?.id}
              className="cf_mapping_domain_users_container CF_flex-d-column"
            >
              <div className="cf_mapping_domain_users">
                {generateInput(data)}
                <span
                  className="cf_mapping_domain_name CF_d-flex ai-center"
                  style={{ gap: "5px" }}
                >
                  <FaRegUser />
                  {data?.emailId?.split("@")[0]}
                </span>
              </div>
              {selectedDomainUser?.id === data?.id ? (
                <ContentFolderStructure
                  action={action}
                  parentFolderPath={""}
                  folderStr={foldersList}
                  isLoading={isFolderLoading}
                  superParentId={data?.id}
                  parentId={data?.id}
                />
              ) : (
                ""
              )}
            </div>
          ))}
    </>
  );
};

// Admin -add
// Sta - inti view
// Rep - rep
export default DomainUsersList;
