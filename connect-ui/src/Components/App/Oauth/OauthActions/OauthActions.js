import { getUserId, notifyToast } from "../../../helpers/utils";
import { getOauthKeys } from "./OauthApiActions";

export const getOauthUrl = async (cloudName, domainName) => {
  domainName = domainName ?? "";
  let urlMapper = {
    GOOGLE_WORKSPACE: `https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&approval_prompt=force&flowName=GeneralOAuthFlow`,
    MICROSOFT_OFFICE_365: `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?response_type=code&prompt=login`,
    ENTRA_SSO: `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?response_type=code&prompt=login`,
    AZURE_ACTIVE_DIRECTORY: `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?response_type=code&prompt=login`,
    MEMSE3: `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?response_type=code&prompt=login`,
    GOOGLE_SHARED_DRIVES: `https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&approval_prompt=force`,
    ONEDRIVE_BUSINESS_ADMIN: `https://login.microsoftonline.com/common/oauth2/authorize?response_type=code&prompt=login`,
    SLACK: `https://slack.com/oauth/authorize`,
    MICROSOFT_TEAMS: `https://login.microsoftonline.com/common/oauth2/authorize?response_type=code&response_mode=query&sso_reload=true&prompt=login`,
    DROPBOX_BUSINESS: `https://www.dropbox.com/oauth2/authorize?response_type=code&token_access_type=offline`,
    OUTLOOK: `https://login.microsoftonline.com/common/oauth2/authorize?response_type=code&prompt=admin_consent`,
    GMAIL: `https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&approval_prompt=force`,
    GOOGLE_CHAT: `https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&approval_prompt=force`,
    G_SUITE: `https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&approval_prompt=force`,
    BOX_BUSINESS: `https://account.box.com/api/oauth2/authorize?response_type=code`,
    SHAREPOINT_ONLINE_BUSINESS: `https://login.microsoftonline.com/common/oauth2/authorize?response_type=code&response_mode=query&prompt=login`,
    LUCID: `https://lucid.app/oauth2/authorizeAccount?`,
    MURAL: `https://app.mural.co/api/public/v1/authorization/oauth2/?response_type=code`,
    MIRO: `https://miro.com/oauth/authorize?response_type=code`,
    NOTION: `https://api.notion.com/v1/oauth/authorize?response_type=code&owner=user`,
    AUTODESK: `https://developer.api.autodesk.com/authentication/v2/authorize?response_type=code`,
    ZOHO: `https://accounts.zoho.in/oauth/v2/auth?response_type=code&access_type=offline&prompt=consent`,
    ZOHO_DESK:
      "https://accounts.zoho.in/oauth/v2/auth?response_type=code&access_type=offline&prompt=consent",
    ZOHO_INVENTORY:
      "https://accounts.zoho.in/oauth/v2/auth?response_type=code&access_type=offline&prompt=consent",
    ZOHO_MAIL:
      "https://accounts.zoho.in/oauth/v2/auth?prompt=consent&response_type=code&access_type=offline&prompt=consent",
    ZOHO_PROJECTS:
      "https://accounts.zoho.in/oauth/v2/auth?response_type=code&access_type=offline&prompt=consent",
    ZOHO_WORKDRIVE:
      "https://accounts.zoho.in/oauth/v2/auth?response_type=code&access_type=offline&prompt=consent",
    WRIKE: "https://login.wrike.com/oauth2/authorize/v4?response_type=code",
    BITBUCKET: "https://bitbucket.org/site/oauth2/authorize?response_type=code",
    PAGERDUTY: "https://identity.pagerduty.com/oauth/authorize?response_type=code",
    HEROKU: "https://id.heroku.com/oauth/authorize?response_type=code",
    LINODE: "https://login.linode.com/oauth/authorize?response_type=code",
    WEBFLOW: `https://webflow.com/oauth/authorize?response_type=code`,
    CISCO_WEBEX_TEAMS: `https://webexapis.com/v1/authorize?response_type=code`,
    XERO: `https://login.xero.com/identity/connect/authorize?response_type=code`,
    INTERCOM: `https://app.intercom.io/oauth?response_type=code`,
    ONELOGIN: `https://${domainName}.onelogin.com/oidc/2/auth?response_type=code`,
    MONDAY: `https://auth.monday.com/oauth2/authorize?response_type=code`,
    JIRA: `https://auth.atlassian.com/authorize?audience=api.atlassian.com&response_type=code&prompt=consent`,
    UIPATH: `https://cloud.uipath.com/identity_/connect/authorize?response_type=code`,
    SMARTSHEET: `https://app.smartsheet.com/b/authorize?response_type=code`,
    GITLAB: `https://gitlab.com/oauth/authorize?response_type=code`,
    ASANA: `https://app.asana.com/-/oauth_authorize?response_type=code`,
    WORDPRESS: `https://public-api.wordpress.com/oauth2/authorize?response_type=code`,
    FIGMA: `https://www.figma.com/oauth?response_type=code`,
    TRELLO: `https://trello.com/1/authorize?response_type=token`,
    GOTOMEETING:
      "https://authentication.logmeininc.com/oauth/authorize?response_type=code",
    DOCUSIGN: "https://account-d.docusign.com/oauth/auth?response_type=code",
    HELLOSIGN: "https://app.hellosign.com/oauth/authorize?response_type=code",
    SALESFORCE: `https://login.salesforce.com/services/oauth2/authorize?response_type=code&code_challenge=${domainName}&code_challenge_method=S256`,
    CALENDLY: "https://auth.calendly.com/oauth/authorize?response_type=code",
    AIRTABLE: `https://airtable.com/oauth2/v1/authorize?response_type=code&code_challenge=${await getUserId()}`,
    CLICKUP: "https://app.clickup.com/api?response_type=code",
    BASECAMP: `https://launchpad.37signals.com/authorization/new?type=web_server`,
    MAILCHIMP: `https://login.mailchimp.com/oauth2/authorize?response_type=code`,
    EVENTBRITE: "https://www.eventbrite.com/oauth/authorize?response_type=code",
    FRESHBOOKS:
      "https://auth.freshbooks.com/oauth/authorize?response_type=code",
    TWITCH: "https://id.twitch.tv/oauth2/authorize?response_type=code",
    VIMEO: "https://api.vimeo.com/oauth/authorize?response_type=code",
    SHARE_FILE_BUSINESS: `https://secure.sharefile.com/oauth/authorize?response_type=code`,
    HARVEST: "https://id.getharvest.com/oauth2/authorize?response_type=code",
    NETLIFY: "https://app.netlify.com/authorize?response_type=code",
    APPFIGURES: `https://api.appfigures.com/v2/oauth2/authorize?response_type=code`,
    PIPEDRIVE: `https://oauth.pipedrive.com/oauth/authorize?response_type=code`,
    HUBSPOT: `https://app.hubspot.com/oauth/authorize?response_type=code`,
    MS_VIVA_ENGAGE: `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?response_type=code`,
    MS_VIVA_ENGAGE_GRAPH: `https://login.microsoftonline.com/common/oauth2/authorize?response_type=code&prompt=login`,
    LINKEDIN:
      "https://www.linkedin.com/oauth/v2/authorization?response_type=code",
    CANVA: `https://www.canva.com/api/oauth/authorize?code_challenge_method=s256&response_type=code&code_challenge=SVbxsbD9o6L3CFIsGMbuvPgW-cdCpdVFnPQGmSz6MG4`,
    GITHUB: `https://github.com/login/oauth/authorize`,
    ATLASSIAN: `https://auth.atlassian.com/authorize?audience=api.atlassian.com&response_type=code&prompt=consent`,
    CONFLUENCE: `https://auth.atlassian.com/authorize?audience=api.atlassian.com&response_type=code&prompt=consent`,
    ADOBE_CREATIVE: `https://ims-na1.adobelogin.com/ims/authorize?response_type=code`,
    ZOOM: `https://zoom.us/oauth/authorize?response_type=code`,
    TEAMWORK: `https://www.teamwork.com/launchpad/login?response_type=code`,
    ZENDESK: `https://${domainName}.zendesk.com/oauth/authorizations/new?response_type=code&`,
    EGNYTE_ADMIN: `https://${domainName}.egnyte.com/puboauth/token?response_type=code`,
    GUSTO: `https://api.gusto-demo.com/oauth/authorize?response_type=code`,
    BAMBOOHR: `https://${domainName}.bamboohr.com/authorize.php?request=authorize&state=new&response_type=code`,
    QUICKBOOKSONLINE: `https://appcenter.intuit.com/connect/oauth2?response_type=code`,
    ZOHOCRM: `https://accounts.zoho.com/oauth/v2/auth?access_type=offline&prompt=consent&response_type=code`,
    SERVICENOW: `https://${domainName}.service-now.com/oauth_auth.do?response_type=code`,
    CONTENTFUL: `https://be.contentful.com/oauth/authorize?response_type=code`,
    WORKDAY: `https://${domainName?.split(":")[0]}.workday.com/${domainName?.split(":")[1]}/authorize?response_type=code`,
    DYNAMICS_365_SALES: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?response_type=code`,
    YEXT: `https://www.yext.com/oauth2/authorize?response_type=code&grant_type=authorization_code`,
    XCORP: `https://twitter.com/i/oauth2/authorize?response_type=code&code_challenge=cloudfuze_challenge&code_challenge_method=plain`,
    AZURE_DEVOPS: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?response_type=code&response_mode=query`,
    ENVOY: `https://app.envoy.com/a/auth/v0/authorize?response_type=code`,
    APOLLO_IO: "https://app.apollo.io/#/oauth/authorize?response_type=code",
    AHA: `https://${domainName}.aha.io/oauth/authorize?response_type=code`,
    DIGITALOCEAN: `https://cloud.digitalocean.com/v1/oauth/authorize?response_type=code`,
    AIKIDO: `https://app.aikido.dev/oauth/authorize?response_type=code`,
    CLOSE: `https://app.close.com/oauth2/authorize?response_type=code`,
    PRODUCTBOARD: `https://app.productboard.com/oauth2/authorize?response_type=code`,
    SIGNNOW: `https://app.signnow.com/authorize?response_type=code`,
    FRONT: `https://app.frontapp.com/oauth/authorize?response_type=code`,
    REDHAT: `https://sso.redhat.com/auth/realms/redhat-external/protocol/openid-connect/auth?response_type=code`,
    SURVEYMONKEY: `https://api.surveymonkey.com/oauth/authorize?response_type=code`,
    DEEL: `https://app.deel.com/oauth2/authorize?response_type=code`,
    HUBSTAFF: `https://account.hubstaff.com/authorizations/new?response_type=code&nonce=` + new Date().getTime(),
  };
  return urlMapper[cloudName];
};

export const getOauthScopes = (cloudName, domainName) => {
  let scopeMapper = {
    MICROSOFT_OFFICE_365: `offline_access https://graph.microsoft.com/.default`,
    AZURE_ACTIVE_DIRECTORY: `offline_access AccessReview.Read.All AdministrativeUnit.Read.All AuditLog.Read.All Device.Read.All Directory.ReadWrite.All Domain.ReadWrite.All Files.ReadWrite.All Group.ReadWrite.All Reports.Read.All Sites.FullControl.All Financials.ReadWrite.All PartnerBilling.Read.All`,
    ENTRA_SSO: `offline_access https://graph.microsoft.com/.default`,
    MEMSE3: `offline_access AccessReview.Read.All AdministrativeUnit.Read.All AuditLog.Read.All Device.Read.All Directory.ReadWrite.All Domain.ReadWrite.All Files.ReadWrite.All Group.ReadWrite.All Reports.Read.All Sites.FullControl.All Financials.ReadWrite.All PartnerBilling.Read.All`,
    GOOGLE_WORKSPACE: `https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email`,
    GOOGLE_SHARED_DRIVES: `email+https://www.googleapis.com/auth/drive+https://www.googleapis.com/auth/admin.directory.user.readonly+https://apps-apis.google.com/a/feeds/domain/`,
    ONEDRIVE_BUSINESS_ADMIN: `offline_access`,
    SLACK: `usergroups:write,team.billing:read,admin,identify,channels:history,groups:history,im:history,mpim:history,channels:read,emoji:read,files:read,groups:read,im:read,mpim:read,users:read,users:read.email,users.profile:read,channels:write,chat:write:user,files:write:user,groups:write,im:write,mpim:write,reactions:write,usergroups:read,team:read,search:read`,
    MICROSOFT_TEAMS: `Sites.ReadWrite.All ChannelMember.ReadWrite.All Reports.Read.All Files.ReadWrite.All offline_access`,
    OUTLOOK: `offline_access Mail.ReadWrite Mail.Send Mail.ReadBasic.All MailboxSettings.ReadWrite`,
    GMAIL: `https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/admin.directory.user.readonly`,
    GOOGLE_CHAT: `https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/admin.directory.user.readonly`,
    G_SUITE: `email+https://www.googleapis.com/auth/drive+https://www.googleapis.com/auth/admin.directory.user.readonly+https://apps-apis.google.com/a/feeds/domain/`,
    SHAREPOINT_ONLINE_BUSINESS: `offline_access`,
    LUCID: `offline_access account.user account.info`,
    MURAL: `users:read identity:read murals:read workspaces:read`,
    AUTODESK: `data:read data:write`,
    ZOHO: `aaaserver.profile.read,Desk.contacts.READ,Desk.events.ALL,Desk.settings.READ,Desk.basic.READ`,
    ZOHO_DESK:
      "aaaserver.profile.read,Desk.contacts.READ,Desk.events.ALL,Desk.settings.READ,Desk.basic.READ",
    ZOHO_INVENTORY:
      "ZohoInventory.invoices.CREATE,ZohoInventory.invoices.READ,ZohoInventory.invoices.UPDATE,ZohoInventory.invoices.DELETE,ZohoInventory.contacts.READ,ZohoInventory.settings.READ,ZohoInventory.contacts.READ",
    ZOHO_MAIL:
      "ZohoMail.partner.organization.READ,ZohoMail.accounts.READ,ZohoMail.organization.audit.READ,ZohoMail.organization.domains.READ,ZohoMail.organization.groups.READ,ZohoMail.organization.all,ZohoMail.organization.accounts.ALL",
    ZOHO_PROJECTS:
      "ZohoProjects.users.READ,ZohoProjects.portals.READ,ZohoProjects.events.ALL,ZohoProjects.portals.ALL,ZohoProjects.projects.ALL,ZohoProjects.users.ALL",
    ZOHO_WORKDRIVE:
      "WorkDrive.team.READ,WorkDrive.members.READ,WorkDrive.groups.READ,WorkDrive.users.READ",
    WRIKE: "amReadOnlyAccessRole,wsReadOnly,wsReadWrite,amReadOnlyAccessRole,amReadOnlyUser,amReadWriteUser,amReadOnlyGroup,amReadWriteGroup,amReadOnlyInvitation,amReadWriteInvitation",
    PAGERDUTY: "write",
    HEROKU: "global",
    LINODE: "account:read_only domains:read_only events:read_only",
    ONELOGIN: "openid profile email",
    WEBFLOW: `app_subscriptions:read+assets:read+assets:write+authorized_user:read+cms:read+cms:write+comments:read+comments:write+components:read+components:write+custom_code:read+custom_code:write+ecommerce:read+ecommerce:write+forms:read+forms:write+pages:read+pages:write+sites:read+sites:write+site_activity:read+site_config:read+site_config:write+users:read+users:write+workspace:read+workspace:write`,
    CISCO_WEBEX_TEAMS: `spark:people_read spark-admin:people_write spark:people_write spark:organizations_read spark:messages_read spark-admin:places_read spark-compliance:team_memberships_write spark:rooms_read identity:groups_read cjp:config_write spark:messages_write identity:tokens_read spark-admin:devices_write cjds:admin_org_read spark-admin:workspaces_write Identity:one_time_password identity:placeonetimepassword_create spark-admin:organizations_write spark:memberships_write spark:rooms_write spark:devices_write cjp:config_read spark-compliance:messages_write spark:kms spark-admin:messages_read spark-admin:people_read Identity:contact spark:teams_write spark-admin:organizations_read identity:tokens_write spark-admin:messages_write spark:memberships_read identity:organizations_rw identity:organizations_read spark-admin:devices_read cjp:user spark:team_memberships_write cjp:config spark:team_memberships_read spark-admin:roles_read spark-admin:workspaces_read spark:devices_read spark-compliance:events_read spark-compliance:rooms_read identity:groups_rw spark-compliance:teams_read spark-admin:places_write spark:teams_read spark-admin:licenses_read spark-compliance:rooms_write`,
    XERO: `offline_access accounting.settings.read openid profile email accounting.transactions`,
    INTERCOM: `read_users read_admins`,
    MONDAY: "me:read users:read users:write teams:read teams:write",
    JIRA: "offline_access read:jira-user read:jira-work read:users read:me read:audit-log:jira read:group:jira write:group:jira read:license:jira read:issue:jira read:user:jira read:user.columns:jira read:permission:jira read:project:jira read:status:jira read:project.email:jira read:role:jira read:organization:jira-service-management read:organization.user:jira-service-management read:organization.detail:jira-service-management read:application-role:jira read:avatar:jira read:email-address:jira manage:jira-configuration read:license:jira",
    UIPATH: "offline_access OR.Users",
    SMARTSHEET: "READ_SHEETS WRITE_SHEETS ADMIN_SHEETS READ_USERS WRITE_USERS ADMIN_USERS READ_WORKSPACES WRITE_WORKSPACES ADMIN_WORKSPACES",
    GITLAB: "api read_user read_api admin_mode profile email",
    FIGMA: "current_user:read",
    TRELLO: "read,write",
    DOCUSIGN:
      "group_read,user_read,dtr.profile.read,dtr.company.read,account_read,signature",
    SALESFORCE: `refresh_token id full`,
    AIRTABLE: "user.email:read schema.bases:read",
    BASECAMP: `read write`,
    TWITCH:
      "user:edit user:read:email user:read:follows moderator:read:followers",
    VIMEO: "public private",
    HARVEST: "all",
    APPFIGURES: `account:read`,
    HUBSPOT: `crm.objects.owners.read settings.users.read settings.users.teams.read settings.users.write oauth conversations.read crm.objects.invoices.read crm.objects.owners.read cms.domains.read`,
    // MS_VIVA_ENGAGE: `User.Read.All Group.Read.All Organization.Read.All AuditLog.Read.All Files.ReadWrite.All`
    MS_VIVA_ENGAGE: `https://api.yammer.com/user_impersonation`,
    LINKEDIN: "email openid profile w_member_social",
    CANVA: `app:read design:content:read design:meta:read design:permission:read folder:read folder:permission:read asset:read comment:read brandtemplate:meta:read brandtemplate:content:read profile:read`,
    GITHUB: `user,read:user,repo,admin:org,user:email,read:org,read:enterprise,admin:enterprise,manage_billing:enterprise`,
    ATLASSIAN: `report:personal-data read:event:compass read:metric:compass read:me read:account read:jira-work write:jira-work read:jira-user read:servicedesk-request read:servicemanagement-insight-objects read:confluence-user read:confluence-groups read:audit-log:confluence read:group:confluence read:user:confluence read:configuration:confluence read:email-address:confluence read:viewers:support-api-gateway write:viewers:support-api-gateway read:application-role:jira read:filter:jira write:filter:jira read:project.avatar:jira read:avatar:jira read:user:jira read:issue:jira-software read:organization:jira-service-management write:organization:jira-service-management delete:organization:jira-service-management read:organization.user:jira-service-management write:organization.user:jira-service-management delete:organization.user:jira-service-management read:organization.property:jira-service-management write:organization.property:jira-service-management delete:organization.property:jira-service-management write:group:jira read:issue:jira read:license:jira read:organization.detail:jira-service-management read:permission:jira read:project.email:jira read:role:jira read:status:jira read:user.columns:jira read:group:jira read:filter.column:jira read:email-address:jira read:project:jira offline_access read:entitlements:fsag read:audit-log:jira read:issue.votes:jira read:screen:jira read:user.property:jira read:user-configuration:jira read:jira-user read:jira-work read:users read:me read:audit-log:jira read:group:jira write:group:jira read:license:jira read:issue:jira read:user:jira read:user.columns:jira read:permission:jira read:project:jira read:status:jira read:project.email:jira read:role:jira read:organization:jira-service-management read:organization.user:jira-service-management read:organization.detail:jira-service-management read:application-role:jira read:avatar:jira read:email-address:jira`,
    CONFLUENCE: `read:confluence-space.summary read:confluence-content.summary read:confluence-user read:confluence-groups read:me read:confluence-audit read:me:0read:audit-log:0jira read:group:jira write:group:jira read:license:jira read:issue:jira read:user:jira read:user.columns:jira read:permission:jira read:project:jira read:status:jira read:project.email:jira read:role:jira read:organization:jira-service-management read:organization.user:jira-service-management read:organization.detail:jira-service-management read:application-role:jira read:avatar:jira offline_access`,
    ADOBE_CREATIVE: `ent_productprofiles_read,openid,AdobeID,email,read_organizations,offlice_access`,
    TAILSCALE: `all`,
    AWS: `openid`,
    ZENDESK: `read write`,
    SHARE_FILE_BUSINESS: "full",
    BAMBOOHR: `application job_opening email openid company:administration company:info company_file data_cleaner error_management employee employee:assets employee:compensation employee:contact employee:custom_fields employee:custom_fields_encrypted employee:demographic employee:dependent employee:dependent:ssn employee:education employee:emergency_contacts employee:file employee:identification employee:job employee:management employee:name employee:payroll employee:photo employee:providers employee:providers:payroll employee:vaccination employee_directory goal tasks access_level benchmarking:compensation field offline_access user user:management report`,
    QUICKBOOKSONLINE: `com.intuit.quickbooks.accounting`,
    ZOHOCRM: `ZohoCRM.users.ALL ZohoCRM.settings.ALL ZohoCRM.org.READ ZohoCRM.modules.ALL ZohoCRM.bulk.ALL`,
    CONTENTFUL: `content_management_manage`,
    DYNAMICS_365_SALES: `https://${domainName}.crm.dynamics.com/.default offline_access`,
    XCORP: `users.read tweet.read offline.access`,
    AZURE_DEVOPS: `https://app.vssps.visualstudio.com/.default offline_access`,
    ENVOY: `token.refresh+employees.read+companies.read`,
    REDHAT: `openid offline_access`,
    DEEL: `contracts:read contracts:write people:write people:read accounting:read contracts:write groups:read groups:write organizations:read organizations:write Users:read`,
    HUBSTAFF: `openid profile email hubstaff:read hubstaff:write tasks:read tasks:write`,
    EGNYTE_ADMIN: `Egnyte.permission Egnyte.group Egnyte.user Egnyte.filesystem Egnyte.link Egnyte.audit`
  };
  return scopeMapper[cloudName];
};

export const startOauth = async (cloudName, domainName) => {
  let scopesNotNeeded = [
    "DROPBOX_BUSINESS",
    "BOX_BUSINESS",
    "MIRO",
    "NOTION",
    "BITBUCKET",
    "ASANA",
    "WORDPRESS",
    "GOTOMEETING",
    "HELLOSIGN",
    "CALENDLY",
    "CLICKUP",
    "MAILCHIMP",
    "EVENTBRITE",
    "FRESHBOOKS",
    "NETLIFY",
    "PIPEDRIVE",
    "MS_VIVA_ENGAGE_GRAPH",
    "ZOOM",
    "TEAMWORK",
    "GUSTO",
    "SERVICENOW",
    "YEXT",
    "APOLLO_IO",
    "AHA",
    "DIGITALOCEAN",
    "AIKIDO",
    "CLOSE",
    "PRODUCTBOARD",
    "SIGNNOW",
    "FRONT",
    "SURVEYMONKEY",
  ];
  let oauthUrl;
  let scopes = await getOauthScopes(cloudName, domainName);
  scopes = encodeURIComponent(scopes);
  let oauthKeys = await getOauthKeys(
    cloudName === "MS_VIVA_ENGAGE_GRAPH" ? "MICROSOFT_TEAMS" : cloudName
  );
  let client_id, redirect_uri;
  if (oauthKeys?.status === "OK") {
    if (cloudName === "WORKDAY") {
      let splitDomainName = domainName?.split(":");
      let domain = splitDomainName[0];
      let tenentName = splitDomainName[1];
      console.log(domain + ":" + tenentName);
      oauthUrl = await getOauthUrl(cloudName, domain + ":" + tenentName);
    } else if (cloudName === "SALESFORCE") {
      oauthUrl = await getOauthUrl(cloudName, oauthKeys?.res?.appRedirectUrl);
    } else if (cloudName === "SERVICENOW") {
      oauthUrl = await getOauthUrl(cloudName, oauthKeys?.res?.clientEmail);
      domainName = `${oauthKeys?.res?.clientEmail}:${oauthKeys?.res?.scopes}`;
    } else if (cloudName === "ZENDESK" || cloudName === "BAMBOOHR" || cloudName === "AHA" || cloudName === "EGNYTE_ADMIN") {
      oauthUrl = await getOauthUrl(cloudName, domainName);
    } else {
      oauthUrl = await getOauthUrl(cloudName, oauthKeys?.res?.appRedirectUrl);
    }

    if (!oauthUrl && cloudName !== "AWS") {
      notifyToast("error", "Oauth URL Not Configured");
      return true;
    }
    client_id = oauthKeys?.res?.clientId;
    redirect_uri = oauthKeys?.res?.redirectUrl;
    if (cloudName === "AWS") {
      oauthUrl = oauthKeys?.res?.oauthUrl + "/oauth2/authorize?response_type=code";
    }
  }
  let state = `${cloudName}~${window.location.host}`;
  if (
    cloudName === "UIPATH" ||
    cloudName === "GITHUB" ||
    cloudName === "JIRA" ||
    cloudName === "ATLASSIAN" ||
    cloudName === "FIGMA" ||
    cloudName === "CONFLUENCE" ||
    cloudName === "MAILCHIMP" ||
    cloudName === "ZENDESK" ||
    cloudName === "BAMBOOHR" ||
    cloudName === "AHA" ||
    cloudName === "SERVICENOW" ||
    cloudName === "WORKDAY" ||
    cloudName === "AZURE_DEVOPS" ||
    cloudName === "EGNYTE_ADMIN" ||
    cloudName === "DYNAMICS_365_SALES"
  ) {
    localStorage.setItem("stateInfo", domainName);
  }
  state = encodeURIComponent(state);
  if (client_id && redirect_uri) {
    let uri = ``;
    if (cloudName === "LINKEDIN") {
      uri = `${oauthUrl}&client_id=${client_id}&redirect_uri=${redirect_uri}&state=${state}&scope=${oauthKeys?.res?.scopes || scopes}`;
    } else if (cloudName === "GOOGLE_WORKSPACE") {
      uri = `${oauthUrl}&client_id=${client_id}&redirect_uri=${redirect_uri}&scope=${scopes}&state=${state}`;
    } else if (scopesNotNeeded?.includes(cloudName)) {
      uri = `${oauthUrl}&client_id=${client_id}&redirect_uri=${redirect_uri}&state=${state}`;
    } else {
      uri = `${oauthUrl}${cloudName === "SLACK" || cloudName === "GITHUB" ? "?" : "&"
        }client_id=${client_id}&redirect_uri=${redirect_uri}&scope=${cloudName === "AWS" ? scopes : oauthKeys?.res?.scopes || scopes
        }&state=${state}`;
    }

    window.open(
      uri,
      "Popup",
      "toolbar=no, location=no, statusbar=no, menubar=no, scrollbars=1, resizable=0, width=580, height=600, top=30"
    );
  } else {
    notifyToast("error", "OauthKeys Not Defined...");
  }
  return true;
};
