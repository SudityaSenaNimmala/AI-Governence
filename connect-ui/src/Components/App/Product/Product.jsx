import React, { useEffect, useState } from "react";
import "./css/Product.css";
import {
  cloudImageMapper,
  getCloudName,
  integrationsList,
} from "../../helpers/helpers";
import SelectDropDown from "../../Resuables/SelectDropDown/SelectDropDown";
import productDetails from "./productFeatures.json";
import { GoDotFill } from "react-icons/go";
import { FaChevronDown, FaChevronRight } from "react-icons/fa6";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";

const Product = () => {
  const [activeFeature, setActiveFeature] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedSourceList, setSelectedSourceList] = useState([]);
  const [selectedProductFeatures, setSelectedProductFeatures] = useState({});
  const [searchFeature, setSearchFeature] = useState("");
  const [filters, setFilters] = useState({
    source: "",
    destination: "",
  });

  const getSelectedVal = (cloudData) => {
    setSelectedSourceList([]);
    setSelectedProduct(cloudData?.cloudName);
  };

  useEffect(() => {
    if (selectedProduct) {
      setSelectedSourceList();
      let pushVal = [];
      integrationsList()
        ?.filter((data) => data?.type === selectedProduct)
        ?.map((data) => {
          return pushVal.push({
            imageSrc: cloudImageMapper(data?.cloudName),
            cloudName: data?.cloudName,
            displayName: getCloudName(data?.cloudName),
          });
        });
      setSelectedSourceList(pushVal);
    }
  }, [selectedProduct]);

  const productSelect = (action, val) => {
    setFilters({ ...filters, [action]: val?.cloudName });
  };

  useEffect(() => {
    if (filters?.source && filters?.destination) {
      setSelectedProductFeatures(
        productDetails[`${filters?.source}-${filters?.destination}`]
      );
    }
  }, [filters]);

  // let objectN = [];
  // table_1.querySelectorAll("tr").forEach((data, index) => {
  //   objectN.push({
  //     note: "",
  //     status: "DONE",
  //     id: `S2C_${111 + index}`,
  //     releaseDate: "15-07-2024",
  //     lastModified: "26-07-2024",
  //     title: data.children[0].innerText,
  //     description: data.children[1].innerText,
  //   });
  // });
  return (
    <div className="cf_product_container">
      <div className="cf_product_topNav_div">
        <div className="cf_product_topNav">
          <ul>
            <li>
              <img src={cloudImageMapper("CLOUDFUZE")} alt="CLOUDFUZE" />
            </li>
          </ul>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "calc(100% - 180px)",
            }}
          >
            <h2
              style={{
                fontSize: "26px",
                fontWeight: "600",
                marginTop: "10px",
              }}
            >
              CloudFuze Products & Features
            </h2>
          </div>
        </div>
        <div className="cf_product_selection">
          {/* <div className="cf_product_title">
            <span></span>
          </div> */}
          <div className="cf_product_listing_body">
            <div
              className="cf_select_product cf_product_title"
              style={{ width: "fit-content" }}
            >
              <span>Select Product :</span>
            </div>
            <div className="cf_select_product">
              <SelectDropDown
                onSelect={(e) => getSelectedVal(e)}
                placeHolder="Select Product"
                dropDownContent={[
                  {
                    imageSrc: "",
                    cloudName: "DATA",
                    displayName: "Content",
                  },
                  {
                    imageSrc: "",
                    cloudName: "MESSAGE",
                    displayName: "Collaborations",
                  },
                  {
                    imageSrc: "",
                    cloudName: "EMAIL",
                    displayName: "Email",
                  },
                  {
                    imageSrc: "",
                    cloudName: "BOARDS",
                    displayName: "Canvas",
                  },
                ]}
              />
            </div>
            <div className="cf_select_product">
              <SelectDropDown
                onSelect={(e) => productSelect("source", e)}
                placeHolder="Select Source"
                dropDownContent={selectedSourceList}
              />
            </div>
            <div className="cf_select_product">
              <SelectDropDown
                onSelect={(e) => productSelect("destination", e)}
                placeHolder="Select Destination"
                dropDownContent={selectedSourceList}
              />
            </div>
          </div>
        </div>
      </div>
      {selectedProductFeatures?.features ? (
        <div className="cf_product_content_div">
          <div className="cf_product_features_content_div">
            <div style={{ fontSize: "14px", fontWeight: "500" }}>Features</div>
            {selectedProductFeatures?.features?.map((data) => {
              return (
                <div className="cf_product_features_list">
                  <div>
                    <GoDotFill style={{ color: "green" }} />
                  </div>
                  <div>{data}</div>
                </div>
              );
            })}
          </div>
          <div className="cf_product_enhancements_div">
            <div
              className="cf_product_enhancements_content"
              style={{ background: "transparent", padding: "0" }}
            >
              <SearchComponent
                autoOpen={true}
                boxShadows={true}
                inputName="searchInput"
                inputPlaceHolder={`Search By feature ID or Title`}
                onInputSearch={(e) => setSearchFeature(e?.searchInput)}
              />
            </div>
            {selectedProductFeatures?.enhancements
              ?.filter((data) => {
                if (
                  data?.title
                    ?.toLocaleLowerCase()
                    ?.indexOf(searchFeature?.toLocaleLowerCase()) >= 0 ||
                  data?.id
                    ?.toLocaleLowerCase()
                    ?.indexOf(searchFeature?.toLocaleLowerCase()) >= 0
                ) {
                  return data;
                } else {
                  return "";
                }
              })
              ?.map((data, mapIndex) => {
                return (
                  <div
                    className={`cf_product_enhancements_content ${
                      activeFeature === data?.id
                        ? "cf_product_enhancements_content_h-120"
                        : ""
                    }`}
                  >
                    <div className="cf_product_enhancements_content_title">
                      <div
                        className="cf_product_enhancements_content_title_action CF_Pointer"
                        onClick={() =>
                          setActiveFeature(
                            activeFeature === data?.id ? "" : data?.id
                          )
                        }
                      >
                        {activeFeature === data?.id ? (
                          <FaChevronDown />
                        ) : (
                          <FaChevronRight />
                        )}
                      </div>
                      <div
                        className="cf_product_enhancements_content_title_action"
                        title={`${
                          data?.status === "DONE"
                            ? "Available In Production"
                            : ""
                        } ${data?.status === "DEV" ? "In Development" : ""} ${
                          data?.status === "IN_QUEUE" ? "In Pipline" : ""
                        }`}
                      >
                        <GoDotFill
                          style={{
                            color: ` ${
                              data?.status === "DONE" ? "green" : ""
                            } ${data?.status === "IN_QUEUE" ? "red" : ""} ${
                              data?.status === "DEV" ? "#0062ff" : ""
                            }`,
                            fontSize: "14px",
                          }}
                        />
                      </div>
                      <div className="cf_product_enhancements_content_title_content">
                        {data?.title}
                        <span
                          className="cf_title_tagging"
                          style={{
                            color: ` ${
                              data?.tag === "Existing" ? "green" : ""
                            } ${data?.tag === "Roadmap" ? "red" : ""} ${
                              data?.tag === "New" ? "#0062ff" : ""
                            }`,
                          }}
                        >
                          [{data?.tag}]
                        </span>
                      </div>
                      <div
                        style={{
                          marginLeft: "auto",
                          fontWeight: "500",
                          fontSize: "12px",
                        }}
                      >
                        {data?.status === "DONE"
                          ? `Released On: ${data?.releaseDate}`
                          : ""}
                        {data?.status === "DEV"
                          ? `Available On: ${data?.releaseDate}`
                          : ""}
                        {data?.status === "IN_QUEUE"
                          ? `Available On: ${data?.releaseDate}`
                          : ""}
                      </div>
                    </div>
                    {activeFeature === data?.id ? (
                      <>
                        <div className="cf_product_enhancements_content_body">
                          <div>
                            <span style={{ fontWeight: "600" }}>
                              Feature Description:
                            </span>
                            <span>&nbsp;{data?.description}</span>
                          </div>
                          <div
                            style={{ marginTop: "10px", paddingBottom: "10px" }}
                          >
                            <div>
                              <span style={{ fontWeight: "600" }}>
                                Enhancement:
                              </span>
                              <span>&nbsp;NA</span>
                            </div>
                            <div>
                              <span style={{ fontWeight: "600" }}>
                                Feature ID:
                              </span>
                              <span>&nbsp;{data?.id}</span>
                            </div>
                            <div>
                              <span style={{ fontWeight: "600" }}>
                                Last modified:
                              </span>
                              <span>&nbsp;{data?.lastModified}</span>
                            </div>
                            <div>
                              <span style={{ fontWeight: "600" }}>Notes:</span>
                              <span>&nbsp;NA</span>
                            </div>
                          </div>
                        </div>
                        <div
                          style={{ marginLeft: "auto", paddingBottom: "10px" }}
                        >
                          <div>
                            <span
                              style={{
                                fontWeight: "600",
                                textDecoration: "underline",
                              }}
                            >
                              Functionality Present in -
                            </span>
                            <ul style={{ marginLeft: "15px" }}>
                              <li style={{ fontSize: "12px" }}>
                                <span style={{ fontWeight: "600" }}>
                                  Slack To Teams
                                </span>
                                <span>: Yes</span>
                              </li>
                              <li style={{ fontSize: "12px" }}>
                                <span style={{ fontWeight: "600" }}>
                                  Slack To Chat
                                </span>
                                <span>: Yes</span>
                              </li>
                              <li style={{ fontSize: "12px" }}>
                                <span style={{ fontWeight: "600" }}>
                                  Teams To Chat
                                </span>
                                <span>: No</span>
                              </li>
                              <li style={{ fontSize: "12px" }}>
                                <span style={{ fontWeight: "600" }}>
                                  Chat To Teams
                                </span>
                                <span>: No</span>
                              </li>
                            </ul>
                          </div>
                        </div>
                      </>
                    ) : (
                      ""
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ) : (
        ""
      )}
    </div>
  );
};

export default Product;

// let objectN = [];
// table_1.querySelectorAll("tr").forEach((data, index) => {
//   objectN.push({
//   tag: index < 25 ? "Existing": index < 35 ? "New" : "Roadmap",
//     note: "",
//     status: index < 25 ? "DONE": index < 35 ? "DEV" : "IN_QUEUE",
//     id: `S2C_${110 + index}`,
//     releaseDate: index < 25 ? "15/07/2024": index < 35 ? "31/07/2024" : "14/08/2024",
//     lastModified: "26/07/2024",
//     title: data.children[0].innerText,
//     description: data.children[1].innerText,
//   });
// });
