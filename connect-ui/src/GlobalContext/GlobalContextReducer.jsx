import {
  RESET_APP_CONTEXT,
  RESET_MAPPING_PAIRS,
  RESET_SAAS_DATA,
  SET_AUTH_TOKEN,
  SET_BILLING_SUMMARY,
  SET_CF_USER,
  SET_CLOUDS_LIST,
  SET_CSV_MAPPING_ID,
  SET_DESTINATION_MAPPING,
  SET_GROUPS_TEAMS_LIST,
  SET_GROUPS_TEAMS_SUMMARY,
  SET_JOB_DETAILS,
  SET_MAPPED_PAIRS,
  SET_OAUTH_STATUS,
  SET_RESOURCE_APP_LIST,
  SET_RESOURCE_APP_SUMMARY,
  SET_SAAS_CLOUD,
  SET_SELECTED_CHANNELS_MAPPING,
  SET_SELECTED_DESTINATION_CLOUD,
  SET_SELECTED_DMS_MAPPING,
  SET_SELECTED_SOURCE_CLOUD,
  SET_SESSION_TIME,
  SET_SIDEBAR_COLLAPSED,
  SET_SOURCE_MAPPING,
  SET_UPDATE_JOB_PARAMS,
} from "./action.types";

let GlobalContextReducer = (state, action) => {
  switch (action?.type) {
    case SET_CF_USER:
      return {
        ...state,
        user: action.payload,
        time: new Date().getTime(),
        userId: action?.payload?.id,
        userEmail: action?.payload?.primaryEmail,
      };
    case SET_BILLING_SUMMARY:
      return { ...state, billingSummary: action.payload };
    case SET_SESSION_TIME:
      return { ...state, time: action.payload };
    case SET_AUTH_TOKEN:
      return { ...state, authToken: action.payload };
    case SET_CLOUDS_LIST:
      return { ...state, cloudsList: action.payload };
    case SET_SELECTED_SOURCE_CLOUD:
      return { ...state, sourceCloud: action.payload };
    case SET_SELECTED_DESTINATION_CLOUD:
      return { ...state, destinationCloud: action.payload };
    case SET_OAUTH_STATUS:
      return { ...state, oauthStatus: action.payload };
    case SET_SOURCE_MAPPING:
      return { ...state, mappingSource: action.payload };
    case SET_DESTINATION_MAPPING:
      return { ...state, mappingDestination: action.payload };
    case RESET_MAPPING_PAIRS:
      return { ...state, mappingSource: [], mappingDestination: [] };
    case SET_MAPPED_PAIRS:
      return { ...state, mappedPairs: action.payload };
    case SET_JOB_DETAILS:
      return { ...state, jobDetails: action.payload };
    case SET_CSV_MAPPING_ID:
      return { ...state, csvId: action.payload };
    case SET_UPDATE_JOB_PARAMS:
      return { ...state, jobParams: action.payload };
    case SET_SAAS_CLOUD:
      return { ...state, saasCloud: action.payload };
    case SET_RESOURCE_APP_SUMMARY:
      return { ...state, resourceAppsSummary: action.payload };
    case SET_RESOURCE_APP_LIST:
      return { ...state, resourceAppsList: action.payload };
    case SET_GROUPS_TEAMS_SUMMARY:
      return { ...state, groupsTeamsSummary: action.payload };
    case SET_GROUPS_TEAMS_LIST:
      return { ...state, groupsTeamsList: action.payload };
    case RESET_SAAS_DATA:
      return {
        ...state,
        resourceAppsSummary: {},
        resourceAppsList: [],
        groupsTeamsSummary: {},
        groupsTeamsList: [],
      };
    case SET_SELECTED_CHANNELS_MAPPING:
      return { ...state, channelsMappingsList: action.payload };
    case SET_SELECTED_DMS_MAPPING:
      return { ...state, dmsMappingsList: action.payload };
    case SET_SIDEBAR_COLLAPSED:
      return { ...state, sidebarCollapsed: action.payload };
    case RESET_APP_CONTEXT:
      return {
        time: 0,
        user: {},
        userId: "",
        csvId: "",
        userEmail: "",
        authToken: "",
        jobDetails: {},
        oauthStatus: "",
        jobParams: "",
        mappingSource: [],
        mappingDestination: [],
        mappedPairs: [],
        cloudsList: [],
        sourceCloud: {},
        rolesList: [],
        saasCloud: {},
        destinationCloud: {},
        groupsTeamsList: [],
        channelsMappingsList: {
          public: [],
          private: [],
          publicIds: [],
          privateIds: [],
        },
        dmsMappingsList: {
          dms: [],
          dmIds: [],
        },
        resourceAppsList: [],
        groupsTeamsSummary: {},
        resourceAppsSummary: {},
      };
    default:
      break;
  }
};

export default GlobalContextReducer;
