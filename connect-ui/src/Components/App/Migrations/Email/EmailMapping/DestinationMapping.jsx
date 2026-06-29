import React, { useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { cloudImageMapper, getRandomArray } from "../../../../helpers/helpers";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import { MdOutlineAdd } from "react-icons/md";
import { FaRegUser } from "react-icons/fa6";
import { HiMinus } from "react-icons/hi";
import {
  createPermissionMapping,
  getDomainsList,
  getDomainsSearchList,
  getDomainUsersList,
  getSearchUserByDomain,
} from "../ContentActions/ContentActions";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import DomainUsersList from "./DomainFolderSelection/DomainUsersList";

const DestinationMapping = () => {
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
  const [userSuggestionsList, setUserSuggestionsList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [paginationDestination, setPaginationDestination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [domainUsersList, setDomainUserList] = useState([]);
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [folderMapping, setFolderMapping] = useState(true);
  const [selectedDstnDomain, setSelectedDstnDomain] = useState("");
  // useEffect(() => {
  //   getDomains();
  // }, []);

  const getDomains = async (
    pageNo = paginationDestination?.currentPage,
    pageSize = paginationDestination?.pageSize
  ) => {
    setIsLoading(true);
    let list = await getDomainsList(pageNo, pageSize, "DESTINATION");
    if (list?.status === "OK") {
      if (pageNo === 1 && pageSize === 50) {
        setPaginationDestination({
          ...paginationDestination,
          totalPages: Math.ceil(
            list?.res[0]?.noOfDomainsPresent / paginationDestination?.pageSize
          ),
          currentPage: pageNo,
          totalDocuments: list?.res[0]?.noOfDomainsPresent,
        });
      }
    }
    setDomainsList(list?.res ?? []);
    let data = await createPermissionMapping();
    setIsLoading(false);
  };

  // useEffect(() => {
  //   if (selectedDstnDomain) {
  //     if (userSuggestionsList?.length === 0) {
  //       getDomainUsers();
  //       setDomainUserList([]);
  //     }
  //   }
  // }, [selectedDstnDomain]);

  const getDomainUsers = async () => {
    setIsUsersLoading(true);
    let list = await getDomainUsersList(
      1,
      50,
      "DESTINATION",
      selectedDstnDomain
    );
    setDomainUserList(list?.res);
    setIsUsersLoading(false);
  };

  // useEffect(() => {
  //   if (globalContext?.sourceCloud?.cloudName === "GOOGLE_SHARED_DRIVES") {
  //     setFolderMapping(false);
  //   }
  // }, [globalContext?.sourceCloud?.cloudName]);

  let searchDebounce;
  const searchSourceUserList = async (e) => {
    let inputString = e?.searchInput;
    if (userSuggestionsList?.includes(inputString)) {
      let getUser = await getSearchUserByDomain(
        inputString,
        "DESTINATION",
        1,
        20
      );
      if (getUser?.status === "OK") {
        setDomainsList(getUser?.res);
        setIsUsersLoading(false);
        setSelectedDstnDomain(getUser?.res[0]?.domainName);
        setDomainUserList(getUser?.res[0]);
      }

      return;
    }
    if (searchDebounce) {
      clearInterval(searchDebounce);
    }
    searchDebounce = setTimeout(async () => {
      if (inputString?.length > 2) {
        let res = await getDomainsSearchList(inputString, "DESTINATION", 1, 20);
        if (res?.status === "OK") {
          setUserSuggestionsList(res?.res);
        }
      } else if (inputString?.length === 0) {
        setSelectedDstnDomain("");
        setUserSuggestionsList([]);
        setDomainUserList([]);
        getDomainUsers();
      }
    }, 500);
  };

  const handlePaginationChange = (e, target) => {
    let { name, value } = e.target;
    if (name === "pageSize") {
      let count = paginationDestination?.totalDocuments;
      setPaginationDestination({
        ...paginationDestination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
      getDomains(1, +value);
    } else {
      setPaginationDestination({
        ...paginationDestination,
        currentPage: +value,
      });
      getDomains(+value, paginationDestination?.pageSize);
    }
  };

  

  return (
    <div className="cf_content_source_selection">
      <div className="cf_content_mapping_title">
        <div className="cf_content_mapping_title_image">
          <img
            src={cloudImageMapper("GMAIL")}
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
              const isOpen = selectedDstnDomain === group.domainName;
              return (
                <div className="cf_mapping_domain_container" key={`DSTN_${group.domainName}`}>
                  <div className="cf_mapping_domain" style={{ borderBottom: "0" }}>
                    <span
                      className="CF_d-flex CF_Pointer"
                      onClick={() => setSelectedDstnDomain(isOpen ? "" : group.domainName)}
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
                          <input type="radio" name="USERS_DESTINATION" />
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
              <div className="cf_mapping_domain_container" key={`DSTN_${data?.domainName}`}>
                <div className="cf_mapping_domain" style={{ borderBottom: "0" }}>
                  <span
                    className="CF_d-flex CF_Pointer"
                    onClick={() =>
                      setSelectedDstnDomain(
                        `DSTN_${selectedDstnDomain}` === `DSTN_${data?.domainName}`
                          ? ""
                          : data?.domainName
                      )
                    }
                  >
                    {`DSTN_${selectedDstnDomain}` === `DSTN_${data?.domainName}` ? (
                      <HiMinus className="CF_SVG_THICK" />
                    ) : (
                      <MdOutlineAdd className="CF_SVG_THICK" />
                    )}
                  </span>
                  <span className="cf_mapping_domain_name">{data?.domainName}</span>
                </div>
                {`DSTN_${selectedDstnDomain}` === `DSTN_${data?.domainName}` && (
                  <DomainUsersList
                    action="DESTINATION"
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
          Total: {sprawlDomains.length > 0 ? preSelectedUsers.length : paginationDestination?.totalDocuments}
        </p>
        <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
          <p style={{ fontSize: "10px", fontWeight: "500" }}>Showing :</p>
          <select
            name="pageSize"
            onChange={(e) => handlePaginationChange(e, "SOURCE")}
            value={paginationDestination?.pageSize}
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
            value={paginationDestination?.currentPage}
          >
            {getRandomArray(paginationDestination?.totalPages)?.map((data) => {
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

export default DestinationMapping;
