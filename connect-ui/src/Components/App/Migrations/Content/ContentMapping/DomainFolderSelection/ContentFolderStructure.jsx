import React, { useContext, useEffect, useState } from "react";
import { FcFolder, FcOpenedFolder } from "react-icons/fc";
import { getUserFoldersList } from "../../ContentActions/ContentActions";
import { getCFTextLoader } from "../../../../../Resuables/Loaders/Loaders";
import { GlobalContext } from "../../../../../../GlobalContext/GlobalContext";
import {
  SET_DESTINATION_MAPPING,
  SET_SOURCE_MAPPING,
} from "../../../../../../GlobalContext/action.types";

const ContentFolderStructure = (props) => {
  let {
    folderStr,
    isLoading,
    parentId,
    superParentId,
    action,
    parentFolderPath,
  } = props;
  const [isFolderOpenId, setIsFolderOpenId] = useState({});
  const { globalContext, dispatch } = useContext(GlobalContext);

  const [subFolderData, setSubFolderData] = useState([]);
  const [isFoldersLoading, setIsFoldersLoading] = useState(false);
  const setSubFolders = (data) => {
    setIsFolderOpenId(data);
    getSubFoldersList(data);
  };

  useEffect(() => {
    setIsFoldersLoading(isLoading);
  }, [isLoading]);

  const getSubFoldersList = async (data) => {
    setSubFolderData([]);
    setIsFoldersLoading(true);
    const list = await getUserFoldersList(data?.cloudId, data?.id, 1, 50);
    setSubFolderData(list?.res);
    setIsFoldersLoading(false);
  };

  const foldetSelect = (e, data) => {
    let inputParentId = e.target.getAttribute("input-id");
    let subInputs = document.querySelectorAll(
      '[data-superparentid="' + inputParentId + '"] input[type="checkbox"]'
    );
    subInputs?.forEach((inp) => {
      inp.checked = e.target.checked;
      inp.disabled = e.target.checked;
    });
    selectUserForMigration(e, data);
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
              sourcePath: e.target.getAttribute("path"),
              sourceFolderId: data?.id,
              sourceCloudId: data?.cloudId,
            },
          ],
        });
      } else {
        dispatch({
          type: SET_DESTINATION_MAPPING,
          payload: [
            {
              destPath: e.target.getAttribute("path"),
              destFolderId: data?.id,
              destCloudId: data?.cloudId,
            },
          ],
        });
      }
    }
  };

  return (
    <>
      {isLoading ? (
        getCFTextLoader()
      ) : (
        <div data-superparentid={parentId}>
          <div style={{ padding: "0 0 0 10px", width: "100%" }}>
            {folderStr?.map((data) => {
              return (
                <>
                  <div
                    style={{ padding: "0 0 0 10px", width: "100%" }}
                    key={data?.id}
                    data-parent-id={data?.id}
                  >
                    <div className="CF_d-flex" style={{ gap: "10px" }}>
                      {isFolderOpenId?.id === data?.id ? (
                        <span
                          className="pointer"
                          onClick={() => setIsFolderOpenId({})}
                        >
                          <FcOpenedFolder />
                        </span>
                      ) : (
                        <span
                          className="pointer"
                          onClick={() => setSubFolders(data)}
                        >
                          <FcFolder />
                        </span>
                      )}
                      <span>
                        {document.querySelector(
                          '[input-id="' + parentId + '"]:checked'
                        ) ? (
                          <input
                            type="checkbox"
                            input-id={data?.id}
                            parent-id={parentId}
                            path={`${parentFolderPath}/${data?.objectName}`}
                            onChange={(e) => foldetSelect(e, data)}
                            checked={true}
                            disabled={true}
                          />
                        ) : (
                          <input
                            type="checkbox"
                            input-id={data?.id}
                            parent-id={parentId}
                            path={`${parentFolderPath}/${data?.objectName}`}
                            onChange={(e) => foldetSelect(e, data)}
                          />
                        )}
                      </span>
                      <span className="cf_mapping_domain_name">
                        {data?.objectName}
                      </span>
                    </div>
                  </div>
                  {
                    // subFolderData?.length > 0 &&
                    isFolderOpenId?.id === data?.id ? (
                      isFoldersLoading ? (
                        getCFTextLoader()
                      ) : (
                        <ContentFolderStructure
                          action={action}
                          parentFolderPath={`${parentFolderPath}/${data?.objectName}`}
                          folderStr={subFolderData}
                          parentId={data?.id}
                          superParentId={superParentId}
                        />
                      )
                    ) : (
                      ""
                    )
                  }
                </>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};

export default ContentFolderStructure;
