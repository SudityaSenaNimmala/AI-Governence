import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./css/Login.css";
import LoginInfo from "./LoginInfo";
import DomainSelector from "./DomainSelector";
import LoginForm from "./LoginForm";
import CF_LOGO from "../../../assets/images/CF_LOGO.png";
import { checkDomainExist } from "./AuthActions/AuthActions";
import { cloudImageMapper, isChristmasSeason } from "../../helpers/helpers";

const Login = () => {
  const navigation = useNavigate();
  const [searchParams] = useSearchParams();
  const navigateTo = searchParams.get("navigateTo");
  const state = searchParams.get("state");
  const addCloud = searchParams.get("addCloud");
  const code = searchParams.get("code");
  const [currentView, setCurrentView] = useState("");
  const [domain, setDomain] = useState("");
  const [domainValidated, setDomainValidated] = useState(false);
  const [validateStatus, setValidateStatus] = useState(
    "Please wait while we validate your domain"
  );
  const [placerDimensions, setPlacerDimensions] = useState({
    width: "80%",
    height: "45%",
  });

  const changeViewState = (view) => {
    setCurrentView(view);
  };

  useEffect(() => {
    if (window.location.host.includes("localhost")) {
      setDomainValidated(true);
    } else if (window.location.host === "cloudfuzehost.com") {
      setDomainValidated(true);
    } else if (!document.referrer) {
      setDomainValidated(false);
      checkForDomainValidation();
    } else if (document.referrer.includes("cloudfuzehost.com")) {
      setDomainValidated(true);
    } else {
      setDomainValidated(false);
      checkForDomainValidation();
    }
  }, []);

  useEffect(() => {
    if (
      !navigateTo &&
      !state &&
      !code &&
      window.location.host.split(".")?.length > 2
    ) {
      navigation(`#login`);
    }
  }, []);

  useEffect(() => {
    if (state && code) {
      navigation(`/oauth/addcloud?code=${code}&state=${state}`);
    } else if (addCloud) {
      navigation(`/oauth/addcloud?addCloud=${addCloud}`);
    }
  }, [state]);

  useEffect(() => {
    if (navigateTo === "Signup") {
      navigation(`/Signup`);
    }
  }, [navigateTo]);

  useEffect(() => {
    let edit = {
      width: "80%",
      height: "45%",
    };
    let hashVal;
    if (currentView === "DOMAIN_SELECTION") {
      edit.width = "50%";
      edit.height = "45%";
      hashVal = "domain";
      // navigation(`#${hashVal}`);
    } else if (currentView === "AUTH_INPUT") {
      edit.width = "50%";
      edit.height = "50%";
      hashVal = "login";
      // navigation(`#${hashVal}`);
    } else {
      hashVal = "info";
      // navigation(`#${hashVal}`);
    }
    setPlacerDimensions(edit);
  }, [currentView]);

  useEffect(() => {
    let fragment = window.location.hash;
    let view;
    if (fragment === "#login") {
      view = "AUTH_INPUT";
    } else if (fragment === "#domain") {
      view = "DOMAIN_SELECTION";
    } else {
      view = "LOGIN_INFO";
    }
    setCurrentView(view);
  }, [window.location.hash]);

  const checkForDomainValidation = async () => {
    let checkDomain = await checkDomainExist(
      window.location.host?.split(".")[0]
    );
    if (checkDomain?.res === "Domain Already register") {
      setValidateStatus("Domain Validated Successfully");
      setTimeout(() => {
        setDomainValidated(true);
      }, 1500);
    } else {
      setValidateStatus("Domain Does't Exist. Contact Support");
      setTimeout(() => {
        window.location.href = "https://cloudfuzehost.com";
      }, 1500);
    }
  };

  return (
    <>
      {isChristmasSeason() ? (
        <div class="snow">
          <div class="snow-layer layer1"></div>
          <div class="snow-layer layer2"></div>
          <div class="snow-layer layer3"></div>
        </div>
      ) : (
        ""
      )}

      <div className="cf_login_bg">
        <div className="cf_login_bg_part_1">
          <div className="cf_login_bg_part_2">
            {domainValidated ? (
              <div
                className="cf_login_placer"
                style={{
                  width: placerDimensions?.width,
                  height: placerDimensions?.height,
                }}
              >
                {currentView === "LOGIN_INFO" ? (
                  <LoginInfo changeViewState={(val) => changeViewState(val)} />
                ) : (
                  ""
                )}
                {currentView === "DOMAIN_SELECTION" ? (
                  <DomainSelector
                    setDomain={setDomain}
                    changeViewState={(val) => changeViewState(val)}
                  />
                ) : (
                  ""
                )}
                {currentView === "AUTH_INPUT" ? (
                  <LoginForm domain={domain} />
                ) : (
                  ""
                )}
              </div>
            ) : (
              <div
                className="cf_login_placer"
                style={{
                  width: "30vw",
                  height: "32vh",
                  justifyContent: "flex-start",
                }}
              >
                <div
                  className="cf_login_content_placer"
                  style={{ gap: "10px", justifyContent: "space-between" }}
                >
                  <div
                    className="cf_domain_icon_placer"
                    style={{ marginTop: "15px" }}
                  >
                    <img src={CF_LOGO} alt="CF Logo" />
                  </div>
                  <p
                    style={{
                      marginTop: "15px",
                      fontWeight: "500",
                      fontSize: "18px",
                      color: "#4b5563",
                    }}
                  >
                    {validateStatus}
                  </p>
                  <div
                    className="CF_d-flex ai-center"
                    style={{
                      padding: "0 5px",
                      gap: "10px",
                      width: "100%",
                      justifyContent: "center",
                    }}
                  >
                    <div className="cf_domainSpinner"></div>
                    <p style={{ fontWeight: "500" }}>Validating...</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="CF_Auth_Footer">
          <p>
            CloudFuze © {new Date().getFullYear()}. All rights reserved |{" "}
            <a href="https://www.cloudfuze.com/terms-of-use" target="_blank">
              Terms of Use
            </a>{" "}
            |{" "}
            <a href="https://www.cloudfuze.com/privacy-policy" target="_blank">
              Privacy Policy
            </a>{" "}
            |{" "}
            <a href="https://www.cloudfuze.com/faqs" target="_blank">
              Help
            </a>{" "}
          </p>
        </div>
      </div>
      {isChristmasSeason() ? (
        <div className="cf_snow_layer_placer">
          <img
            src={cloudImageMapper("CHRISTMAS_TREE")}
            style={{ position: "relative", width: "80px", top: "-65px" }}
          />
          <img
            src={cloudImageMapper("CHRISTMAS_TREE")}
            style={{
              position: "relative",
              width: "45px",
              top: "-35px",
              left: "30%",
              zIndex: 9999,
            }}
          />
          <img
            src={cloudImageMapper("CHRISTMAS_TREE")}
            style={{
              position: "relative",
              width: "45px",
              top: "-60px",
              left: "60%",
            }}
          />
          <img
            src={cloudImageMapper("CHRISTMAS_TREE")}
            style={{
              position: "relative",
              width: "80px",
              top: "-35px",
              left: "84%",
              zIndex: 9999,
            }}
          />
          <img src={cloudImageMapper("SANTA")} className="cf_animate_santa" />
        </div>
      ) : (
        ""
      )}
    </>
  );
};

export default Login;
