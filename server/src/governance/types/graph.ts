// Microsoft Graph API response types

export interface GraphServicePrincipal {
  id: string;
  appId: string;
  displayName: string;
  appDisplayName?: string;
  servicePrincipalType?: string;
  tags?: string[];
  publisherName?: string;
  homepage?: string;
  replyUrls?: string[];
  createdDateTime?: string;
  accountEnabled?: boolean;
  appOwnerOrganizationId?: string;
  verifiedPublisher?: {
    displayName?: string;
    verifiedPublisherId?: string;
  };
}

export interface GraphOAuth2PermissionGrant {
  id: string;
  clientId: string;
  consentType: string;
  principalId?: string;
  resourceId: string;
  scope: string;
}

export interface GraphSignIn {
  id: string;
  createdDateTime: string;
  userDisplayName: string;
  userPrincipalName: string;
  appDisplayName: string;
  appId: string;
  ipAddress?: string;
  status: {
    errorCode: number;
    failureReason?: string;
  };
  resourceDisplayName?: string;
  clientAppUsed?: string;
}

export interface GraphUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  mail?: string;
  jobTitle?: string;
  department?: string;
  accountEnabled?: boolean;
}

export interface GraphOrganization {
  id: string;
  displayName: string;
  tenantId?: string;
  verifiedDomains?: Array<{
    name: string;
    isDefault: boolean;
    isInitial: boolean;
  }>;
  assignedPlans?: Array<{
    assignedDateTime: string;
    capabilityStatus: string;
    service: string;
    servicePlanId: string;
  }>;
}

export interface GraphTeamsApp {
  id: string;
  displayName: string;
  distributionMethod: string;
  externalId?: string;
}

// Dataverse bot entity (Copilot Studio agents) per PRD Appendix A
export interface DataverseBot {
  botid: string;
  name: string;
  description?: string;
  schemaname?: string;
  statecode: number; // 0 = Active, 1 = Inactive
  statuscode: number;
  createdon: string;
  modifiedon: string;
  _createdby_value: string; // systemuserid
  _modifiedby_value: string;
  componentstate?: number;
  publishedon?: string;
  template?: string;
  configuration?: string;
  accesscontrolpolicy?: string;
}

// Power Platform connector
export interface PowerPlatformConnector {
  name: string;
  id: string;
  type: string;
  properties: {
    displayName: string;
    apiId: string;
    connectionParameters?: Record<string, unknown>;
    createdTime: string;
    statuses: Array<{ status: string }>;
  };
}

// Power Platform environment
export interface PowerPlatformEnvironment {
  id: string;
  name: string;
  location: string;
  properties: {
    displayName: string;
    environmentType: string; // Production, Sandbox, etc.
    states: { management: { id: string } };
  };
}

export interface GraphPagedResponse<T> {
  value: T[];
  "@odata.nextLink"?: string;
  "@odata.count"?: number;
}
