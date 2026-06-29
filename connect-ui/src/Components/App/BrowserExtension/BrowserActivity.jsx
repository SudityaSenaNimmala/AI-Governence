import { Globe, RefreshCcw } from "lucide-react";
import { cloudImageMapper, formatDateNew } from "../../helpers/helpers";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import "./css/BrowserExtension.css";
import { getBrowserActivity } from "../SaaSManagement/SaaSActions/SaaSActions";
import { useEffect, useRef, useState } from "react";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getMaxChar } from "../../helpers/utils";

const BrowserActivity = () => {
  const [browserActivity, setBrowserActivity] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSelectedItem, setCurrentSelectedItem] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [pageNo, setPageNo] = useState(1);
  const loaderRef = useRef(null);
  const [searchInput, setSearchInput] = useState("");

  useEffect(() => {
    getActivityFeed();
  }, [pageNo]);

  const getActivityFeed = async (
    pgNo = pageNo,
    pageSize = 500,
    searchInput = null
  ) => {
    if (pgNo === 1) {
      setBrowserActivity([]);
    }
    setIsLoading(true);
    let res = await getBrowserActivity(pgNo, pageSize, searchInput);
    if (res?.status === "OK") {
      if (pageNo === 1) {
        setBrowserActivity(res?.res);
      } else {
        setBrowserActivity((prev) => (prev = [...prev, ...res?.res]));
      }
      setIsLoading(false);
      setHasMore(res?.res?.length === pageSize);
      setPageNo(res?.res?.length === pageSize ? pgNo + 1 : pgNo);
    } else {
      setIsLoading(false);
      setHasMore(false);
    }
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (
          target.isIntersecting &&
          hasMore &&
          !isLoading &&
          browserActivity?.length > 0
        ) {
          getActivityFeed(pageNo);
        }
      },
      { threshold: 1.0 }
    );

    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoading, pageNo]);

  const searchDebounce = useRef(null);

  const searchUsersList = async (e) => {
    setSearchInput(e);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        // getActivityFeed(1, 100, e);
      }, 500);
    } else {
      getActivityFeed(1, 100, null);
    }
  };

  return (
    <div className="cf_main_container">
      <SideNav activeTab="Browser Activity" />
      <div className="cf_main_content_place">
        <TopNav pageName="Browser Activity" />
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
        >
          <div
            className="cf_saas_options"
            style={{ marginTop: "10px", height: "40px" }}
          >
            <SearchComponent
              autoOpen={true}
              boxShadows={true}
              inputName="searchInput"
              customStyles={{ width: "350px", height: "40px" }}
              customButtonStyles={{
                background: "transparent",
                color: "rgb(255, 255, 255)",
                fontWeight: "bolder",
                height: "35px",
              }}
              inputPlaceHolder={`Search By User Email`}
              onInputSearch={(e) => searchUsersList(e.searchInput)}
            />
            <span style={{ marginLeft: "auto" }}></span>
            <ActionButton
              customClass={`changeButtonColorOnHover`}
              customStyles={{
                backgroundColor: "#f2f2f2",
                height: "35px",
                width: "35px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              buttonType="button"
              buttonClickAction={() => {
                setBrowserActivity([]);
                getActivityFeed(1, 100, null);
              }}
            >
              <RefreshCcw size={16} />
            </ActionButton>
          </div>
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{
              padding: "10px 0",
              flexDirection: "column",
              height: "calc(100vh - 130px)",
              gap: "20px",
            }}
          >
            {browserActivity?.map((item, ind) => (
              <div
                className="cf_browser_activity_card"
                key={item?.id}
                style={
                  item?.oauth
                    ? {
                      border: "1px solid #ff4c4c",
                      animationDelay: `${ind * 0.02}s`,
                    }
                    : {
                      animationDelay: `${ind * 0.02}s`,
                    }
                }
              >
                {item?.oauth ? (
                  <p className="cf_browser_activity_card_title">
                    oAuth Activity
                  </p>
                ) : (
                  ""
                )}
                <div className="cf_browser_activity_card_header">
                  <div className="cf_browser_activity_card_header_image">
                    <img
                      src={cloudImageMapper(
                        item?.browserName
                          ? item?.browserName === "UNKNOWN"
                            ? "BROWSER"
                            : item?.browserName
                          : "BROWSER"
                      )}
                      alt=""
                    />
                  </div>
                  <div className="cf_browser_activity_card_header_content">
                    <p title={item?.title}>
                      {getMaxChar(item?.title, 60)}&nbsp;
                      <span
                        style={{
                          fontSize: "12px",
                          color: "#64748b",
                          fontWeight: "500",
                        }}
                      >
                        ({getMaxChar(item?.host, 60)})
                      </span>
                    </p>
                    <p>{item?.userEmail}</p>
                  </div>
                  <span style={{ marginLeft: "auto" }}></span>
                  <div className="cf_browser_activity_card_header_content2">
                    {item?.openTime ? (
                      <p>
                        Opened On: {new Date(item?.openTime).toLocaleString()}
                      </p>
                    ) : (
                      ""
                    )}
                    {item?.closeTime ? (
                      <p>
                        Closed On: {new Date(item?.closeTime).toLocaleString()}
                      </p>
                    ) : (
                      ""
                    )}
                  </div>
                  <div className="cf_browser_activity_card_header_image">
                    <img
                      src={cloudImageMapper(
                        item?.osType
                          ? item?.osType === "UNKNOWN"
                            ? "BROWSER"
                            : item?.osType
                          : "UNKNOWN"
                      )}
                      alt=""
                    />
                  </div>
                </div>
                <div className="cf_browser_activity_card_body">
                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                    }}
                  >
                    <p
                      style={{
                        width: "fit-content",
                      }}
                    >
                      Pages Visited:
                    </p>
                    {item?.oauthProvider ? (
                      <p
                        style={{
                          marginLeft: "auto",
                          width: "fit-content",
                        }}
                      >
                        oAuth Provider:{" "}
                        <span style={{ color: "#0062ff", fontWeight: "500" }}>
                          {item?.oauthProvider}
                        </span>
                      </p>
                    ) : (
                      ""
                    )}
                  </div>
                  <div className="cf_browser_activity_card_body_pages">
                    {item?.listOfVisitedUrls?.map((url, index) => {
                      return currentSelectedItem?.id === item?.id ? (
                        <div
                          key={`${index}-${item?.id}`}
                          style={{ animationDelay: `${index * 0.03}s` }}
                        >
                          <Globe size={14} />
                          <code>{url?.split("?")[0]}</code>
                        </div>
                      ) : index < 3 ? (
                        <div
                          key={`${index}-${item?.id}`}
                          style={{ animationDelay: `${index * 0.03}s` }}
                        >
                          <Globe size={14} />
                          <code>{url?.split("?")[0]}</code>
                        </div>
                      ) : index === 3 ? (
                        <div
                          style={{
                            backgroundColor: "transparent",
                            width: "100%",
                            animationDelay: `${index * 0.03}s`,
                          }}
                        >
                          <span style={{ marginLeft: "auto" }}></span>
                          <p
                            className="cf_make_link"
                            style={{ width: "fit-content" }}
                            onClick={() => setCurrentSelectedItem(item)}
                          >
                            +{item?.listOfVisitedUrls?.length - 3} More
                          </p>
                        </div>
                      ) : (
                        ""
                      );
                    })}
                    {currentSelectedItem?.id === item?.id ? (
                      <div
                        style={{
                          backgroundColor: "transparent",
                          width: "100%",
                        }}
                      >
                        <span style={{ marginLeft: "auto" }}></span>
                        <p
                          className="cf_make_link"
                          style={{ width: "fit-content" }}
                          onClick={() => setCurrentSelectedItem(null)}
                        >
                          - Back
                        </p>
                      </div>
                    ) : (
                      ""
                    )}
                  </div>
                </div>
              </div>
            ))}
            {browserActivity?.length > 0 && !isLoading ? (
              <div ref={loaderRef} style={{ height: "10px" }}>
                <span style={{ visibility: "hidden" }}>aaaa</span>
              </div>
            ) : (
              ""
            )}
            {isLoading ? getCFTextLoader() : ""}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrowserActivity;
