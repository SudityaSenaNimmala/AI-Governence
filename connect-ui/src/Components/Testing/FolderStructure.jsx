import React, { useState } from "react";
import { FaFolder, FaFolderOpen } from "react-icons/fa6";

const FolderStructure = (props) => {
  const [isFolderOpenId, setIsFolderOpenId] = useState("");
  return (
    <div>
      <div style={{ padding: "0 10px" }}>
        {props?.folderStr?.map((data) => {
          return (
            <>
              <div>
                <div className="CF_d-flex" style={{ gap: "10px" }}>
                  <span onClick={() => setIsFolderOpenId(data?.id)}>
                    {isFolderOpenId === data?.id ? (
                      <FaFolderOpen />
                    ) : (
                      <FaFolder />
                    )}
                  </span>
                  <span>{data?.name}</span>
                </div>
              </div>
              {data?.folder?.length > 0 && isFolderOpenId === data?.id ? (
                <FolderStructure folderStr={data?.folder} />
              ) : (
                ""
              )}
            </>
          );
        })}
      </div>
    </div>
  );
};

export default FolderStructure;
