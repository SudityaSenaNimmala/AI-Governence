import React, { useContext, useEffect, useState } from "react";
import md5 from "md5";
import CF_LOGO from "../../../assets/images/CF_LOGO.png";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import "../Login/css/Login.css";
import SelectDropDown from "../../Resuables/SelectDropDown/SelectDropDown";
import { notifyToast, validatePassword } from "../../helpers/utils";
import {
  findUserByEmail,
  registerUser,
  validateToken,
} from "../Login/AuthActions/AuthActions";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";

const SignupSetup = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    cnpassword: "",
    phoneNumber: "",
    domain: "",
    employeeCount: "",
  });

  const [isPageLoading, setIsPageLoading] = useState(true);
  const [tokenStatus, setTokenStatus] = useState("Validating Token");

  const [errorFields, setErrorFields] = useState({
    name: "",
    email: "",
    password: "",
    cnpassword: "",
    phoneNumber: "",
    domain: "",
    role: "",
    employeeCount: "",
  });
  const [placerDimensions, setPlacerDimensions] = useState({
    width: "55%",
    height: "auto",
  });
  const [isLoading, setIsLoading] = useState(false);

  const submitLogin = async () => {
    setIsLoading(true);
    let errObj = { ...errorFields };
    if (!formData?.name) {
      errObj.name = "Name is required";
    } else {
      errObj.name = "";
    }
    if (!formData?.email) {
      errObj.email = "Email is required";
    } else {
      errObj.email = "";
    }

    let passVal = validatePassword(formData?.password);
    if (passVal) {
      errObj.password = passVal;
    } else {
      errObj.password = "";
    }

    let cPassVal = validatePassword(formData?.cnpassword, "Confirm Password");
    if (cPassVal) {
      errObj.cnpassword = cPassVal;
    } else {
      errObj.cnpassword = "";
    }

    if (!passVal && !cPassVal) {
      if (formData?.password !== formData?.cnpassword) {
        errObj.password = "Password and Confirm Password not matched";
      } else {
        errObj.password = "";
      }
    }

    if (!formData?.domain) {
      errObj.domain = "Domain name is required";
    } else {
      errObj.domain = "";
    }

    if (!formData?.employeeCount) {
      errObj.employeeCount = "Company Size is required";
    } else {
      errObj.employeeCount = "";
    }

    setErrorFields({ ...errorFields, ...errObj });
    if (
      !errObj?.cnpassword &&
      !errObj?.domain &&
      !errObj?.email &&
      !errObj?.employeeCount &&
      !errObj?.password &&
      !errObj?.employeeCount
    ) {
      let checkUserExist = await findUserByEmail(formData?.email);
      if (checkUserExist?.res === "User Email Does not Exists") {
        let formInput = { ...formData };
        delete formInput.cnpassword;
        formInput.password = md5(formInput?.password);
        let userRegister = await registerUser(formInput);
        if (userRegister?.status === "OK") {
          setFormData({
            name: "",
            email: "",
            password: "",
            cnpassword: "",
            phoneNumber: "",
            domain: "",
            role: "",
            employeeCount: "",
          });
          notifyToast("success", "User Registered Successfully...");
          setTimeout(() => {
            navigate("/");
          }, 500);
          setIsLoading(false);
        } else {
          notifyToast("error", userRegister?.message);
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
        notifyToast("error", checkUserExist?.res);
      }
    } else {
      setIsLoading(false);
    }
  };

  const getFormInputs = (input, inputFrom) => {
    if (inputFrom === "name") {
      setErrorFields({ ...errorFields, name: "" });
    }
    if (inputFrom === "email") {
      setErrorFields({ ...errorFields, email: "" });
    }
    if (inputFrom === "password") {
      setErrorFields({ ...errorFields, password: "" });
    }
    if (inputFrom === "cnpassword") {
      setErrorFields({ ...errorFields, cnpassword: "" });
    }
    if (inputFrom === "domain") {
      setErrorFields({ ...errorFields, domain: "" });
    }
    if (inputFrom === "employeeCount") {
      setErrorFields({ ...errorFields, employeeCount: "" });
    }
    setFormData({ ...formData, [inputFrom]: input });
  };

  useEffect(() => {
    if (token) {
      checkToken();
    }
  }, [token]);

  const checkToken = async () => {
    setIsPageLoading(true);
    let res = await validateToken(token);
    if (res?.status === "OK") {
      if (res?.res?.email) {
        setIsPageLoading(false);
        setTokenStatus("VALID");
        setFormData({
          ...formData,
          domain: res?.res?.domain,
          email: res?.res?.email,
          employeeCount: "100",
        });
      } else {
        setTokenStatus(res?.res);
      }
    } else {
      setTokenStatus(res?.res);
      setIsPageLoading(false);
    }
  };

  // console.log(tokenStatus);

  return (
    <>
      <div className="cf_login_bg">
        <div className="cf_login_bg_part_1">
          <div className="cf_login_bg_part_2">
            <div
              className="cf_login_placer"
              style={{
                width: placerDimensions?.width,
                height: placerDimensions?.height,
              }}
            >
              <div
                className="cf_domain_placer"
                style={{ gap: "20px", width: "100%" }}
              >
                <div className="cf_domain_icon_placer">
                  <img src={CF_LOGO} alt="CF Logo" />
                </div>
                <div
                  className="cf_domain_icon_placer"
                  style={{ height: "5%", marginTop: "-10px" }}
                >
                  {tokenStatus === "VALID" ? (
                    <h5>Complete Your Sign Up</h5>
                  ) : (
                    <h5 style={{ color: "red" }}>{tokenStatus}</h5>
                  )}
                </div>
                {tokenStatus === "VALID" ? (
                  <div
                    className="cf_input_wrapper"
                    style={{ gap: "20px", marginTop: "10px", width: "100%" }}
                  >
                    <TextInput
                      type="email"
                      inputWidth="100%"
                      placeHolder=""
                      // placeHolder="Email *"
                      inputName="email"
                      autoFocus={false}
                      errorData={errorFields?.email}
                      getInputText={(val, name) => getFormInputs(val, name)}
                      defaultValue={formData?.email}
                      readOnly="true"
                    />
                    <div
                      style={{
                        width: "100%",
                        position: "relative",
                      }}
                    >
                      <TextInput
                        type="text"
                        inputWidth="100%"
                        name="domain"
                        // placeHolder="Domain name *"
                        placeHolder=""
                        inputName="domain"
                        autoFocus={false}
                        errorData={errorFields?.domain}
                        getInputText={(val, name) => getFormInputs(val, name)}
                        defaultValue={formData?.domain}
                        readOnly="true"
                      />
                      <span
                        style={{
                          position: "absolute",
                          top: "8px",
                          right: "10px",
                          color: "#acacac",
                        }}
                      >
                        .cloudfuzehost.com
                      </span>
                    </div>
                    <TextInput
                      type="text"
                      inputWidth="100%"
                      placeHolder="Name *"
                      inputName="name"
                      autoFocus={true}
                      errorData={errorFields?.name}
                      getInputText={(val, name) => getFormInputs(val, name)}
                    />
                    <div
                      style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <TextInput
                        type="password"
                        inputWidth="95%"
                        placeHolder="Password *"
                        inputName="password"
                        autoFocus={false}
                        errorData={errorFields?.password}
                        getInputText={(val, name) => getFormInputs(val, name)}
                      />
                      <span style={{ marginLeft: "auto" }}>&nbsp;&nbsp;</span>
                      <TextInput
                        type="password"
                        inputWidth="95%"
                        placeHolder="Confirm Password *"
                        inputName="cnpassword"
                        autoFocus={false}
                        errorData={errorFields?.cnpassword}
                        getInputText={(val, name) => getFormInputs(val, name)}
                      />
                    </div>
                    {/* <SelectDropDown
                      onSelect={(e) => getFormInputs(e.key, "employeeCount")}
                      placeHolder="Company size *"
                      inputWidth="100%"
                      errorData={errorFields?.employeeCount}
                      inputMaxHeight="160px"
                      dropDownContent={[
                        {
                          imageSrc: "",
                          cloudName: "DATA",
                          key: "1-100",
                          displayName: "1 - 100 people",
                        },
                        {
                          imageSrc: "",
                          cloudName: "MESSAGE",
                          key: "100-500",
                          displayName: "100 - 500 people",
                        },
                        {
                          imageSrc: "",
                          cloudName: "EMAIL",
                          key: "500-1000",
                          displayName: "500 - 1000 people",
                        },
                        {
                          imageSrc: "",
                          cloudName: "BOARDS",
                          key: "1000-10K",
                          displayName: "1000 - 10K people",
                        },
                        {
                          imageSrc: "",
                          cloudName: "BOARDS",
                          key: "10K-50K",
                          displayName: "10K - 50K people",
                        },
                        {
                          imageSrc: "",
                          cloudName: "BOARDS",
                          key: "50K-100K",
                          displayName: "50K - 100K people",
                        },
                        {
                          imageSrc: "",
                          cloudName: "TEST",
                          key: "100K+",
                          displayName: "100K+ people",
                        },
                      ]}
                    /> */}
                    {/* <Link to="/Dashboard"> */}
                    <ButtonComponent
                      isLoading={isLoading}
                      isDisabled={false}
                      buttonName="Complete Signup"
                      inputWidth="100%"
                      buttonClickAction={() => submitLogin()}
                    />
                    {/* </Link> */}
                  </div>
                ) : (
                  ""
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="CF_Auth_Footer">
          <p>
            CloudFuze © {new Date().getFullYear()}. All rights reserved | Terms
            of Use | Privacy Policy | Help
          </p>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default SignupSetup;
