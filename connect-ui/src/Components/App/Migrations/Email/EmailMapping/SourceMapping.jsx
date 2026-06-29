import React, { useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { MdOutlineAdd } from "react-icons/md";
import { FaRegUser } from "react-icons/fa6";
import { cloudImageMapper, getRandomArray } from "../../../../helpers/helpers";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import {
  getDomainsList,
  getDomainsSearchList,
  getDomainUsersList,
  getSearchUserByDomain,
} from "../ContentActions/ContentActions";
import { HiMinus } from "react-icons/hi";
import DomainUsersList from "./DomainFolderSelection/DomainUsersList";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";

const SourceMapping = () => {
  const location = useLocation();
  const preSelectedUsers = location.state?.preSelectedUsers ?? [];

  const sprawlDomains = useMemo(() => {
    const groups = {};
    preSelectedUsers.forEach((u) => {
      const domain = u.email?.split("@")[1] ?? "unknown";
      if (!groups[domain]) groups[domain] = { domainName: domain, users: [] };
      groups[domain].users.push(u);
    });
    return Object.values(groups);
  }, [preSelectedUsers]);

  const [domainsList, setDomainsList] = useState([]);
  const { globalContext } = useContext(GlobalContext);
  const [domainUsersList, setDomainUsersList] = useState([]);
  const [userSuggestionsList, setUserSuggestionsList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: sprawlDomains.length > 0 ? preSelectedUsers.length : 0,
  });
  const [folderMapping, setFolderMapping] = useState(true);
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [selectedSrcDomain, setSelectedSrcDomain] = useState("");

  return (
    <div className="cf_content_source_selection">
      <div className="cf_content_mapping_title">
        <div className="cf_content_mapping_title_image" style={{ overflow: "hidden" }}>
          <img
            src={cloudImageMapper("OUTLOOK")}
            alt="BOX_BUSINESS"
          />
        </div>
        <div className="cf_content_mapping_title_search">
          <SearchComponent
            boxShadows={true}
            autoFocus={true}
            inputName="searchInput"
            suggestionsList={userSuggestionsList}
            customStyles={{ width: "240px", height: "30px", border: 0 }}
            customButtonStyles={{
              background: "transparent",
              color: "rgb(255, 255, 255)",
              fontWeight: "bolder",
              height: "30px",
              border: 0,
            }}
            inputPlaceHolder={`Search By User`}
            onInputSearch={(e) => console.log(e)}
          />
        </div>
      </div>
      <div
        className="cf_content_mapping_body"
        style={{ height: "calc(100% - 80px)" }}
      >
        {isLoading
          ? getRandomArray(5)?.map((data, index) => (
            <div className="cf_mapping_domain" key={`Num-${index}`}>
              <span className="CF_d-flex CF_Pointer">
                <MdOutlineAdd className="CF_SVG_THICK skeleton" />
              </span>
              <span className="cf_mapping_domain_name skeletonData">cloudfuze.co</span>
            </div>
          ))
          : sprawlDomains.length > 0
            ? sprawlDomains.map((group) => {
              const isOpen = selectedSrcDomain === group.domainName;
              return (
                <div className="cf_mapping_domain_container" key={`SRC_${group.domainName}`}>
                  <div className="cf_mapping_domain" style={{ borderBottom: "0" }}>
                    <span
                      className="CF_d-flex CF_Pointer"
                      onClick={() => setSelectedSrcDomain(isOpen ? "" : group.domainName)}
                    >
                      {isOpen ? (
                        <HiMinus className="CF_SVG_THICK" />
                      ) : (
                        <MdOutlineAdd className="CF_SVG_THICK" />
                      )}
                    </span>
                    <span className="cf_mapping_domain_name">{group.domainName}</span>
                  </div>
                  {isOpen && group.users.map((u) => (
                    <div key={u.id ?? u.email} className="cf_mapping_domain_users_container CF_flex-d-column">
                      <div className="cf_mapping_domain_users">
                        <span className="CF_d-flex">
                          <input type="checkbox" id="input_SOURCE" name="USERS_SOURCE" />
                        </span>
                        <span className="cf_mapping_domain_name CF_d-flex ai-center" style={{ gap: "5px" }}>
                          <FaRegUser />
                          {u.email?.split("@")[0]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })
            : domainsList?.map((data) => (
              <div className="cf_mapping_domain_container" key={`SRC_${data?.domainName}`}>
                <div className="cf_mapping_domain" style={{ borderBottom: "0" }}>
                  <span
                    className="CF_d-flex CF_Pointer"
                    onClick={() =>
                      setSelectedSrcDomain(
                        `SRC_${selectedSrcDomain}` === `SRC_${data?.domainName}`
                          ? ""
                          : data?.domainName
                      )
                    }
                  >
                    {`SRC_${selectedSrcDomain}` === `SRC_${data?.domainName}` ? (
                      <HiMinus className="CF_SVG_THICK" />
                    ) : (
                      <MdOutlineAdd className="CF_SVG_THICK" />
                    )}
                  </span>
                  <span className="cf_mapping_domain_name">{data?.domainName}</span>
                </div>
                {`SRC_${selectedSrcDomain}` === `SRC_${data?.domainName}` && (
                  <DomainUsersList
                    action="SOURCE"
                    domainsList={domainUsersList}
                    isLoading={isUsersLoading}
                    folderMapping={folderMapping}
                  />
                )}
              </div>
            ))}
      </div>
      <div
        className="cf_content_mapping_footer"
        style={{ gap: "10px", justifyContent: "space-between" }}
      >
        <p style={{ fontSize: "10px", fontWeight: "500" }}>
          Total: {sprawlDomains.length > 0 ? preSelectedUsers.length : pagination?.totalDocuments}
        </p>
        <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
          <p style={{ fontSize: "10px", fontWeight: "500" }}>Showing :</p>
          <select
            name="pageSize"
            onChange={(e) => console.log(e, "SOURCE")}
            value={pagination?.pageSize}
          >
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="150">150</option>
            <option value="200">200</option>
          </select>
          <p style={{ fontSize: "10px", fontWeight: "500" }}> Rows</p>
        </div>
        <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
          <p style={{ fontSize: "10px", fontWeight: "500" }}>Goto:</p>
          <select
            name="currentPage"
            onChange={(e) => console.log(e, "SOURCE")}
            value={pagination?.currentPage}
          >
            {getRandomArray(pagination?.totalPages)?.map((data) => {
              return (
                <option key={`source_${data}`} value={data}>
                  {data}
                </option>
              );
            })}
          </select>
        </div>
      </div>
    </div>
  );
};

export default SourceMapping;
