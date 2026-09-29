targetScope = 'resourceGroup'

@description('Lowercase product prefix. Use only letters, digits, and hyphens.')
@minLength(3)
@maxLength(16)
param prefix string = 'syncai'

@description('Deployment environment represented by this Azure stamp.')
@allowed([
  'development'
  'staging'
  'production'
])
param environmentName string = 'production'

@description('Azure region for the regional application resources.')
param location string = resourceGroup().location

var compactPrefix = toLower(replace('${prefix}${environmentName}', '-', ''))
var uniqueSuffix = uniqueString(subscription().id, resourceGroup().id, prefix, environmentName)
var logName = take('${prefix}-${environmentName}-logs-${uniqueSuffix}', 63)
var insightsName = take('${prefix}-${environmentName}-insights-${uniqueSuffix}', 63)
var environmentResourceName = take('${prefix}-${environmentName}-apps-${uniqueSuffix}', 32)
var identityName = take('${prefix}-${environmentName}-workload-${uniqueSuffix}', 128)
var registryName = take('${compactPrefix}${uniqueSuffix}', 50)
var vaultName = take('${compactPrefix}-${uniqueSuffix}', 24)

// Built-in roles. Human-readable names are kept beside the IDs so an audit can
// review intent without looking up an opaque GUID.
var acrPullRoleDefinitionId = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
var keyVaultSecretsUserRoleDefinitionId = '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logName
  location: location
  tags: {
    product: 'SyncAI'
    edition: 'azure'
    environment: environmentName
  }
  properties: {
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: insightsName
  location: location
  kind: 'web'
  tags: {
    product: 'SyncAI'
    edition: 'azure'
    environment: environmentName
  }
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource workloadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: {
    product: 'SyncAI'
    edition: 'azure'
    environment: environmentName
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: {
    product: 'SyncAI'
    edition: 'azure'
    environment: environmentName
  }
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    policies: {
      quarantinePolicy: {
        status: 'disabled'
      }
      retentionPolicy: {
        // Automated untagged-manifest retention is a Premium ACR feature.
        // Keep it explicitly disabled on the cost-controlled foundation SKU.
        status: 'disabled'
      }
      trustPolicy: {
        type: 'Notary'
        status: 'disabled'
      }
    }
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: {
    product: 'SyncAI'
    edition: 'azure'
    environment: environmentName
  }
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentResourceName
  location: location
  tags: {
    product: 'SyncAI'
    edition: 'azure'
    environment: environmentName
  }
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, workloadIdentity.id, acrPullRoleDefinitionId)
  scope: registry
  properties: {
    principalId: workloadIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleDefinitionId)
  }
}

resource keyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, workloadIdentity.id, keyVaultSecretsUserRoleDefinitionId)
  scope: vault
  properties: {
    principalId: workloadIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleDefinitionId)
  }
}

output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output containerEnvironmentName string = containerEnvironment.name
output workloadIdentityName string = workloadIdentity.name
output workloadIdentityClientId string = workloadIdentity.properties.clientId
output keyVaultName string = vault.name
output applicationInsightsName string = insights.name
output logAnalyticsWorkspaceName string = logs.name
