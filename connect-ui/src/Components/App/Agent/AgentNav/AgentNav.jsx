import { Menu, Plus } from "lucide-react";
import React, { useContext, useEffect, useState } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { cloudImageMapper } from "../../../helpers/helpers";
import {
  getMaxChar,
  globalDebounce,
  isSessionValid,
  notifyToast,
  clearLocalStorage,
} from "../../../helpers/utils";
import { useNavigate } from "react-router-dom";

const AgentNav = () => {
  const [navFullWidth, setNavFullWidth] = useState(false);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const navigate = useNavigate();
  const queryParams = new URLSearchParams(location.search);
  const q = queryParams.get("q");
  const name = queryParams.get("name");
  const [activeAgent, setActiveAgent] = useState({
    memberId: "",
    cloudName: "",
  });
  useEffect(() => {
    setActiveAgent({
      memberId: q,
      cloudName: name,
    });
  }, [q]);

  useEffect(() => {
    const handleMouseMove = globalDebounce(() => {
      if (isSessionValid()) {
        localStorage.setItem("time", new Date().getTime());
      } else {
        if (localStorage.time) {
          localStorage.removeItem("time");
          notifyToast("warn", "Session expired. Please login again.");
        }
        setTimeout(() => {
          clearLocalStorage();
          window.location.href = "/CloudFuze#login";
        }, 200);
      }
    }, 200);

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const updateQueryParams = (newParams) => {
    const searchParams = new URLSearchParams(window.location.search);
    Object.keys(newParams).forEach((key) => {
      searchParams.set(key, newParams[key]);
    });

    navigate({
      search: searchParams.toString(),
    });
  };
  return (
    <div
      className={`cf_sideNav ${
        navFullWidth ? `cf_sideNavFull` : `cf_sideNavMini`
      }`}
    >
      <div className="cf_agentMenuToggler">
        <div onClick={() => setNavFullWidth(!navFullWidth)}>
          <Menu size={20} color="#fff" strokeWidth={2} />
        </div>
      </div>
      <div
        className={`cf_agentAddOption ${
          navFullWidth ? `cf_agentMenuAddOptionFull` : `cf_agentMenuAddOption`
        }
        `}
      >
        {navFullWidth ? (
          <div
            className="cf_agentAddOptionFull"
            onClick={() => setNavFullWidth(!navFullWidth)}
          >
            <div>
              <Plus size={20} color="#fff" strokeWidth={2} />
            </div>
            <p>Add Cloud</p>
          </div>
        ) : (
          <div className="cf_agentAddOption">
            <Plus size={20} color="#fff" strokeWidth={2} />
          </div>
        )}
      </div>
      <div className="cf_agentCloudList">
        {cloudsList?.map((data, index) => {
          return data?.providerName ? (
            !navFullWidth && index < 10 ? (
              <div
                key={data?.id}
                className={`cf_agentCloudSelector`}
                onClick={() => {
                  updateQueryParams({
                    q: data?.memberId,
                    name: data?.providerName,
                  });
                }}
              >
                <div
                  className={`cf_agentCloudSelector_Image_Wrapper ${
                    activeAgent?.memberId === data?.memberId &&
                    activeAgent?.cloudName === data?.providerName
                      ? "cf_agentCloudSelectorSmallActive"
                      : ""
                  }`}
                >
                  <img
                    src={cloudImageMapper(data?.providerName)}
                    alt={data?.providerName}
                  />
                </div>
              </div>
            ) : navFullWidth ? (
              <div
                key={data?.id}
                className={`cf_agentCloudSelector cf_agentCloudSelectorOpen cf_agentCloudActive ${
                  activeAgent?.memberId === data?.memberId &&
                  activeAgent?.cloudName === data?.providerName
                    ? "cf_agentCloudSelectorOpenActive"
                    : ""
                }`}
                onClick={() => {
                  updateQueryParams({
                    q: data?.memberId,
                    name: data?.providerName,
                  });
                }}
              >
                <div className="cf_agentCloudSelector_Image_Wrapper">
                  <img
                    src={cloudImageMapper(data?.providerName)}
                    alt={data?.providerName}
                  />
                </div>
                <p>{getMaxChar(data?.adminEmail, 25)}</p>
              </div>
            ) : (
              ""
            )
          ) : (
            ""
          );
        })}
      </div>
    </div>
  );
};

export default AgentNav;
