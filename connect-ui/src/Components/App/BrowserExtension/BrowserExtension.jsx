import { useSearchParams } from "react-router-dom";
import CF_LOGO from "../../../assets/images/CF_LOGO.png";
import MS_LOGO from "../../../assets/images/cloudIcons/MS_LOGO.svg";
import { getOauthKeys } from "../Oauth/OauthActions/OauthApiActions";
import { useEffect, useState } from "react";
import { authenticateSocialCode } from "../Login/AuthActions/AuthActions";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
const BrowserExtension = () => {
  const [searchParams] = useSearchParams();
  const hash = window.location.hash;

  const [code, setCode] = useState(null);
  const [stateInfo, setStateInfo] = useState(null);

  const [status, setStatus] = useState(null);
  const [loginSuccess, setLoginSuccess] = useState({});
  useEffect(() => {
    if (hash) {
      let hashSplit = hash.split("&");

      let state = hashSplit.find((item) => item.includes("state"));
      if (state) {
        setStateInfo(state.split("=")[1]);
      }

      let code = hashSplit.find((item) => item.includes("code"));
      if (code) {
        setCode(code.split("=")[1]);
      }
    }
  }, [hash]);

  useEffect(() => {
    if (stateInfo && code) {
      setStatus("IN_PROGRESS");
      authenticateCode();
    }
  }, [stateInfo, code]);

  const authenticateCode = async () => {
    let res = await authenticateSocialCode({
      code: code,
      subDomain: stateInfo,
    });
    if (res.status === "OK") {
      console.log(res.res);
      setStatus("SUCCESS");
      setLoginSuccess(res.res);
      window.postMessage(
        { source: "CF_MANAGE_LOGIN", action: "LOGIN_SUCCESS", data: res.res },
        "*"
      );
    } else {
      window.postMessage(
        { source: "CF_MANAGE_LOGIN", action: "LOGIN_SUCCESS", data: "ERROR" },
        "*"
      );
      console.log(res);
      setStatus("FAILED");
    }
  };

  const handleSignInWithMicrosoft = async () => {
    let oauthKeys = await getOauthKeys("SOCIAL_OUTLOOK");
    if (oauthKeys.status === "OK") {
      window.location.href = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${oauthKeys?.res?.clientId}&response_type=code&redirect_uri=${oauthKeys?.res?.redirectUrl}&response_mode=fragment&scope=openid profile email offline_access user.read&state=SOCIAL_OUTLOOK&nonce=678910&prompt=select_account`;
    }
  };

  return (
    <div className="cf_login_bg">
      <div className="cf_login_bg_part_1">
        <div className="cf_login_bg_part_2">
          <div
            className="cf_login_placer"
            style={{
              width: "500px",
              height: "300px",
            }}
          >
            <div className="cf_domain_placer" style={{ gap: "20px" }}>
              <div className="cf_domain_icon_placer">
                <img src={CF_LOGO} alt="CF Logo" />
              </div>
              <div
                className="cf_domain_icon_placer"
                style={{ height: "5%", marginTop: "0px" }}
              >
                <h5>Login To Activate Browser Extension</h5>
              </div>
              <div
                className="cf_input_wrapper"
                style={{
                  marginTop: "10px",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "35%",
                }}
              >
                {status === "SUCCESS" ? (
                  <div>
                    <p>Logged In as {loginSuccess?.currentUser}</p>
                  </div>
                ) : (
                  ""
                )}
                {status === "IN_PROGRESS"
                  ? getCFTextLoader("Authenticating...")
                  : ""}
                {status === null ? (
                  <div
                    className="cf_sign_in_with_microsoft CF_Pointer"
                    onClick={() => {
                      setStatus("IN_PROGRESS");
                      handleSignInWithMicrosoft();
                    }}
                  >
                    <img src={MS_LOGO} alt="MS Logo" />
                    <p>Sign In With Microsoft</p>
                  </div>
                ) : (
                  ""
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrowserExtension;
