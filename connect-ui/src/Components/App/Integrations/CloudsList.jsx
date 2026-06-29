import { File as FileIcon, Sparkles } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCloudName, integrationsList } from "../../helpers/helpers";
import { getMaxChar, getUserId, notifyToast } from "../../helpers/utils";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import Popup from "../../Resuables/Popup/Popup";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import { getOauthScopes, startOauth } from "../Oauth/OauthActions/OauthActions";
import {
  getOauthKeys,
  saveOauthCode,
  saveOauthKeys,
  saveVendorWithInvoice,
} from "../Oauth/OauthActions/OauthApiActions";
import { getAppConfigurationList } from "../SaaSManagement/SaaSActions/SaaSActions";
import { InVoiceFileUploadNew } from "../UserManagement/OnBoard/InVoiceFileUpload copy";
import CloudIntegrateManually from "./CloudIntegrateManually";
import { BsUpload } from "react-icons/bs";
import { uploadS3File } from "../Blog/AssertManager/AssertAction";

const CloudsList = () => {
  const navigate = useNavigate();
  const firstElementRef = useRef();
  const [dropDownOpen, setDropDownOpen] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isUploadInvoice, setIsUploadInvoice] = useState(false);
  const [activeCloudFilter, setActiveCloudFilter] = useState("ALL");
  const [uiConfigs, setUiConfigs] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [isManuallyIntegration, setIsManuallyIntegration] = useState(false);
  const [pemFile, setPemFile] = useState(null);
  const [setOauthKeysData, setSetOauthKeysData] = useState({
    redirectUrl: "https://cloudfuzehost.com/CloudFuze",
    clientId: "",
    clientSecret: "",
    vendor: "",
    clientEmail: "",
    appRedirectUrl: "https://cloudfuzehost.com/CloudFuze",
  });
  const [filterMoveStyles, setFilterMoveStyles] = useState({
    width: `${firstElementRef?.current?.clientWidth}px`,
    left: `${firstElementRef?.current?.offsetLeft}px`,
  });
  const [isVisible, setIsVisible] = useState("");
  const [authCredentials, setAuthCredentials] = useState({
    name: "",
    emailId: "email",
    clientId: "",
    clientSecret: "",
  });
  const [isApiKeySaving, setIsApiKeySaving] = useState(false);
  const [setOauthKeys, setSetOauthKeys] = useState(false);
  const [placeholderText, setPlaceholderText] = useState({
    name: "Name *",
    emailId: "Email Id *",
    clientId: "Client ID *",
    clientSecret: "Client Secret *",
  });

  useEffect(() => {
    firstElementRef?.current?.click();
  }, [firstElementRef]);

  useEffect(() => {
    getUiConfigs();
  }, []);

  const getUiConfigs = async () => {
    setIsPageLoading(true);
    let res = await getAppConfigurationList();
    if (res?.status === "OK") {
      setUiConfigs(res?.res);
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
      // notifyToast("error", res?.message);
    }
  };

  const setActiveCloudFilterFun = (filter, e) => {
    setActiveCloudFilter(filter);
    setFilterMoveStyles({
      ...activeCloudFilter,
      width: `${e.target.clientWidth}px`,
      left: `${e.target.offsetLeft}px`,
    });
  };

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === "oauthStatus") {
        if (e.newValue === "Success") {
          notifyToast("success", "Account added successfully.");
          setTimeout(() => {
            navigate("/Integrations/Manage");
          }, 300);
        } else if (e.newValue === "AlreadyExist") {
          notifyToast(
            "error",
            "This Account is already registered. Please use a different Account."
          );
        } else if (e.newValue) {
          notifyToast("error", "Failed registering .Please try once again.");
        }
        localStorage.removeItem("oauthStatus");
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const actionForOauth = async (cloudName) => {
    setIsPageLoading(true);
    setAuthCredentials({
      internal: false,
      identityStoreId: "",
      name: "test",
      emailId: "email",
      clientId: "",
      clientSecret: "",
    });
    let oauthNotNeeded = [
      "FIVETRAN",
      "HIVE",
      "CLOUDFLARE",
      "JUMPCLOUD",
      "DOCUMENT360",
      "SENDGRID",
      // "ZENDESK",
      "PANDADOC",
      "INSIGHTLY",
      "DIGICERT",
      "FASTLY",
      "LAUNCHDARKLY",
      "HELP_DESK",
      "FRESHDESK",
      "FRESHCHAT",
      "BRILLIUM",
      "POSTMAN",
      "SHORTCUT",
      "DUO",
      "BUSINESSMAP",
      "CODA",
      "FACEBOOK_WORKPLACE",
      "SMART_BEAR",
      "TERRAFORM",
      "THINKIFIC",
      "CODER_BYTE",
      "ONE_PASSWORD",
      "ATLASSIAN",
      "INSIGHTFUL",
      "CURSOR_AI",
      "LUMA",
      "OKTA",
      "INSTANTLY",
      "OPENVPN_CLOUD",
      "ONELOGIN",
      "LASTPASS",
      "FILES_COM",
      "TABLEAU",
      "BILL_COM",
      "STRIPE",
      "SNOWFLAKE",
      "ADOBE_CREATIVE",
      "MONGODBATLAS",
      "AWS",
      "AWS_IC",
      "INFORMATICA",
      "CANVA",
      "CHATGPT",
      "OPENAI",
      "FRESH_DESK",
      "BITDEFENDER",
      "MAILGUN",
      "LATTICE",
      "TAXJAR",
      "TRELLO",
      "ACTIVECAMPAIGN",
      "ZUORA",
      "OWNBACKUP",
      "RIPPLING",
      "MOUSEFLOW",
      "LAMBDATEST",
      "BRANDFOLDER",
      "GRAMMARLY",
      "TWILIO",
      "INMOMENT",
      "UBERALL",
      "MEMZO",
      "SLING",
      "PLANHAT",
      "SNIPE_IT",
      "SONARCLOUD",
      "AUTH0",
      "SENTRY",
      "DATADOG",
      "MAILTRAP",
      "JETBRAINS",
      "CHECKR",
      "APPVEYOR",
      "PUBNUB",
      "VERCEL",
      "PISIGNAGE",
      "STATUSCAKE",
      "AVALARA",
      "ROLLBAR",
      "KINSTA",
      "GEMFURY",
      "SHIFTER_IO",
      "VISUAL_VISITOR",
      "WP_ENGINE",
      "HACKERONE",
      "GURU",
      "POSTHOG",
      "CLICKSEND",
      "JOTFORM",
      "CANNY",
      "UPTIME_ROBOT",
      "SNYK",
      "CORTEX",
      "VANTA",
      "NAMECHEAP",
      "USER_PILOT",
      "NAMECHEAP",
      "QUICKSIGHT_AWS",
      "WISTIA",
      "UNBOUNCE",
      "MIXPANEL",
      "DATABOX",
      "FAVRO",
      "AIRCALL",
      "DOMO",
      "SIGMA_COMPUTING",
      "ROCKET_REACH",
      "EIGHTXEIGHT",
      "NEW_RELIC",
      "AUTOMOX",
      "DYNATRACE",
      "DOCKER",
      "RUNN",
      "HEX",
      "CROWDSTRIKE",
      "GRAFANA",
      "KAITEN",
      "TWINGATE",
      "ZUBE_IO",
      "ACTION1",
      "WAFEQ",
      "WORKABLE",
      "TESTFAIRY",
      "ZENDUTY",
      "TESTRAIL",
      "ARTICULATE_360",
      "LARKSUITE",
      "JITBIT",
      "LAUNCH_DARKLY",
      "ISPRING_LEARN",
      "FORMALIZE",
      "KINTONE",
      "CLAUDE",
      "EZ_OFFICE",
      "LEARNUPON",
      "TWILIO_SEGMENT",
      "GODADDY",
      "CALENDAR_HERO",
      "ALTERYX_CLOUD",
      "BRIVO",
      "REDHAT"
      // "LINKEDIN",
    ];
    let oauthAction = [
      "EGNYTE_ADMIN",
      "ONELOGIN",
      "UIPATH",
      "MAILCHIMP",
      "SHAREFILE",
      "GITHUB",
      "JIRA",
      "CONFLUENCE",
      "ATLASSIAN",
      // "FIGMA",
      // "BAMBOOHR",
      "WORKDAY",
      "DYNAMICS_365_SALES",
      "AZURE_DEVOPS",
      "AHA"
    ];
    if (oauthNotNeeded.includes(cloudName)) {
      setPemFile(null);
      if (cloudName === "OPENVPN_CLOUD") {
        setPlaceholderText({
          emailId: "Domain Name *",
          clientId: "Client ID *",
          clientSecret: "Client Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "ZENDESK") {
        setPlaceholderText({
          emailId: "Domain Name *",
          clientId: "Client ID *",
          clientSecret: "Client Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "INFORMATICA") {
        setPlaceholderText({
          emailId: "Subdomain *",
          clientId: "Email Id *",
          clientSecret: "Password *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "CHATGPT" || cloudName === "OPENAI") {
        setPlaceholderText({
          emailId: "Admin Email *",
          clientId: "API Key *",
          clientSecret: "Password *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "aaa",
        });
      } else if (cloudName === "CHATGPT" || cloudName === "OPENAI") {
        setPlaceholderText({
          emailId: "Admin Email *",
          clientId: "API Key *",
          clientSecret: "Password *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "aaa",
        });
      } else if (
        cloudName === "MAILGUN" ||
        cloudName === "LATTICE" ||
        cloudName === "TRELLO"
      ) {
        setPlaceholderText({
          emailId: "Admin Email *",
          clientId: "API Key *",
          clientSecret: "Password *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "rest",
          clientId: "",
          clientSecret: "aaa",
        });
      } else if (
        cloudName === "TAXJAR" ||
        cloudName === "STATUSCAKE" ||
        cloudName === "ROLLBAR" ||
        cloudName === "KINSTA" ||
        cloudName === "GEMFURY" ||
        cloudName === "SHIFTER_IO"
      ) {
        setPlaceholderText({
          emailId: "Admin Email *",
          clientId: "API Key *",
          clientSecret: "Password *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "aaa",
        });
      } else if (
        cloudName === "MOUSEFLOW" ||
        cloudName === "LAMBDATEST" ||
        cloudName === "BRANDFOLDER" ||
        cloudName === "CHECKR" ||
        cloudName === "CLICKSEND" ||
        cloudName === "WISTIA" ||
        cloudName === "DATABOX" ||
        cloudName === "RUNN" ||
        cloudName === "HEX" ||
        cloudName === "NEW_RELIC" ||
        cloudName === "AUTOMOX" ||
        cloudName === "CANNY" ||
        cloudName === "CORTEX" ||
        cloudName === "VANTA" ||
        cloudName === "SENTRY" ||
        cloudName === "USER_PILOT" ||
        cloudName === "MAILTRAP" ||
        cloudName === "GRAFANA" ||
        cloudName === "KAITEN" ||
        cloudName === "JITBIT" ||
        cloudName === "TWINGATE" ||
        cloudName === "WAFEQ" ||
        cloudName === "TESTFAIRY" ||
        cloudName === "ZENDUTY" ||
        cloudName === "ARTICULATE_360" ||
        cloudName === "TESTRAIL" ||
        cloudName === "FORMALIZE" ||
        cloudName === "EZ_OFFICE" ||
        cloudName === "TWILIO_SEGMENT" ||
        cloudName === "CLAUDE"
      ) {
        setPlaceholderText({
          emailId: "Admin Email *",
          clientId: cloudName === "CLAUDE" ? "Admin Email *" : cloudName === "EZ_OFFICE" ? "Subdomain *" : cloudName === "TWINGATE" ? "Network Name *" : cloudName === "KAITEN" || cloudName === "JITBIT" ? "Subdomain *" : cloudName === "GRAFANA" ? "Domain URL *" : cloudName === "AUTOMOX" ? "Account ID *" : cloudName === "LAMBDATEST" || cloudName === "TESTFAIRY" ? "Username *" : "Admin Email *",
          clientSecret:
            cloudName === "CLAUDE" ? "API Key *" : cloudName === "EZ_OFFICE" ? "Secret Key *" : cloudName === "FORMALIZE" ? "API Token *" : cloudName === "JITBIT" ? "Token *" : cloudName === "KAITEN" || cloudName === "TWINGATE" ? "API Key *" : cloudName === "GRAFANA" ? "Access Token *" : cloudName === "LAMBDATEST" ? "Access Key *" : "API Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "aa",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "FRESH_DESK" || cloudName === "ACTIVECAMPAIGN" || cloudName === "WORKABLE" || cloudName === "BITDEFENDER") {
        setPlaceholderText({
          emailId: "Admin Email *",
          clientId: "API Key *",
          clientSecret: "Subdomain *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "LASTPASS") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "Account ID *",
          clientSecret: "Provisioning Token *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "FAVRO") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "Username *",
          clientSecret: "Password *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "aaaa",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "EIGHTXEIGHT") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "API Key *",
          clientSecret: "Account ID *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "MIXPANEL") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "Service Account Name *",
          clientSecret: "Secret Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "GRAMMARLY") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "Client ID *",
          clientSecret: "Client Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "aaa",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "DATADOG") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: cloudName === "GODADDY" ? "Access Token *" : "API Key *",
          clientSecret: cloudName === "GODADDY" ? "Application Token *" : "Application Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "aaa",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "AIRCALL" || cloudName === "GODADDY") {
        setPlaceholderText({
          emailId: "Admin Email *",
          clientId: cloudName === "GODADDY" ? "Access Token *" : "API Id *",
          clientSecret: cloudName === "GODADDY" ? "Application Token *" : "API Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "TWILIO" || cloudName === "INMOMENT" || cloudName === "NAMECHEAP") {
        setPlaceholderText({
          emailId: cloudName === "NAMECHEAP" ? "Client IP *" : "Admin Email *",
          clientId: cloudName === "NAMECHEAP" ? "API Key *" : cloudName === "INMOMENT" ? "API Key *" : cloudName === "NAMECHEAP" ? "API Key *" : "Account SID *",
          clientSecret: cloudName === "NAMECHEAP" ? "API User *" : cloudName === "INMOMENT" ? "API Secret *" : "Auth Token *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "BILL_COM") {
        setPlaceholderText({
          name: "User Name *",
          emailId: "Password or API Key *",
          clientId: "Organization ID *",
          clientSecret: "Developer Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "BRIVO") {
        setPlaceholderText({
          name: "Redirect URL *",
          emailId: "API Key *",
          clientId: "Client Id *",
          clientSecret: "Client Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "https://cloudfuzehost.com/CloudFuze",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "DYNATRACE" || cloudName === "DOCKER") {
        setPlaceholderText({
          name: cloudName === "DOCKER" ? "Identifier *" : "Username *",
          emailId: "Admin Email *",
          clientId: cloudName === "DOCKER" ? "Organization Name *" : "Client ID *",
          clientSecret: cloudName === "DOCKER" ? "Secret Key *" : "Client Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "CROWDSTRIKE") {
        setPlaceholderText({
          name: "Customer ID *",
          subDomain: "Domain URL *",
          emailId: "Admin Email *",
          clientId: "Client ID *",
          clientSecret: "Client Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "QUICKSIGHT_AWS") {
        setPlaceholderText({
          name: "Identity Store Id *",
          emailId: "Region *",
          clientId: "Access Key *",
          clientSecret: "Secret Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "SIGMA_COMPUTING" || cloudName === "TESTRAIL") {
        setPlaceholderText({
          name: cloudName === "TESTRAIL" ? "Subdomain *" : "Region *",
          emailId: "Admin Email *",
          clientId: "Client Id *",
          clientSecret: cloudName === "TESTRAIL" ? "Password *" : "Client Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "HACKERONE") {
        setPlaceholderText({
          name: "Organization Id *",
          emailId: "Admin Email *",
          clientId: "API Key *",
          clientSecret: "API Key Name *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "GURU") {
        setPlaceholderText({
          name: "Organization Id *",
          emailId: "Admin Email *",
          clientId: "Admin Email *",
          clientSecret: "API Key*",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "a",
          emailId: "a",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "PUBNUB") {
        setPlaceholderText({
          emailId: "Admin Email *",
          clientId: "Subscribe Key *",
          clientSecret: "Secret Key *",
          subDomain: "Publish Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "JETBRAINS") {
        setPlaceholderText({
          name: "Domain *",
          emailId: "Email Id *",
          clientId: "API Key *",
          clientSecret: "Organization ID *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (
        cloudName === "ONELOGIN" ||
        cloudName === "ZUORA" ||
        cloudName === "OWNBACKUP" ||
        cloudName === "AUTH0"
      ) {
        setPlaceholderText({
          name:
            cloudName === "AUTH0"
              ? "Domain URL *"
              : cloudName === "OWNBACKUP"
                ? "Regional URL *"
                : "Domain Name *",
          emailId: "Admin Email *",
          clientId: "Client ID *",
          clientSecret:
            cloudName === "OWNBACKUP" ? "Refresh Token *" : "Client Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "TABLEAU" || cloudName === "LEARNUPON") {
        setPlaceholderText({
          name: cloudName === "LEARNUPON" ? "Domain *" : "Server URL *",
          emailId: "Admin Email *",
          clientId: cloudName === "LEARNUPON" ? "API Key *" : "Token Name *",
          clientSecret: cloudName === "LEARNUPON" ? "Password *" : "Token Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "CODA") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "API Key *",
          clientSecret: "User Id *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: "Secret Key *",
        });
      } else if (
        cloudName === "CANVA" ||
        cloudName === "UBERALL" ||
        cloudName === "MEMZO" ||
        cloudName === "SLING" ||
        cloudName === "PLANHAT" ||
        cloudName === "POSTHOG" ||
        cloudName === "UNBOUNCE" ||
        cloudName === "LAUNCH_DARKLY" ||
        cloudName === "VISUAL_VISITOR" ||
        cloudName === "APPVEYOR" ||
        cloudName === "VERCEL" ||
        cloudName === "PISIGNAGE" ||
        cloudName === "JOTFORM" ||
        cloudName === "UPTIME_ROBOT" ||
        cloudName === "SNYK" ||
        cloudName === "ROCKET_REACH"
      ) {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: cloudName === "LAUNCH_DARKLY" ? "Token *" : cloudName === "SLING" ? "Auth Token *" : "API Key *",
          clientSecret: "User Id *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: "Secret Key *",
        });
      } else if (cloudName === "LUMA" || cloudName === "CALENDAR_HERO") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: cloudName === "CALENDAR_HERO" ? "API Token *" : "API Key *",
          clientSecret: "Email Id *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: cloudName === "CALENDAR_HERO" ? "AAA" : "",
        });
      } else if (cloudName === "AWS") {
        setPlaceholderText({
          emailId: "Region *",
          clientId: "Access Key *",
          clientSecret: "Secret Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "AWS_IC") {
        setPlaceholderText({
          emailId: "Admin Email *",
          clientId: "SCIM URL *",
          clientSecret: "SCIM Token *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "HIVE") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "Client ID *",
          clientSecret: "User Id *",
        });
      } else if (cloudName === "CLOUDFLARE") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "Admin Email *",
          clientSecret: "Admin API Key *",
        });
      } else if (cloudName === "FIVETRAN") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "API Key *",
          clientSecret: "Secret Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "test",
          clientId: "",
          clientSecret: "test",
        });
      } else if (
        cloudName === "ZENDESK" ||
        cloudName === "DUO" ||
        cloudName === "FILES_COM"
      ) {
        if (cloudName === "DUO") {
          setPlaceholderText({
            emailId: "Integration Key *",
            clientId: "Secret Key *",
            clientSecret: "API Host Name *",
          });
        } else {
          setPlaceholderText({
            emailId: "Email Id *",
            clientId: "API Key *",
            clientSecret: "Domain *",
          });
        }
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "BRILLIUM") {
        setPlaceholderText({
          name: "API Namespace *",
          emailId: "Base URI *",
          clientId: "API Password *",
          clientSecret: "Security Token *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "ONE_PASSWORD") {
        setPlaceholderText({
          name: "Name *",
          emailId: "Email Id *",
          clientId: "API Key *",
          clientSecret: "SCIM URL *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (
        cloudName === "OKTA" ||
        cloudName === "SNIPE_IT" ||
        cloudName === "SONARCLOUD" ||
        cloudName === "ALTERYX_CLOUD"
      ) {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: cloudName === "ALTERYX_CLOUD" ? "Refresh Token *" : "API Key *",
          clientSecret: cloudName === "ALTERYX_CLOUD" ? "Client Id *" : "Subdomain *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "sample",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "MONGODBATLAS" || cloudName === "DOMO") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "Client Id *",
          clientSecret: "Client Secret *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "RIPPLING") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "API Key *",
          clientSecret: "Refresh Token *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "aaa",
        });
      } else if (cloudName === "SNOWFLAKE") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "API Key *",
          clientSecret: "Subdomain *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "sample",
          clientId: "",
          clientSecret: "",
        });
      } else if (cloudName === "INSTANTLY") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "API Key *",
          clientSecret: "API Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "sample",
          clientId: "",
          clientSecret: "test",
        });
      } else if (cloudName === "REDHAT") {
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: "User Id *",
          clientSecret: "API Key *",
        });
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "sample",
          clientId: "",
          clientSecret: "",
        });
      } else if (
        cloudName === "THINKIFIC" ||
        cloudName === "HELP_DESK" ||
        cloudName === "FRESHDESK" ||
        cloudName === "BUSINESSMAP" ||
        cloudName === "FRESHCHAT" ||
        cloudName === "CODER_BYTE" ||
        cloudName === "INSIGHTFUL"
      ) {
        if (cloudName === "THINKIFIC") {
          setPlaceholderText({
            emailId: "Subdomain *",
            clientId: "API Key*",
            clientSecret: "Domain *",
          });
        } else if (cloudName === "BUSINESSMAP") {
          setPlaceholderText({
            emailId: "API Key *",
            clientId: "Subdomain *",
            clientSecret: "Domain *",
          });
        } else if (
          cloudName !== "HELP_DESK" &&
          cloudName !== "CODER_BYTE" &&
          cloudName !== "INSIGHTFUL"
        ) {
          setPlaceholderText({
            emailId: "Domain Name *",
            clientId: "API Key *",
            clientSecret: "Domain *",
          });
        } else if (cloudName === "CODER_BYTE") {
          setPlaceholderText({
            emailId: "Admin Email *",
            clientId: "Access Token *",
            clientSecret: "Admin Email *",
          });
        } else if (cloudName === "INSIGHTFUL") {
          setPlaceholderText({
            emailId: "Email Id *",
            clientId: "API Key *",
            clientSecret: "Domain *",
          });
        } else {
          setPlaceholderText({
            emailId: "Account ID *",
            clientId: "API Key *",
            clientSecret: "Domain *",
          });
        }
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "sample",
        });
      } else if (
        cloudName === "LAUNCHDARKLY" ||
        cloudName === "SHORTCUT" ||
        cloudName === "FASTLY" ||
        cloudName === "JUMPCLOUD" ||
        cloudName === "DOCUMENT360" ||
        cloudName === "INSIGHTLY" ||
        cloudName === "DIGICERT" ||
        cloudName === "POSTMAN" ||
        cloudName === "PANDADOC" ||
        cloudName === "SMART_BEAR" ||
        cloudName === "TERRAFORM"
      ) {
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: "TEST",
        });
        setPlaceholderText({
          emailId: "Email Id *",
          clientId:
            cloudName === "TERRAFORM" ? "Organization Token*" : " API Key*",
          clientSecret: "",
        });
      } else if (cloudName === "SENDGRID") {
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: "asdasd",
        });
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: " API Key*",
          clientSecret: "Client Secret*",
        });
      } else if (cloudName === "ADOBE_CREATIVE") {
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "",
          clientId: "",
          clientSecret: "",
        });
        setPlaceholderText({
          emailId: "Organization Id *",
          clientId: "Client Id*",
          clientSecret: "Client Secret*",
        });
      } else if (cloudName === "ATLASSIAN") {
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: "",
        });
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: " API Key *",
          clientSecret: "Organization Id *",
        });
      } else if (cloudName === "AVALARA" || cloudName === "WP_ENGINE") {
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: "",
        });
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: " Email Id *",
          clientSecret: " Password *",
        });
      } else if (cloudName === "LARKSUITE") {
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: "",
        });
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: " API Key *",
          clientSecret: " App Secret *",
        });
      } else if (cloudName === "STRIPE") {
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: "aaa",
        });
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: " API Key *",
          clientSecret: "Organization Id *",
        });
      } else if (cloudName === "CURSOR_AI") {
        setAuthCredentials({
          internal: false,
          identityStoreId: "",
          name: "test",
          emailId: "Email Id *",
          clientId: "",
          clientSecret: "asdad",
        });
        setPlaceholderText({
          emailId: "Email Id *",
          clientId: " API Key *",
          clientSecret: "Organization Id *",
        });
      } else if (cloudName === "FACEBOOK_WORKPLACE") {
        setPlaceholderText({
          clientId: "Access Token *",
          clientSecret: cloudName === "HIVE" ? "User Id *" : "Client Secret *",
        });
      } else {
        setPlaceholderText({
          clientId: "Client ID *",
          clientSecret: cloudName === "HIVE" ? "User Id *" : "Client Secret *",
        });
      }
      setIsPageLoading(false);
      setIsVisible(cloudName);
    } else if (oauthAction.includes(cloudName)) {
      setIsPageLoading(false);
      window.open(
        `${window.location.origin}/CloudFuze?addCloud=${cloudName}`,
        "Popup",
        "toolbar=no, location=no, statusbar=no, menubar=no, scrollbars=1, resizable=0, width=580, height=600, top=30"
      );
    } else if (
      cloudName === "GUSTO" ||
      cloudName === "TAILSCALE" ||
      cloudName === "ZENDESK" ||
      cloudName === "AWS" ||
      cloudName === "BAMBOOHR" ||
      cloudName === "QUICKBOOKSONLINE" ||
      cloudName === "LINKEDIN" ||
      cloudName === "SAP_HANA_CLOUD" ||
      cloudName === "SERVICENOW" ||
      cloudName === "ZOOM" ||
      cloudName === "CONTENTFUL" ||
      cloudName === "PIPEDRIVE" ||
      cloudName === "WORKDAY" ||
      cloudName === "BLACKLINE" ||
      cloudName === "YEXT" ||
      cloudName === "LEARNING_360" ||
      cloudName === "BAMBOOHR" ||
      cloudName === "DIGITALOCEAN" ||
      cloudName === "AIKIDO" ||
      cloudName === "REDHAT" ||
      cloudName === "ZOOM" ||
      cloudName === "DROPBOX_BUSINESS" ||
      cloudName === "FIGMA" ||
      cloudName === "TEAMWORK"
    ) {
      setSetOauthKeysData({
        redirectUrl: "https://cloudfuzehost.com/CloudFuze",
        clientId: "",
        clientSecret: "",
        vendor: cloudName,
        clientEmail: "",
        // appRedirectUrl: "https://cloudfuzehost.com/CloudFuze",
        appRedirectUrl: "",
        oauthUrl: "",
        scopes: "",
      });
      if (cloudName === "TAILSCALE") {
        setIsPageLoading(false);
        setSetOauthKeys(cloudName);
        return;
      }
      let res = await getOauthKeys(cloudName);
      if (res.status === "OK") {
        if (Object.keys(res?.res).length > 0) {
          setIsPageLoading(true);
          if (cloudName === "ZENDESK" || cloudName === "BAMBOOHR" || cloudName === "FIGMA") {
            window.open(
              `${window.location.origin}/CloudFuze?addCloud=${cloudName}`,
              "Popup",
              "toolbar=no, location=no, statusbar=no, menubar=no, scrollbars=1, resizable=0, width=580, height=600, top=30"
            );
            setIsPageLoading(false);
            return;
          }
          let resApp = await startOauth(cloudName);
          console.log(resApp);
          if (resApp) {
            setIsPageLoading(false);
          }
        } else {
          setSetOauthKeys(cloudName);
        }
        setIsPageLoading(false);
      } else {
        setSetOauthKeys(cloudName);
        setIsPageLoading(false);
      }
    } else {
      let res = await startOauth(cloudName);
      if (res) {
        setIsPageLoading(false);
      }
    }
  };

  const startSaveApiKey = async (cloudName) => {
    setIsApiKeySaving(true);
    let randomId = crypto.randomUUID();
    try {

      if (isVisible === "ZUBE_IO") {
        const fileToUpload = new File([pemFile], `${randomId}.pem`, { type: pemFile.type });
        let pemFileStream = await uploadS3File(fileToUpload, `${window.location.hostname.split(".")[0]}/ZUBE_IO`);
        if (pemFileStream) {
        }
      }

      let body = {
        code: `${authCredentials.clientId}`,
      };

      if (isVisible === "ZENDESK") {
        body = {
          code: `${authCredentials.emailId}:${authCredentials.clientId}:${authCredentials.clientSecret}`,
        };
      }

      if (isVisible === "FILES_COM") {
        body = {
          code: `${authCredentials.emailId}:${authCredentials.clientSecret}:${authCredentials.clientId}`,
        };
      }

      if (
        isVisible === "HELP_DESK" ||
        isVisible === "FRESHCHAT" ||
        isVisible === "BUSINESSMAP" ||
        isVisible === "FRESHDESK"
      ) {
        body = {
          code: `${authCredentials.emailId}:${authCredentials.clientId}`,
        };
      }

      if (isVisible === "ONE_PASSWORD") {
        body = {
          code: `${authCredentials.clientId
            }:${authCredentials?.clientSecret?.replace(/:/g, ";")}:${authCredentials.emailId
            }:${authCredentials.name}`,
        };
      }

      if (isVisible === "BRILLIUM") {
        let uri = authCredentials.emailId?.replace("https://", "");
        let password = btoa(
          `${authCredentials?.name}:${authCredentials?.clientId}${authCredentials?.clientSecret}`
        );
        body = {
          code: `${uri}:${password}`,
        };
      }

      if (isVisible === "CODER_BYTE" || isVisible === "INSIGHTFUL") {
        body = {
          code: `${authCredentials.clientId}:${authCredentials.emailId}`,
        };
      }

      if (isVisible === "INSIGHTFUL") {
        body = {
          code: `${authCredentials.clientId}`,
          adminCloudId: `${authCredentials.emailId}`,
        };
      }

      if (
        isVisible === "FIVETRAN" ||
        isVisible === "HIVE" ||
        isVisible === "CLOUDFLARE" ||
        isVisible === "THINKIFIC" ||
        isVisible === "FACEBOOK_WORKPLACE" ||
        isVisible === "ATLASSIAN" ||
        isVisible === "LUMA" ||
        isVisible === "CALENDAR_HERO"
      ) {
        if (isVisible === "ATLASSIAN") {
          body = {
            code: `${authCredentials.clientId}:${authCredentials.clientSecret}`,
          };
        } else {
          body = {
            code: `${authCredentials.clientId}`,
          };
        }
      }
      if (isVisible === "THINKIFIC") {
        body = {
          code: `${authCredentials.emailId}:${authCredentials.clientId}`,
        };
      }
      if (isVisible === "TAILSCALE") {
        body = {
          code: `${setOauthKeysData.clientEmail}`,
        };
      }
      if (
        isVisible === "OKTA" ||
        isVisible === "SNIPE_IT" ||
        isVisible === "SONARCLOUD"
      ) {
        body = {
          code: authCredentials.clientId,
          subDomain: authCredentials.clientSecret,
        };
      }

      if (isVisible === "MONGODBATLAS" || isVisible === "DOMO") {
        body = {
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "SNOWFLAKE") {
        body = {
          code: authCredentials?.clientId,
          subDomain: authCredentials?.clientSecret,
        };
      }

      if (isVisible === "GURU" || isVisible === "ALTERYX_CLOUD") {
        body = {
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
        };
      }

      if (isVisible === "FAVRO") {
        body = {
          adminCloudId: authCredentials?.clientId,
          code: authCredentials?.clientSecret,
          clientSecret: authCredentials?.clientId,
        };
      }

      if (isVisible === "MIXPANEL") {
        body = {
          subDomain: authCredentials?.emailId,
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
        };
      }

      if (isVisible === "EIGHTXEIGHT") {
        body = {
          subDomain: authCredentials?.clientSecret,
          code: authCredentials?.clientId,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "INSTANTLY") {
        body = {
          code: `${authCredentials.clientId}`,
        };
      }

      if (isVisible === "QUICKSIGHT_AWS") {
        body = {
          identityStoreId: authCredentials?.name,
          subDomain: authCredentials?.clientSecret,
          code: authCredentials?.clientId,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "SIGMA_COMPUTING" || isVisible === "TESTRAIL" || isVisible === "LEARNUPON") {
        body = {
          subDomain: authCredentials?.name,
          adminCloudId: authCredentials?.emailId,
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
        };
      }

      if (isVisible === "DUO") {
        body = {
          subDomain: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
          // code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientId,
        };
      }


      if (isVisible === "TABLEAU") {
        let nm = authCredentials.name.replace("https://", "");
        body = {
          code: `${authCredentials.clientId}:${nm}:${authCredentials.emailId}`,
          subDomain: authCredentials.clientSecret,
        };
      }

      if (isVisible === "OPENVPN_CLOUD" || isVisible === "ONELOGIN") {
        let authKeysBody = { ...setOauthKeysData };
        authKeysBody.clientId = authCredentials.clientId?.trim();
        authKeysBody.clientSecret = authCredentials.clientSecret?.trim();
        authKeysBody.vendor = isVisible;
        let saveAuth = await saveOauthKeys(authKeysBody);

        if (saveAuth?.status === "OK") {
          body = {
            code: `${authCredentials.emailId}`,
            subDomain: isVisible === "ONELOGIN" ? authCredentials.name : null,
          };
        } else {
          console.log(saveAuth);
          setIsPageLoading(false);
          notifyToast("error", saveAuth?.res?.message || "Failed to save API Key.");
          // return;
          body = {
            code: `${authCredentials.emailId}`,
            subDomain: isVisible === "ONELOGIN" ? authCredentials.name : null,
          };
        }
      }

      if (isVisible === "ZUBE_IO") {
        body = {
          code: `${authCredentials.clientId}`,
          clientSecret: `${window.location.hostname.split(".")[0]}/ZUBE_IO/${randomId}.pem`,
        };
      }

      if (
        isVisible === "ZUORA" ||
        isVisible === "OWNBACKUP" ||
        isVisible === "AUTH0"
      ) {
        body = {
          code: authCredentials?.clientId,
          subDomain: authCredentials?.name,
          clientSecret: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "ADOBE_CREATIVE") {
        body = {
          code: authCredentials?.clientId,
          subDomain: authCredentials?.emailId,
          clientSecret: authCredentials?.clientSecret,
        };

        let sampleBody = {
          redirectUrl: "https://cloudfuzehost.com/CloudFuze",
          clientId: authCredentials?.clientId?.trim(),
          clientSecret: authCredentials?.clientSecret?.trim(),
          vendor: "ADOBE_CREATIVE",
          clientEmail: authCredentials?.emailId?.trim(),
          appRedirectUrl: "https://cloudfuzehost.com/CloudFuze",
        };
        saveOauthKeys(sampleBody);
      }

      if (isVisible === "ZENDESK") {
        body = {
          code: `${authCredentials.clientId}:${authCredentials.clientSecret}:${authCredentials.emailId}`,
        };
      }

      if (isVisible === "LASTPASS") {
        body = {
          code: `${authCredentials.emailId}:${authCredentials.clientId}:${authCredentials.clientSecret}`,
        };
      }

      if (isVisible === "BILL_COM") {
        body = {
          code: `${authCredentials.name}:${authCredentials.emailId}`,
          subDomain: authCredentials.clientId,
          adminCloudId: authCredentials.clientSecret,
        };
      }

      if (cloudName === "SAP_HANA_CLOUD") {
        body = {
          code: setOauthKeysData?.scopes,
          subDomain: setOauthKeysData?.appRedirectUrl,
          adminCloudId: setOauthKeysData?.clientEmail,
        };
      }

      if (cloudName === "BLACKLINE") {
        body = {
          code: setOauthKeysData?.appRedirectUrl,
          subDomain: setOauthKeysData?.oauthUrl,
        };
      }

      if (cloudName === "REDHAT") {
        body = {
          code: setOauthKeysData?.clientSecret,
        };
      }

      if (cloudName === "LEARNING_360") {
        body = {
          code: setOauthKeysData?.clientId,
          subDomain: setOauthKeysData?.scopes,
          clientSecret: setOauthKeysData?.clientSecret,
          adminCloudId: setOauthKeysData?.clientEmail,
        };
      }

      if (isVisible === "AWS") {
        body = {
          code: authCredentials?.clientId,
          subDomain: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "NAMECHEAP") {
        body = {
          code: authCredentials?.clientId,
          subDomain: authCredentials?.clientSecret,
          clientSecret: authCredentials?.emailId,
        };
      }

      if (isVisible === "AIRCALL") {
        body = {
          code: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
          clientSecret: authCredentials?.clientId,
        };
      }

      if (isVisible === "GODADDY") {
        body = {
          code: authCredentials?.clientId,
          adminCloudId: authCredentials?.emailId,
          clientSecret: authCredentials?.clientSecret,
        };
      }

      if (isVisible === "TWILIO" || isVisible === "INMOMENT") {
        body = {
          clientSecret: authCredentials?.clientId,
          code: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "REDHAT") {
        body = {
          clientSecret: authCredentials?.clientSecret,
          code: authCredentials?.clientId,
        };
      }

      if (isVisible === "DYNATRACE" || isVisible === "DOCKER") {
        body = {
          identityStoreId: authCredentials?.name,
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "CROWDSTRIKE") {
        body = {
          identityStoreId: authCredentials?.name,
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
          subDomain: authCredentials?.subDomain,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "JETBRAINS") {
        body = {
          code: authCredentials?.clientId,
          subDomain: authCredentials?.name,
          clientSecret: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "AWS_IC") {
        if (authCredentials?.internal) {
          body = {
            code: authCredentials?.clientId,
            subDomain: authCredentials?.clientSecret,
            adminCloudId: authCredentials?.emailId,
            clientSecret: authCredentials?.subDomain,
            identityStoreId: authCredentials?.name,
            internal: true,
          };
        } else {
          body = {
            code: authCredentials?.clientSecret,
            subDomain: authCredentials?.clientId,
            adminCloudId: authCredentials?.emailId,
          };
        }
      }

      if (
        isVisible === "GRAMMARLY" ||
        isVisible === "DATADOG" ||
        isVisible === "AVALARA" ||
        isVisible === "WP_ENGINE" ||
        isVisible === "LARKSUITE"
      ) {
        body = {
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
        };
      }

      if (isVisible === "FRESH_DESK" || isVisible === "ACTIVECAMPAIGN" || isVisible === "WORKABLE" || isVisible === "BITDEFENDER") {
        body = {
          code: authCredentials?.clientId,
          subDomain: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "HACKERONE") {
        body = {
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.emailId,
          subDomain: authCredentials?.name,
        };
      }

      if (isVisible === "BRIVO") {
        body = {
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
          subDomain: authCredentials?.emailId,
          identityStoreId: "https://cloudfuzehost.com/CloudFuze",
        };
      }

      if (isVisible === "CHECKR" || isVisible === "CLICKSEND" || isVisible === "WISTIA" || isVisible === "DATABOX" || isVisible === "CANNY" || isVisible === "CORTEX" || isVisible === "VANTA" || isVisible === "USER_PILOT" || isVisible === "MAILTRAP" || isVisible === "SENTRY" || isVisible === "NEW_RELIC" || isVisible === "RUNN" || isVisible === "HEX" || isVisible === "CLAUDE" || isVisible === "CLOUDFLARE") {
        body = {
          adminCloudId: authCredentials?.clientId,
          code: authCredentials?.clientSecret,
        };
      }

      if (isVisible === "AUTOMOX" || isVisible === "GRAFANA" || isVisible === "KAITEN" || isVisible === "JITBIT" || isVisible === "TWINGATE" || isVisible === "EZ_OFFICE") {
        body = {
          code: authCredentials?.clientSecret,
          subDomain: authCredentials?.clientId
        }
      }

      if (isVisible === "WAFEQ" || isVisible === "TESTFAIRY" || isVisible === "ZENDUTY" || isVisible === "ARTICULATE_360" || isVisible === "FORMALIZE" || isVisible === "TWILIO_SEGMENT") {
        body = {
          code: authCredentials?.clientSecret,
          adminCloudId: authCredentials?.clientId
        }
      }

      if (isVisible === "INFORMATICA") {
        body = {
          code: authCredentials?.clientId,
          subDomain: authCredentials?.emailId,
          clientSecret: authCredentials?.clientSecret,
        };
      }
      if (isVisible === "MOUSEFLOW" || isVisible === "LAMBDATEST") {
        body = {
          clientSecret: authCredentials?.clientId,
          code: authCredentials?.clientSecret,
        };
      }

      if (
        isVisible === "CHATGPT" ||
        isVisible === "OPENAI" ||
        isVisible === "TAXJAR" ||
        isVisible === "SHIFTER_IO" ||
        isVisible === "RIPPLING" ||
        isVisible === "STATUSCAKE" ||
        isVisible === "ROLLBAR" ||
        isVisible === "KINSTA" ||
        isVisible === "GEMFURY"
      ) {
        body = {
          code: authCredentials?.clientId,
          adminCloudId: authCredentials?.emailId,
        };
      }

      if (isVisible === "ACTION1" || isVisible === "ISPRING_LEARN") {
        body = {
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
        };
      }

      if (isVisible === "PUBNUB") {
        body = {
          code: authCredentials?.clientId,
          clientSecret: authCredentials?.clientSecret,
          subDomain: authCredentials?.subDomain,
          adminCloudId: authCredentials?.emailId,
        };
      }

      const response = await saveOauthCode(isVisible || cloudName, body);

      if (response.status === "OK") {
        setIsVisible("");
        setIsPageLoading(false);
        if (response?.res === "Cloud already present") {
          notifyToast(
            "error",
            "This Account is already registered. Please use a different Account."
          );
        } else {
          notifyToast("success", "Application Added successfully!");
          setTimeout(() => {
            navigate("/Integrations/Manage");
          }, 300);
        }
      } else {
        setIsPageLoading(false);
        notifyToast("error", response?.res?.message || "Failed to save API Key.");
      }
    } catch (error) {
      notifyToast("error", error?.response?.data?.message || "An error occurred while saving the API Key.");
    } finally {
      setIsVisible("");
      setIsPageLoading(false);
      setIsApiKeySaving(false);
    }
  };

  const saveOauthKey = async () => {
    setIsApiKeySaving(true);
    let body = {
      ...setOauthKeysData,
    };
    if (body.vendor === "BAMBOOHR") {
      // body.appRedirectUrl = `https://${body.scopes}.bamboohr.com`;
      // body.clientEmail = data
      body.scopes = "";
    }
    if (body.vendor === "QUICKBOOKSONLINE") {
      body.clientEmail = body.scopes;
      body.scopes = "";
    }
    if (body.vendor === "REDHAT") {
      body.clientSecret = "";
    }
    let res = await saveOauthKeys(body);
    if (res.status === "OK") {
      setIsApiKeySaving(false);
      notifyToast(
        "success",
        `${getCloudName(setOauthKeys)} Application Configured successfully!`
      );
      if (
        setOauthKeysData.vendor === "SERVICENOW" ||
        setOauthKeysData.vendor === "YEXT" ||
        setOauthKeysData.vendor === "ZOOM" ||
        setOauthKeysData.vendor === "TEAMWORK"
      ) {
        setSetOauthKeys(false);
        setIsPageLoading(true);
        let res = await startOauth(
          setOauthKeysData.vendor,
          `${setOauthKeysData?.clientEmail}:${setOauthKeysData?.scopes}`
        );
        if (res) {
          setIsPageLoading(false);
        }
      } else if (
        setOauthKeysData.vendor === "SAP_HANA_CLOUD" ||
        setOauthKeysData.vendor === "BLACKLINE" ||
        setOauthKeysData.vendor === "LEARNING_360" ||
        setOauthKeysData.vendor === "REDHAT"
      ) {
        setSetOauthKeys(false);
        setIsPageLoading(true);
        startSaveApiKey(setOauthKeysData.vendor);
      } else if (setOauthKeysData.vendor === "TAILSCALE") {
        setSetOauthKeys(false);
        setIsPageLoading(true);
        startSaveApiKey("TAILSCALE");
      } else {
        if (
          setOauthKeysData.vendor === "ZENDESK" ||
          setOauthKeysData.vendor === "LINKEDIN" ||
          setOauthKeysData.vendor === "WORKDAY" ||
          setOauthKeysData.vendor === "BAMBOOHR"
        ) {
          setIsPageLoading(false);
          window.open(
            `${window.location.origin}/CloudFuze?addCloud=${setOauthKeysData.vendor}`,
            "Popup",
            "toolbar=no, location=no, statusbar=no, menubar=no, scrollbars=1, resizable=0, width=580, height=600, top=30"
          );
        }
        actionForOauth(setOauthKeys);
      }
      setSetOauthKeys(false);
    } else {
      console.log(res);
      startSaveApiKey("TAILSCALE");
      notifyToast("error", "Failed to save oAuth Keys.");
      setSetOauthKeys(false);
      setIsApiKeySaving(false);
    }
  };

  const addVendorWithInvoice = async (file) => {
    setIsUploadInvoice(false);
    setIsPageLoading(true);
    let res = await saveVendorWithInvoice(file);
    if (res.status === "OK") {
      setIsPageLoading(false);
      notifyToast("success", "Application Added Successfully!");
      setTimeout(() => {
        navigate("/Integrations/Manage");
      }, 300);
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed to add Application.");
    }
  };

  const handleToggleChange = (e) => {
    if (isVisible === "AWS_IC" && e.target.checked) {
      setAuthCredentials({
        internal: true,
        clientId: "",
        clientSecret: "",
        name: "",
        emailId: "",
      });
      setPlaceholderText({
        name: "Identity Store Id *",
        emailId: "Admin Email *",
        clientId: "Access Key *",
        clientSecret: "Secret Key *",
        subDomain: "Region *",
      });
    } else {
      setAuthCredentials({
        internal: false,
        clientId: "",
        clientSecret: "",
        name: "test",
        emailId: "",
      });
      setPlaceholderText({
        name: "Identity Store Id *",
        emailId: "Admin Email *",
        clientId: "SCIM URL *",
        clientSecret: "SCIM Token *",
      });
    }
  };

  const handleFileUploadStream = (file) => {
    setPemFile(file);
  };

  return (
    <>
      <div className="cf_add_cloud_filter_div">
        <span style={{ marginLeft: "auto" }}></span>
        <SearchComponent
          autoFocus={true}
          inputName="searchInput"
          inputPlaceHolder={`Search By Application Name`}
          onInputSearch={(e) => setSearchInput(e?.searchInput)}
        />

        <ActionButton
          customClass={`changeButtonColorOnHover`}
          buttonType="button"
          customStyles={{
            backgroundColor: "#f2f2f2",
          }}
          buttonClickAction={() => { }}
        >
          <div
            className={`changeButtonColorOnHover CF_d-flex ai-center`}
            onClick={() => setIsManuallyIntegration(true)}
          >
            <span style={{ fontSize: "12px" }}>Add Manually</span>
          </div>
        </ActionButton>
        <ActionButton
          customClass={`changeButtonColorOnHover cf_button_gradient`}
          buttonType="button"
          customStyles={{
            backgroundColor: "#f2f2f2",
          }}
          buttonClickAction={() => setIsUploadInvoice(true)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <Sparkles size={16} />
            <span style={{ fontSize: "12px" }}>AI-powered Invoice Parser</span>
          </div>
        </ActionButton>
      </div>
      <div className="cf_add_cloud_div">
        {integrationsList()
          ?.sort((a, b) =>
            uiConfigs?.applications
              ? uiConfigs?.applications?.length === integrationsList()?.length
                ? ""
                : uiConfigs?.applications?.includes(a?.cloudName)
                  ? -1
                  : 1
              : ""
          )
          ?.filter((data) =>
            activeCloudFilter === "ALL"
              ? data
              : activeCloudFilter === "IDENTITY_PROVIDER" &&
                (data?.cloudName === "ENTRA_SSO" || data?.cloudName === "OKTA")
                ? data
                : data?.type === activeCloudFilter
          )
          ?.filter((data) => {
            return searchInput?.trim() === ""
              ? data
              : getCloudName(data?.cloudName)
                ?.toLowerCase()
                ?.includes(searchInput?.toLowerCase());
          })
          ?.map((data, index) => {
            return (
              <button key={data?.cloudName}
                onClick={() => actionForOauth(data?.cloudName)}
                style={{ animationDelay: `${index * 0.02}s`, outline: "none", border: "none", background: "none" }}
                className={`cf_add_cloud_card ${uiConfigs?.applications
                  ? uiConfigs?.applications?.includes(data?.cloudName)
                    ? ""
                    : "cf_disabled"
                  : ""
                  }`}
              >
                <div
                  className={`cf_add_cloud_card`}
                >
                  <div
                    className={`cf_add_cloud_card_image bg-${data?.cloudName}`}
                    cloudname={data?.cloudName}
                  ></div>
                  <p
                    className="cf_add_cloud_card_title"
                    title={getCloudName(data?.cloudName)}
                  >
                    {data?.cloudName === "MEMSE3"
                      ? getMaxChar(getCloudName(data?.cloudName), 30)
                      : getCloudName(data?.cloudName)}
                  </p>
                </div>
              </button>
            );
          })}
      </div>
      {isPageLoading ? getCFLoader() : ""}
      <Popup
        options={{
          isOpen: isVisible,
          title: `${getCloudName(isVisible)} Authentication`,
          popupWidth: "700px",
          popupHeight: `fit-content`,
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{ padding: "20px 10px", flexDirection: "column", gap: "30px" }}
        >
          {isVisible === "AWS_IC" ? (
            <div
              className="CF_d-flex ai-center"
              style={{
                gap: "10px",
                justifyContent: "flex-start",
                width: "100%",
              }}
            >
              <div>Identity Store :</div>
              <div className={`CF_d-flex ai-center`} style={{ gap: "8px" }}>
                <span
                  className={`cf_switch_text ${!authCredentials?.internal ? "cf_switch_active" : ""
                    }`}
                >
                  External Provider&nbsp;&nbsp;
                </span>
                <label className="switch">
                  <input
                    type="checkbox"
                    id="splitChannels"
                    checked={authCredentials?.internal}
                    onChange={(e) => handleToggleChange(e)}
                  />
                  <span className="slider round" style={{ top: "6px" }}></span>
                </label>
                <span
                  className={`cf_switch_text ${authCredentials?.internal ? "cf_switch_active" : ""
                    }`}
                >
                  Internal Provider
                </span>
              </div>
            </div>
          ) : (
            ""
          )}
          {(isVisible === "ONELOGIN" ||
            isVisible === "BRILLIUM" ||
            isVisible === "BILL_COM" ||
            isVisible === "ZUORA" ||
            isVisible === "OWNBACKUP" ||
            isVisible === "AUTH0" ||
            isVisible === "QUICKSIGHT_AWS" ||
            isVisible === "SIGMA_COMPUTING" ||
            // isVisible === "TESTRAIL" ||
            isVisible === "HACKERONE" ||
            isVisible === "JETBRAINS" ||
            isVisible === "DYNATRACE" ||
            isVisible === "DOCKER" ||
            isVisible === "CROWDSTRIKE" ||
            isVisible === "LEARNUPON" ||
            (isVisible === "AWS_IC" && authCredentials?.internal) ||
            isVisible === "TABLEAU") && (
              <TextInput
                type={
                  placeholderText.name?.toLowerCase()?.includes("secret") ||
                    placeholderText.name?.toLowerCase()?.includes("api") ||
                    placeholderText.name?.toLowerCase()?.includes("token") ||
                    placeholderText.name?.toLowerCase()?.includes("code") ||
                    placeholderText.name?.toLowerCase()?.includes("key") ||
                    placeholderText.name?.toLowerCase()?.includes("password")
                    ? "password"
                    : "text"
                }
                autoFocus={true}
                inputWidth="100%"
                defaultValue={authCredentials.name}
                inputName="name"
                placeHolder={placeholderText.name}
                getInputText={(val) =>
                  setAuthCredentials({
                    ...authCredentials,
                    name: val,
                  })
                }
              />
            )}

          {(isVisible === "AWS_IC" && authCredentials?.internal) ||
            isVisible === "PUBNUB" ||
            isVisible === "CROWDSTRIKE" ? (
            <TextInput
              type={
                placeholderText.subDomain?.toLowerCase()?.includes("secret") ||
                  placeholderText.subDomain?.toLowerCase()?.includes("api") ||
                  placeholderText.subDomain?.toLowerCase()?.includes("token") ||
                  placeholderText.subDomain?.toLowerCase()?.includes("code") ||
                  placeholderText.subDomain?.toLowerCase()?.includes("key") ||
                  placeholderText.subDomain?.toLowerCase()?.includes("password")
                  ? "password"
                  : "text"
              }
              autoFocus={false}
              inputWidth="100%"
              defaultValue={authCredentials.subDomain}
              inputName="subDomain"
              placeHolder={placeholderText.subDomain}
              getInputText={(val) =>
                setAuthCredentials({
                  ...authCredentials,
                  subDomain: val,
                })
              }
            />
          ) : (
            ""
          )}

          {isVisible === "ZENDESK" ||
            isVisible === "DUO" ||
            isVisible === "THINKIFIC" ||
            isVisible === "HELP_DESK" ||
            isVisible === "CODER_BYTE" ||
            isVisible === "INSIGHTFUL" ||
            isVisible === "BRILLIUM" ||
            isVisible === "BUSINESSMAP" ||
            isVisible === "FRESHCHAT" ||
            isVisible === "ONE_PASSWORD" ||
            isVisible === "FRESHDESK" ||
            isVisible === "ZENDESK" ||
            isVisible === "ONELOGIN" ||
            isVisible === "ZUORA" ||
            isVisible === "OWNBACKUP" ||
            isVisible === "LASTPASS" ||
            isVisible === "FILES_COM" ||
            isVisible === "TABLEAU" ||
            isVisible === "LEARNUPON" ||
            isVisible === "BILL_COM" ||
            isVisible === "AWS" ||
            isVisible === "AWS_IC" ||
            isVisible === "ADOBE_CREATIVE" ||
            isVisible === "INFORMATICA" ||
            isVisible === "CHATGPT" ||
            isVisible === "OPENAI" ||
            isVisible === "TAXJAR" ||
            isVisible === "SHIFTER_IO" ||
            isVisible === "STATUSCAKE" ||
            isVisible === "ROLLBAR" ||
            isVisible === "KINSTA" ||
            isVisible === "GEMFURY" ||
            isVisible === "OPENVPN_CLOUD" ||
            isVisible === "FRESH_DESK" ||
            isVisible === "BITDEFENDER" ||
            isVisible === "WORKABLE" ||
            isVisible === "RIPPLING" ||
            isVisible === "TWILIO" ||
            isVisible === "DYNATRACE" ||
            isVisible === "DOCKER" ||
            isVisible === "INMOMENT" ||
            isVisible === "NAMECHEAP" ||
            isVisible === "AUTH0" ||
            isVisible === "JETBRAINS" ||
            isVisible === "PUBNUB" ||
            isVisible === "MONGODBATLAS" ||
            isVisible === "DOMO" ||
            isVisible === "QUICKSIGHT_AWS" ||
            isVisible === "SIGMA_COMPUTING" ||
            // isVisible === "TESTRAIL" ||
            isVisible === "HACKERONE" ||
            isVisible === "AIRCALL" ||
            isVisible === "GODADDY" ||
            isVisible === "MIXPANEL" ||
            isVisible === "CROWDSTRIKE" ||
            isVisible === "BRIVO" ||
            isVisible === "EIGHTXEIGHT" ||
            isVisible === "ACTIVECAMPAIGN" ? (
            <TextInput
              type={
                placeholderText.emailId?.toLowerCase()?.includes("secret") ||
                  placeholderText.emailId?.toLowerCase()?.includes("api") ||
                  placeholderText.emailId?.toLowerCase()?.includes("token") ||
                  placeholderText.emailId?.toLowerCase()?.includes("code") ||
                  placeholderText.emailId?.toLowerCase()?.includes("key") ||
                  placeholderText.emailId?.toLowerCase()?.includes("password")
                  ? "password"
                  : "text"
              }
              autoFocus={true}
              inputWidth="100%"
              defaultValue={authCredentials.emailId}
              inputName="emailId"
              placeHolder={placeholderText.emailId}
              getInputText={(val) =>
                setAuthCredentials({
                  ...authCredentials,
                  emailId: val,
                })
              }
            />
          ) : (
            ""
          )}

          <TextInput
            type={
              placeholderText.clientId?.toLowerCase()?.includes("secret") ||
                placeholderText.clientId?.toLowerCase()?.includes("api") ||
                placeholderText.clientId?.toLowerCase()?.includes("token") ||
                placeholderText.clientId?.toLowerCase()?.includes("code") ||
                placeholderText.clientId?.toLowerCase()?.includes("key") ||
                placeholderText.clientId?.toLowerCase()?.includes("password")
                ? "password"
                : "text"
            }
            autoFocus={true}
            inputWidth="100%"
            defaultValue={authCredentials.clientId}
            inputName="clientId"
            placeHolder={placeholderText.clientId}
            getInputText={(val) =>
              setAuthCredentials({
                ...authCredentials,
                clientId: val,
              })
            }
          />
          {isVisible !== "JUMPCLOUD" &&
            isVisible !== "INSIGHTLY" &&
            isVisible !== "FRESHCHAT" &&
            isVisible !== "SENDGRID" &&
            isVisible !== "FRESHDESK" &&
            isVisible !== "POSTMAN" &&
            isVisible !== "FASTLY" &&
            isVisible !== "CODA" &&
            isVisible !== "CANVA" &&
            isVisible !== "UBERALL" &&
            isVisible !== "MEMZO" &&
            isVisible !== "SLING" &&
            isVisible !== "APPVEYOR" &&
            isVisible !== "PLANHAT" &&
            isVisible !== "POSTHOG" &&
            isVisible !== "UNBOUNCE" &&
            isVisible !== "LAUNCH_DARKLY" &&
            isVisible !== "VISUAL_VISITOR" &&
            isVisible !== "JOTFORM" &&
            isVisible !== "SNYK" &&
            isVisible !== "ROCKET_REACH" &&
            isVisible !== "UPTIME_ROBOT" &&
            isVisible !== "VERCEL" &&
            isVisible !== "PISIGNAGE" &&
            isVisible !== "THINKIFIC" &&
            isVisible !== "HELP_DESK" &&
            isVisible !== "CODER_BYTE" &&
            isVisible !== "INSIGHTFUL" &&
            isVisible !== "LAUNCHDARKLY" &&
            isVisible !== "BUSINESSMAP" &&
            isVisible !== "CURSOR_AI" &&
            isVisible !== "SHORTCUT" &&
            isVisible !== "DIGICERT" &&
            isVisible !== "PANDADOC" &&
            isVisible !== "SMART_BEAR" &&
            isVisible !== "TERRAFORM" &&
            isVisible !== "RIPPLING" &&
            isVisible !== "MAILGUN" &&
            isVisible !== "LATTICE" &&
            isVisible !== "TRELLO" &&
            isVisible !== "INSTANTLY" &&
            isVisible !== "STRIPE" &&
            isVisible !== "FIVETRAN" &&
            // isVisible !== "ONE_PASSWORD" &&
            isVisible !== "DOCUMENT360" &&
            isVisible !== "TAXJAR" &&
            isVisible !== "SHIFTER_IO" &&
            isVisible !== "STATUSCAKE" &&
            isVisible !== "ROLLBAR" &&
            isVisible !== "KINSTA" &&
            isVisible !== "GEMFURY" &&
            isVisible !== "CHATGPT" &&
            isVisible !== "OPENAI" &&
            isVisible !== "CALENDAR_HERO" &&
            isVisible !== "ZUBE_IO" ? (
            <TextInput
              type={
                placeholderText.clientSecret
                  ?.toLowerCase()
                  ?.includes("secret") ||
                  placeholderText.clientSecret?.toLowerCase()?.includes("api") ||
                  placeholderText.clientSecret
                    ?.toLowerCase()
                    ?.includes("token") ||
                  placeholderText.clientSecret?.toLowerCase()?.includes("code") ||
                  placeholderText.clientSecret?.toLowerCase()?.includes("key") ||
                  placeholderText.clientSecret
                    ?.toLowerCase()
                    ?.includes("password")
                  ? "password"
                  : "text"
              }
              autoFocus={true}
              inputWidth="100%"
              defaultValue={authCredentials.clientSecret}
              inputName="clientSecret"
              placeHolder={placeholderText.clientSecret}
              getInputText={(val) =>
                setAuthCredentials({
                  ...authCredentials,
                  clientSecret: val,
                })
              }
            />
          ) : (
            ""
          )}
          {isVisible === "ZUBE_IO" ? (
            <div style={{ display: "flex", width: "100%" }}>
              <ActionButton buttonType="file" fileType=".pem" getFileStream={handleFileUploadStream}
                customStyles={{ backgroundColor: "#f0f0f0", color: "#000", border: "1px solid #ccc", borderRadius: "5px", padding: "5px 10px", cursor: "pointer" }}
              ><div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <FileIcon size={12} />
                  <span style={{ fontSize: "12px" }}>{pemFile ? pemFile?.name : "Upload PEM File *"}</span>
                </div></ActionButton>
            </div>
          ) : (
            ""
          )}
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="140px"
            isLoading={isApiKeySaving}
            isDisabled={
              isVisible === "ZUBE_IO" ? pemFile && authCredentials?.clientId.length > 0 ? false : true : false ||
                authCredentials.emailId?.length === 0 ||
                authCredentials.clientId?.length === 0 ||
                authCredentials.clientSecret?.length === 0 ||
                isApiKeySaving
            }
            buttonName="Add Application"
            buttonClickAction={() => startSaveApiKey()}
          />
        </div>
      </Popup>
      <Popup
        options={{
          isOpen: setOauthKeys,
          title: `Configure ${getCloudName(setOauthKeys)} Oauth2 Application`,
          popupWidth: "480px",
          popupHeight: `fit-content`,
          // isVisible === "ZENDESK" || isVisible === "DUO" ? "350px" : "300px"
          popupTop: setOauthKeysData.vendor === "AWS" ? "70px" : "120px",
        }}
        toggleOpen={setSetOauthKeys}
      >
        <div
          className="cf_popup_container_body"
          style={{ padding: "20px 10px", flexDirection: "column", gap: "30px" }}
        >
          <TextInput
            type="text"
            autoFocus={true}
            inputWidth="100%"
            defaultValue={setOauthKeysData.clientId}
            inputName="clientId"
            placeHolder={setOauthKeysData.vendor === "REDHAT" ? "Service Name *" : "Client ID *"}
            getInputText={(val) =>
              setSetOauthKeysData({ ...setOauthKeysData, clientId: val })
            }
          />
          <TextInput
            type="password"
            autoFocus={false}
            inputWidth="100%"
            defaultValue={setOauthKeysData.clientSecret}
            inputName="clientSecret"
            placeHolder={setOauthKeysData.vendor === "REDHAT" ? "Offline Token *" : "Client Secret *"}
            getInputText={(val) =>
              setSetOauthKeysData({ ...setOauthKeysData, clientSecret: val })
            }
          />
          {setOauthKeysData.vendor === "TAILSCALE" ||
            setOauthKeysData.vendor === "AWS" ||
            setOauthKeysData.vendor === "AWS_IC" ||
            // setOauthKeysData.vendor === "BAMBOOHR" ||
            setOauthKeysData.vendor === "QUICKBOOKSONLINE" ||
            setOauthKeysData.vendor === "SAP_HANA_CLOUD" ||
            setOauthKeysData.vendor === "SERVICENOW" ||
            setOauthKeysData.vendor === "BLACKLINE" ||
            // setOauthKeysData.vendor === "LEARNING_360" ||
            setOauthKeysData.vendor === "LINKEDIN" ? (
            <>
              {setOauthKeysData.vendor !== "BAMBOOHR" &&
                setOauthKeysData.vendor !== "BLACKLINE" &&
                setOauthKeysData.vendor !== "QUICKBOOKSONLINE" &&
                setOauthKeysData.vendor !== "LINKEDIN" ? (
                <TextInput
                  type="text"
                  autoFocus={false}
                  inputWidth="100%"
                  defaultValue={setOauthKeysData.clientEmail}
                  inputName="clientEmail"
                  placeHolder={
                    setOauthKeysData.vendor === "LEARNING_360"
                      ? "User ID *"
                      : setOauthKeysData.vendor === "SERVICENOW"
                        ? "Subdomain *"
                        : setOauthKeysData.vendor === "SAP_HANA_CLOUD"
                          ? "Admin Email *"
                          : setOauthKeysData.vendor === "ZENDESK"
                            ? "Domain *"
                            : setOauthKeysData.vendor === "AWS"
                              ? "Access Key *"
                              : "Organization Domain *"
                  }
                  getInputText={(val) =>
                    setSetOauthKeysData({
                      ...setOauthKeysData,
                      clientEmail: val,
                    })
                  }
                />
              ) : (
                ""
              )}

              {setOauthKeysData.vendor === "AWS" ||
                setOauthKeysData.vendor === "SAP_HANA_CLOUD" ||
                setOauthKeysData.vendor === "BLACKLINE" ? (
                <TextInput
                  type={
                    setOauthKeysData.vendor === "BLACKLINE"
                      ? "password"
                      : "text"
                  }
                  autoFocus={false}
                  inputWidth="100%"
                  defaultValue={setOauthKeysData.appRedirectUrl}
                  inputName="appRedirectUrl"
                  placeHolder={
                    setOauthKeysData.vendor === "BLACKLINE"
                      ? "Password *"
                      : setOauthKeysData.vendor === "SAP_HANA_CLOUD"
                        ? "Authentication URL *"
                        : "Secret Key *"
                  }
                  getInputText={(val) =>
                    setSetOauthKeysData({
                      ...setOauthKeysData,
                      appRedirectUrl: val,
                    })
                  }
                />
              ) : (
                ""
              )}
              {setOauthKeysData.vendor !== "ZENDESK" ? (
                <TextInput
                  type="text"
                  autoFocus={false}
                  inputWidth="100%"
                  defaultValue={setOauthKeysData.scopes}
                  inputName="clientEmail"
                  placeHolder={
                    setOauthKeysData.vendor === "LEARNING_360"
                      ? "Company ID *"
                      : setOauthKeysData.vendor === "SERVICENOW"
                        ? "Username *"
                        : setOauthKeysData.vendor === "SAP_HANA_CLOUD"
                          ? "Instance URL *"
                          : setOauthKeysData.vendor === "LINKEDIN" ||
                            setOauthKeysData.vendor === "BLACKLINE"
                            ? "Scopes *"
                            : setOauthKeysData.vendor === "QUICKBOOKSONLINE"
                              ? "Comany ID *"
                              : setOauthKeysData.vendor === "BAMBOOHR"
                                ? "BambooHR Company Domain *"
                                : setOauthKeysData.vendor === "AWS"
                                  ? "AWS Region *"
                                  : "API Key *"
                  }
                  getInputText={(val) =>
                    setSetOauthKeysData({ ...setOauthKeysData, scopes: val })
                  }
                />
              ) : (
                ""
              )}
              {setOauthKeysData.vendor === "AWS" ||
                setOauthKeysData.vendor === "BLACKLINE" ? (
                <TextInput
                  type="text"
                  autoFocus={false}
                  inputWidth="100%"
                  defaultValue={setOauthKeysData.oauthUrl}
                  inputName="oauthUrl"
                  placeHolder={
                    setOauthKeysData.vendor === "BLACKLINE"
                      ? "Environment *"
                      : "AWS Account URL *"
                  }
                  getInputText={(val) =>
                    setSetOauthKeysData({
                      ...setOauthKeysData,
                      oauthUrl: val,
                    })
                  }
                />
              ) : (
                ""
              )}
            </>
          ) : (
            ""
          )}
          {setOauthKeysData.vendor !== "REDHAT" && <TextInput
            type="text"
            autoFocus={false}
            inputWidth="100%"
            defaultValue={setOauthKeysData.redirectUrl}
            inputName="redirectUrl"
            placeHolder="Redirect URL *"
            getInputText={(val) =>
              setSetOauthKeysData({ ...setOauthKeysData, redirectUrl: val })
            }
            readOnly={true}
            copyToClipboard={true}
            copyButtonText="Redirect URL"
          />}
          {!setOauthKeysData.vendor === "AWS" ? (
            <TextInput
              type="text"
              autoFocus={false}
              inputWidth="100%"
              defaultValue={getOauthScopes(setOauthKeysData.vendor)}
              inputName="redirectUrl"
              placeHolder="Scopes *"
              getInputText={(val) =>
                setSetOauthKeysData({ ...setOauthKeysData, redirectUrl: val })
              }
              readOnly={true}
              copyToClipboard={true}
              copyButtonText="Scopes"
            />
          ) : (
            ""
          )}
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={isApiKeySaving}
            isDisabled={
              !(setOauthKeysData.vendor === "AWS"
                ? setOauthKeysData.clientEmail &&
                setOauthKeysData.appRedirectUrl &&
                setOauthKeysData.scopes &&
                setOauthKeysData.oauthUrl &&
                setOauthKeysData.clientId &&
                setOauthKeysData.clientSecret &&
                setOauthKeysData.redirectUrl
                : setOauthKeysData.clientId &&
                setOauthKeysData.clientSecret &&
                setOauthKeysData.redirectUrl &&
                (setOauthKeysData.vendor !== "TAILSCALE" ||
                  setOauthKeysData.clientEmail))
            }
            buttonName="Save"
            buttonClickAction={() => saveOauthKey()}
          />
        </div>
      </Popup>
      <CloudIntegrateManually
        isManuallyIntegration={isManuallyIntegration}
        setIsManuallyIntegration={setIsManuallyIntegration}
        setIsPageLoading={setIsPageLoading}
      />
      {/* <InVoiceFileUpload
        isUploadInvoice={isUploadInvoice}
        setIsUploadInvoice={setIsUploadInvoice}
      /> */}
      <InVoiceFileUploadNew
        isUploadInvoice={isUploadInvoice}
        setIsUploadInvoice={setIsUploadInvoice}
      />
    </>
  );
};

export default CloudsList;
