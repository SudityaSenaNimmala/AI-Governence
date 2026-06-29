import React, { useContext, useEffect, useState } from "react";
import { MdOutlineAdd } from "react-icons/md";
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
  const [domainsList, setDomainsList] = useState([]);
  const { globalContext } = useContext(GlobalContext);
  const [domainUsersList, setDomainUsersList] = useState([]);
  const [userSuggestionsList, setUserSuggestionsList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [folderMapping, setFolderMapping] = useState(true);
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [selectedSrcDomain, setSelectedSrcDomain] = useState("");
  useEffect(() => {
    getDomains();
  }, []);
  const getDomains = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize
  ) => {
    setIsLoading(true);
    let list = await getDomainsList(pageNo, pageSize, "SOURCE");
    if (list?.status === "OK") {
      if (pageNo === 1 && pageSize === 50) {
        setPagination({
          ...pagination,
          totalPages: Math.ceil(list?.res[0]?.noOfDomainsPresent / 50),
          currentPage: pageNo,
          totalDocuments: list?.res[0]?.noOfDomainsPresent,
        });
      }
    }
    setDomainsList(list?.res ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    if (selectedSrcDomain) {
      if (userSuggestionsList?.length === 0) {
        setDomainUsersList([]);
        getDomainUsers();
      }
    }
  }, [selectedSrcDomain]);

  const getDomainUsers = async () => {
    setIsUsersLoading(true);
    let list = await getDomainUsersList(1, 50, "SOURCE", selectedSrcDomain);
    setDomainUsersList(list?.res);
    setIsUsersLoading(false);
  };

  useEffect(() => {
    if (globalContext?.sourceCloud?.cloudName === "GOOGLE_SHARED_DRIVES") {
      setFolderMapping(false);
    }
  }, [globalContext?.sourceCloud?.cloudName]);

  let searchDebounce;
  const searchSourceUserList = async (e) => {
    let inputString = e?.searchInput;
    if (userSuggestionsList?.includes(inputString)) {
      let getUser = await getSearchUserByDomain(inputString, "SOURCE", 1, 20);
      if (getUser?.status === "OK") {
        setDomainsList(getUser?.res);
        setIsUsersLoading(false);
        setSelectedSrcDomain(getUser?.res[0]?.domainName);
        setDomainUsersList(getUser?.res[0]);
      }

      return;
    }
    if (searchDebounce) {
      clearInterval(searchDebounce);
    }
    searchDebounce = setTimeout(async () => {
      if (inputString?.length > 2) {
        let res = await getDomainsSearchList(inputString, "SOURCE", 1, 20);
        if (res?.status === "OK") {
          setUserSuggestionsList(res?.res);
        }
      } else if (inputString?.length === 0) {
        setSelectedSrcDomain("");
        setUserSuggestionsList([]);
        setDomainUsersList([]);
        getDomains();
      }
    }, 500);
  };

  const handlePaginationChange = (e, target) => {
    let { name, value } = e.target;
    if (name === "pageSize") {
      let count = pagination?.totalDocuments;
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
      getDomains(1, +value);
    } else {
      setPagination({
        ...pagination,
        currentPage: +value,
      });
      getDomains(+value, pagination?.pageSize);
    }
  };

  return (
    <div className="cf_content_source_selection">
      <div className="cf_content_mapping_title">
        <div className="cf_content_mapping_title_image">
          <img
            src={cloudImageMapper(globalContext?.sourceCloud?.cloudName)}
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
            onInputSearch={(e) => searchSourceUserList(e)}
          />
        </div>
      </div>
      <div
        className="cf_content_mapping_body"
        style={{ height: "calc(100% - 80px)" }}
      >
        {isLoading
          ? getRandomArray(5)?.map((data, index) => {
              return (
                <div className="cf_mapping_domain" key={`Num-${index}`}>
                  <span className="CF_d-flex CF_Pointer">
                    <MdOutlineAdd className="CF_SVG_THICK skeleton" />
                  </span>
                  <span className="cf_mapping_domain_name skeletonData">
                    cloudfuze.co
                  </span>
                </div>
              );
            })
          : domainsList?.map((data) => {
              return (
                <>
                  <div
                    className="cf_mapping_domain_container"
                    key={`SRC_${data?.domainName}`}
                  >
                    <div
                      className="cf_mapping_domain"
                      style={{ borderBottom: "0" }}
                    >
                      <span
                        className="CF_d-flex CF_Pointer"
                        onClick={() =>
                          setSelectedSrcDomain(
                            `SRC_${selectedSrcDomain}` ===
                              `SRC_${data?.domainName}`
                              ? ""
                              : data?.domainName
                          )
                        }
                      >
                        {`SRC_${selectedSrcDomain}` ===
                        `SRC_${data?.domainName}` ? (
                          <HiMinus className="CF_SVG_THICK" />
                        ) : (
                          <MdOutlineAdd className="CF_SVG_THICK" />
                        )}
                      </span>
                      <span className="cf_mapping_domain_name">
                        {data?.domainName}
                      </span>
                    </div>
                    {`SRC_${selectedSrcDomain}` ===
                    `SRC_${data?.domainName}` ? (
                      <DomainUsersList
                        action="SOURCE"
                        domainsList={domainUsersList}
                        isLoading={isUsersLoading}
                        folderMapping={folderMapping}
                      />
                    ) : (
                      ""
                    )}
                  </div>
                </>
              );
            })}
      </div>
      <div
        className="cf_content_mapping_footer"
        style={{ gap: "10px", justifyContent: "space-between" }}
      >
        <p style={{ fontSize: "10px", fontWeight: "500" }}>
          Total: {pagination?.totalDocuments}
        </p>
        <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
          <p style={{ fontSize: "10px", fontWeight: "500" }}>Showing :</p>
          <select
            name="pageSize"
            onChange={(e) => handlePaginationChange(e, "SOURCE")}
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
            onChange={(e) => handlePaginationChange(e, "SOURCE")}
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
