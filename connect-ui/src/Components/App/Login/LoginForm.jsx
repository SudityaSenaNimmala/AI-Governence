import md5 from "md5";
import React, { useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import ForgotPassword from "./ForgotPassword";
import {
  SET_AUTH_TOKEN,
  SET_CF_USER,
} from "../../../GlobalContext/action.types";
import CF_LOGO from "../../../assets/images/CF_LOGO.png";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import {
  cloudImageMapper,
  getRandomArray,
  isChristmasSeason,
} from "../../helpers/helpers";
import {
  isSessionValid,
  isTimedOut,
  notifyToast,
  splitAlternate,
  validateEmail,
} from "../../helpers/utils";
import {
  authenticateUser,
  getExchangeUser,
  getMessageUser,
  send2FAEmail,
  verify2FAOTP,
} from "./AuthActions/AuthActions";
import { generateKey, validateMFACode } from "../Settings/UserManagement/MFA";

const LoginForm = (props) => {
  const navigate = useNavigate();
  const faRef = useRef([]);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [isLoading, setIsLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [tempUser, setTempUser] = useState({});
  const [loginDetails, setLoginDetails] = useState({
    email: "",
    password: "",
    domain: window.location.host?.includes("blogs") ? "sacontain" : window.location.host.split(".")[0],
  });
  const [timer, setTimer] = useState(0);
  const [userInfo, setUserInfo] = useState({
    user: {},
    token: "",
    inputCode: [],
    isVerifying: false,
    is2FAEnabled: false,
    is2FAVerified: false,
    isMFAEnabled: false,
  });

  useEffect(() => {
    let interval;
    if (timer !== 0) {
      interval = setInterval(() => {
        setTimer((timer) => timer - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const submitLogin = async () => {
    setIsLoading(true);
    if (validateEmail(loginDetails?.email)) {
      let validateUser = await authenticateUser(loginDetails);
      if (validateUser?.status === "OK") {
        if (validateUser?.res?.isTwoFaEnable || validateUser?.res?.mfaEnable) {
          localStorage.setItem("bToken", validateUser?.headers?.authorization);
          setUserInfo({
            user: validateUser?.res,
            token: validateUser?.headers?.authorization,
            inputCode: [],
            isVerifying: false,
            is2FAEnabled: validateUser?.res?.isTwoFaEnable,
            isMFAEnabled: validateUser?.res?.mfaEnable,
            is2FAVerified: false,
          });
          if (validateUser?.res?.isTwoFaEnable) {
            sendTwoFaEmail(
              validateUser?.res,
              validateUser?.headers?.authorization
            );
          }
        } else {
          localStorage.setItem("time", new Date().getTime());
          localStorage.setItem("bToken", validateUser?.headers?.authorization);
          dispatch({
            type: SET_CF_USER,
            payload: validateUser?.res,
          });
          dispatch({
            type: SET_AUTH_TOKEN,
            payload: validateUser?.headers?.authorization,
          });
        }
      } else {
        notifyToast("error", validateUser?.message);
        setIsLoading(false);
      }
    } else {
      notifyToast("error", "Email Not Valid...");
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (globalContext?.authToken && isTimedOut()) {
      let migration = {
        content: {},
      };
      localStorage.setItem("CFUser", JSON.stringify(migration));
      fetchMessageUser();
      // getXchangeUser();
    }
  }, [globalContext?.authToken]);

  const getXchangeUser = async () => {
    let res = await getExchangeUser();
    if (res?.status === "OK") {
      let migration = {
        content: res?.res,
      };
      localStorage.setItem("CFUser", JSON.stringify(migration));
      fetchMessageUser();
    }
  };

  const fetchMessageUser = async () => {
    // let res = await getMessageUser();
    // if (res?.status === "OK") {
    //   let user = JSON.parse(localStorage.CFUser);
    //   user.message = res?.res;
    //   localStorage.removeItem("bToken");
    //   localStorage.setItem("CFUser", JSON.stringify(user));
    // }
    navigate("/Dashboard");
  };

  const getFormInputs = (input, inputFrom) => {
    setLoginDetails({ ...loginDetails, [inputFrom]: input });
  };

  const sendTwoFaEmail = async (user, token, resend = false) => {
    let res = await send2FAEmail({
      domain: user?.domain,
      id: user?.id,
      name: user?.name,
      email: user?.email,
    });
    if (res?.status === "OK") {
      setUserInfo({
        user: user,
        token: token,
        inputCode: [],
        isVerifying: false,
        is2FAEnabled: true,
        is2FAVerified: false,
      });
      faRef?.current[0]?.focus();
      setTimer(30);

      notifyToast(
        "success",
        resend
          ? "A new 2FA code has been sent to your registered email. Please check your inbox (and spam folder) to retrieve the code."
          : "A 2FA code has been sent to your registered email. Please check your inbox (and spam folder) to retrieve the code."
      );
    } else {
      setUserInfo({
        user: user,
        token: token,
        inputCode: [],
        isVerifying: false,
        is2FAEnabled: true,
        is2FAVerified: false,
      });
      notifyToast("error", "Failed To Send 2FA Code");
    }
  };

  const verifyUserOTP = async () => {
    setUserInfo({ ...userInfo, isVerifying: true });
    let res = await verify2FAOTP(
      userInfo?.inputCode,
      userInfo?.user?.email
    );
    if (res?.status === "OK") {
      localStorage.setItem("time", new Date().getTime());
      localStorage.setItem("bToken", userInfo?.token);
      dispatch({
        type: SET_CF_USER,
        payload: userInfo?.user,
      });
      dispatch({
        type: SET_AUTH_TOKEN,
        payload: userInfo?.token,
      });
    } else {
      setUserInfo({ ...userInfo, isVerifying: false });
      faRef?.current[0]?.focus();
      notifyToast("error", "Invalid OTP");
    }
  };


  const validateMFA = async () => {
    if (userInfo?.inputCode?.length !== 6) {
      return;
    }
    generateKey(splitAlternate(userInfo?.user?.id), splitAlternate(userInfo?.user?.email), splitAlternate(userInfo?.user?.publicId), splitAlternate(userInfo?.user?.domain), splitAlternate(userInfo?.user?.contentUserId)).then((key) => {
      let isVerify = validateMFACode(userInfo?.inputCode, key);
      if (isVerify) {
        localStorage.setItem("time", new Date().getTime());
        localStorage.setItem("bToken", userInfo?.token);
        dispatch({ type: SET_CF_USER, payload: userInfo?.user });
        dispatch({ type: SET_AUTH_TOKEN, payload: userInfo?.token });
      } else {
        notifyToast("error", "Invalid Code");
        setUserInfo({ ...userInfo, inputCode: [] });
        faRef?.current[0]?.focus();
      }
    });

  }
  useEffect(() => {
    if (userInfo?.inputCode?.length === 6 && userInfo?.isMFAEnabled) {
      validateMFA();
    }
  }, [userInfo?.inputCode]);

  if (showForgot) {
    return <ForgotPassword onBack={() => setShowForgot(false)} />;
  }

  return (
    <div className="cf_domain_placer" style={{ gap: "20px" }}>
      <div className="cf_domain_icon_placer">
        <img src={CF_LOGO} alt="CF Logo" />
      </div>
      {!(userInfo?.is2FAEnabled || userInfo?.isMFAEnabled) ? (
        <>
          <div
            className="cf_domain_icon_placer"
            style={{ height: "5%", marginTop: "-10px" }}
          >
            <h5>Login to your account</h5>
          </div>
          <div className="cf_input_wrapper" style={{ marginTop: "10px" }}>
            <TextInput
              type="email"
              placeHolder="Email *"
              inputName="email"
              autoFocus={true}
              getInputText={(val, name) => getFormInputs(val, name)}
            />
            <TextInput
              type="password"
              placeHolder="Password *"
              inputName="password"
              autoFocus={false}
              getInputText={(val, name) => getFormInputs(md5(val), name)}
            />
            {/* <Link to="/Dashboard"> */}
            <div
              style={{ position: "relative" }}
              className="cf_login_button_placer_animation"
            >
              {isChristmasSeason() ? (
                <img
                  src={cloudImageMapper("SNOW_DOLL")}
                  className="cf_snow_doll"
                />
              ) : (
                ""
              )}
              <ButtonComponent
                customstyles={{ zIndex: 99, position: "absolute" }}
                isLoading={isLoading}
                isDisabled={
                  !(
                    loginDetails?.email?.length > 0 &&
                    loginDetails?.password?.length > 0
                  )
                }
                buttonName="Login"
                buttonClickAction={() => submitLogin()}
              />
            </div>
            <div style={{ textAlign: "right", marginTop: "40px" }}>
              <span
                className="cf_resend_link"
                style={{ fontSize: "12px" }}
                onClick={() => setShowForgot(true)}
              >
                Forgot Password?
              </span>
            </div>
            {/* </Link> */}
          </div>
        </>
      ) : (
        <>
          <div
            className="cf_domain_icon_placer"
            style={{ height: "5%", marginTop: "-10px" }}
          >
            <h5>{userInfo?.is2FAEnabled ? "Two Factor Authentication" : "Multi Factor Authentication"}</h5>
          </div>
          <div className="cf_input_wrapper" style={{ marginTop: "30px" }}>
            <div
              className="CF_d-flex ai-center"
              style={{ justifyContent: "space-between" }}
            >
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={userInfo?.inputCode}
                placeholder="000000"
                autoFocus={true}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setUserInfo({ ...userInfo, inputCode: val });
                }}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: "16px",
                  letterSpacing: "8px",
                  textAlign: "center",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  boxSizing: "border-box",
                }}
              />
              {/* {getRandomArray(6)?.map((data, index) => {
                return (
                  <input
                    type="number"
                    className="cf_2fa_input"
                    key={`${data}_2FA`}
                    maxLength={1}
                    value={userInfo?.inputCode[index] || ""}
                    onInput={(e) => {
                      let newArr = [...userInfo?.inputCode];
                      newArr[index] = e.target.value;
                      if (e.target.value?.trim()?.length === 6) {
                        setUserInfo({ ...userInfo, inputCode: e.target.value?.split("") });
                        faRef?.current[5]?.focus();
                      } else {
                        if (e.target.value) {
                          if (index < 5) {
                            faRef?.current[index + 1]?.focus();
                          }
                        } else {
                          if (index !== 0) {
                            faRef?.current[index - 1]?.focus();
                          }
                        }
                        setUserInfo({ ...userInfo, inputCode: newArr });
                      }
                    }}
                    ref={(el) => (faRef.current[index] = el)}
                    autoFocus={index === 0}
                  />
                );
              })} */}
            </div>
            {/* <Link to="/Dashboard"> */}
            <ButtonComponent
              isLoading={userInfo?.isVerifying}
              isDisabled={userInfo?.inputCode.length !== 6}
              buttonName="Verify"
              buttonClickAction={() => userInfo?.is2FAEnabled ? verifyUserOTP() : validateMFA()}
            />
            {/* </Link> */}
          </div>
          {userInfo?.is2FAEnabled ? <div className="CF_d-flex" style={{ width: "100%" }}>
            {timer !== 0 ? (
              <p style={{ fontSize: "12px", marginLeft: "auto" }}>
                You can resend the code in &nbsp;
                <span style={{ fontWeight: "500" }}>
                  00:{timer.toString().padStart(2, "0")}
                </span>
              </p>
            ) : (
              <p style={{ fontSize: "12px", marginLeft: "auto" }}>
                {" "}
                <span
                  className="cf_resend_link"
                  onClick={() => {
                    setTimer(30);
                    sendTwoFaEmail(userInfo?.user, userInfo?.token, true);
                    faRef.current[0].focus();
                  }}
                >
                  Resend Email
                </span>
              </p>
            )}
          </div> : null}
        </>
      )}
    </div>
  );
};

export default LoginForm;
