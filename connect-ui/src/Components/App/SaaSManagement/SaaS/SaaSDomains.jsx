import React, { useContext, useEffect, useState } from "react";
import { MdVerified } from "react-icons/md";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import { getVendorDomains } from "../SaaSActions/SaaSActions";

const SaaSDomains = () => {
  const [isLoading, setIsLoading] = useState(true);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [domainsList, setDomainsList] = useState([]);
  const { adminEmail, memberId, providerName } = {
    ...globalContext?.saasCloud,
  };

  useEffect(() => {
    setIsLoading(true);
    setDomainsList([]);
    fetchDomains();
  }, [providerName]);

  const fetchDomains = async () => {
    let res = await getVendorDomains(memberId, providerName);
    if (res?.status === "OK" && res?.res) {
      // setDomainsList(res?.res);
      reOrderDomains(res?.res);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const reOrderDomains = (domains) => {
    let copyDomains = [...domains];
    const lastIndex = copyDomains.length - 1;

    let primaryDomainFound = false;

    for (let i = 0; i < copyDomains.length; i++) {
      const data = copyDomains[i];

      if (data?.primary) {
        if (i !== 0) {
          [copyDomains[0], copyDomains[i]] = [copyDomains[i], copyDomains[0]];
        }
        primaryDomainFound = true;
        break;
      }
    }

    if (primaryDomainFound) {
      for (let i = 0; i < copyDomains.length; i++) {
        const data = copyDomains[i];

        if (
          data?.name?.includes("onmicrosoft.com") ||
          data?.name?.includes("test-google-a.com")
        ) {
          [copyDomains[i], copyDomains[lastIndex]] = [
            copyDomains[lastIndex],
            copyDomains[i],
          ];
        }
      }
    }
    setDomainsList(copyDomains);
  };

  return (
    <div className="cf_main_container">
      <SideNav activeTab="SaaS Management" />
      <div className="cf_main_content_place">
        <TopNav pageName="Domain Management" backLink="/SaaSManagement/Menu" />
        <div
          className="cf_main_content_place_main cf_saas_options_contatiner"
          style={{ padding: "20px 0 20px 0" }}
        >
          <div className="cf_licenses_container_table">
            <div className="cf_licenses_container_table_header">
              <span>Total Domains: {domainsList?.length}</span>
            </div>
            <table className="cf_licenses_table">
              <thead>
                <tr>
                  <th style={{ width: "35%" }}>Domain</th>
                  <th style={{ width: "15%" }}>Type</th>
                  {providerName === "GOOGLE_WORKSPACE" ||
                  providerName === "MICROSOFT_TEAMS" ||
                  providerName === "MICROSOFT_OFFICE_365" ? (
                    <>
                      <th style={{ width: "15%" }}>Mail Enabled </th>
                      <th style={{ width: "10%" }}>Status</th>
                      <th style={{ width: "25%" }}></th>
                    </>
                  ) : (
                    ""
                  )}
                  {/* <th></th> */}
                </tr>
              </thead>
              <tbody>
                {domainsList?.map((data) => {
                  return (
                    <tr key={data?.name}>
                      <td>{data?.name}</td>
                      <td>
                        {data?.name?.indexOf("onmicrosoft.com") >= 0 ? (
                          "Test domain alias"
                        ) : data?.primary ? (
                          <span className="fw-600">Primary Domain</span>
                        ) : (
                          "Secondary Domain"
                        )}
                      </td>
                      {providerName === "GOOGLE_WORKSPACE" ||
                      providerName === "MICROSOFT_TEAMS" ||
                      providerName === "MICROSOFT_OFFICE_365" ? (
                        <>
                          <td>{data?.mailEnabled ? "True" : "False"}</td>
                          <td>
                            {data?.verified ? (
                              <MdVerified className="cf_verifIcon" />
                            ) : (
                              ""
                            )}
                          </td>
                          <td>
                            <div className="CF_d-flex" style={{ gap: "15px" }}>
                              {data?.verified ? (
                                data?.primary ? (
                                  ""
                                ) : (
                                  <>
                                    {/* <span
                                  className="cf_make_link"
                                  onClick={() =>
                                    console.log(data, "deactivate")
                                  }
                                >
                                  Deactivate
                                </span>
                                <span
                                  className="cf_make_link"
                                  onClick={() => console.log(data, "")}
                                >
                                  Set as primary
                                </span> */}
                                  </>
                                )
                              ) : (
                                ""
                              )}
                            </div>
                          </td>
                        </>
                      ) : (
                        ""
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {isLoading ? getCFTextLoader() : ""}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaaSDomains;
