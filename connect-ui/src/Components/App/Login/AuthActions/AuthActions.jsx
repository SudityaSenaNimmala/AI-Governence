import { axiosRequest } from "../../../helpers/apiRequest";

export const checkDomainExist = async (domainName) => {
  let res = await axiosRequest(
    {
      method: "GET",
      path: `/app/users/check-domain/${domainName}`,
    },
    false
  );
  return res;
};

export const findUserByEmail = async (email) => {
  let res = await axiosRequest(
    {
      method: "GET",
      path: `/app/users/check/${email}`,
    },
    false
  );
  res?.status === "ERROR"
    ? (res.message = "In Valid Credentials Try Again!")
    : "";
  return res;
};

export const authenticateUser = async (loginForm) => {
  let res = await axiosRequest(
    {
      method: "POST",
      path: "/login",
      body: loginForm,
    },
    "",
    true
  );
  res?.status === "ERROR"
    ? (res.message = "In Valid Credentials Try Again!")
    : "";
  return res;
};

export const getExchangeUser = async () => {
  let res = await axiosRequest({
    method: "POST",
    path: "/migration/login",
    body: "",
  });

  return res;
};

export const getMessageUser = async () => {
  let res = await axiosRequest({
    method: "POST",
    path: "/messagemove/login",
    body: "",
  });

  return res;
};

export const registerUser = async (userForm) => {
  let res = await axiosRequest(
    {
      method: "POST",
      path: "/app/register",
      body: userForm,
    },
    "",
    true
  );
  res?.status === "ERROR" ? (res.message = "Failed User Registering!") : "";
  return res;
};

export const validateToken = async (token) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/app/signup/complete?token=${token}`,
    body: "",
  });
  return res;
};

export const send2FAEmail = async (user) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/sendotp`,
    body: user,
  });
  return res;
};

export const verify2FAOTP = async (otp, email) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/verifyOTP?otp=${otp}&email=${email}`,
  });
  return res;
};

export const authenticateSocialCode = async (body) => {
  let res = await axiosRequest({
    method: "POST",
    path: "/browserExtension/login",
    body: body,
  });
  return res;
};

export const forgotPasswordRequest = async (email) => {
  let res = await axiosRequest(
    { method: "GET", path: `/app/forgot-password/${email}` },
    false,
    true,
    {}
  );
  return res;
};

export const verifyResetToken = async (token, email) => {
  let res = await axiosRequest(
    { method: "POST", path: `/app/pwd/verify/${token}/user/${email}` },
    false,
    true,
    {}
  );
  return res;
};

export const resetPassword = async (token, password) => {
  let res = await axiosRequest(
    { method: "POST", path: `/app/pwd/reset/${token}/${password}` },
    false, true,
    {}
  );
  return res;
};
