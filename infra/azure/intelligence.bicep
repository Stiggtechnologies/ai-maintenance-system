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

@description('Region of the existing Container Apps environment.')
param location string = resourceGroup().location

@description('Approved Azure OpenAI region. Kept separate because model availability is regional.')
param aiLocation string

@description('Existing Azure Container Registry name from foundation.bicep.')
param registryName string

@description('Existing Azure Container Apps environment name from foundation.bicep.')
param containerEnvironmentName string

@description('Existing user-assigned managed identity name from foundation.bicep.')
param workloadIdentityName string

@description('Existing Key Vault name from foundation.bicep.')
param keyVaultName string

@description('Immutable Azure Intelligence image reference repository@sha256:digest.')
param containerImage string

@description('Canonical Supabase API URL used during the controlled Azure migration.')
param supabaseUrl string

@description('Name of the Key Vault secret containing the canonical Supabase service role.')
param supabaseServiceRoleSecretName string = 'supabase-service'

@description('Name of the Key Vault secret shared only with the governed enrichment caller.')
param enrichSharedSecretName string = 'enrich-auth'

@description('Azure OpenAI deployment name recorded in model provenance.')
param openAiDeploymentName string = 'syncai-reasoning'

@description('Azure OpenAI model selected by an authorized deployment owner.')
param openAiModelName string

@description('Exact Azure OpenAI model version selected by an authorized deployment owner.')
param openAiModelVersion string

@description('Azure OpenAI deployment SKU. Availability and data-processing geography require deployment review.')
@allowed([
  'Standard'
  'GlobalStandard'
])
param openAiDeploymentSku string = 'Standard'

@description('Azure OpenAI deployment capacity in thousands of tokens per minute.')
@minValue(1)
param openAiCapacity int = 10

@description('Maximum variable AI worker replicas.')
@minValue(1)
param maxReplicas int = 10

var compactPrefix = toLower(replace('${prefix}${environmentName}', '-', ''))
var uniqueSuffix = uniqueString(subscription().id, resourceGroup().id, prefix, environmentName)
var aiAccountName = take('${compactPrefix}ai${uniqueSuffix}', 64)
var intelligenceAppName = take('${prefix}-${environmentName}-intelligence', 32)
var openAiUserRoleDefinitionId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerEnvironmentName
}

resource workloadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: workloadIdentityName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource aiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: aiAccountName
  location: aiLocation
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  tags: {
    product: 'SyncAI'
    edition: 'azure'
    environment: environmentName
    plane: 'intelligence'
  }
  properties: {
    customSubDomainName: aiAccountName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

resource aiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiAccount
  name: openAiDeploymentName
  sku: {
    name: openAiDeploymentSku
    capacity: openAiCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: openAiModelName
      version: openAiModelVersion
    }
  }
}

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiAccount.id, workloadIdentity.id, openAiUserRoleDefinitionId)
  scope: aiAccount
  properties: {
    principalId: workloadIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleDefinitionId)
  }
}

resource intelligenceApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: intelligenceAppName
  location: location
  tags: {
    product: 'SyncAI'
    edition: 'azure'
    environment: environmentName
    plane: 'intelligence'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${workloadIdentity.id}': {}
    }
  }
  properties: {
    environmentId: containerEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8000
        transport: 'http'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: workloadIdentity.id
        }
      ]
      secrets: [
        {
          name: 'supabase-service'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${supabaseServiceRoleSecretName}'
          identity: workloadIdentity.id
        }
        {
          name: 'enrich-auth'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${enrichSharedSecretName}'
          identity: workloadIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'intelligence'
          image: containerImage
          env: [
            {
              name: 'SUPABASE_URL'
              value: supabaseUrl
            }
            {
              name: 'SUPABASE_SERVICE_ROLE_KEY'
              secretRef: 'supabase-service'
            }
            {
              name: 'ENRICH_SHARED_SECRET'
              secretRef: 'enrich-auth'
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: aiAccount.properties.endpoint
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT'
              value: aiDeployment.name
            }
            {
              name: 'AZURE_OPENAI_API_VERSION'
              value: '2024-10-21'
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: workloadIdentity.properties.clientId
            }
            {
              name: 'AZURE_EDITION_STRICT'
              value: 'true'
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 3
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 3
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    openAiUser
  ]
}

output intelligenceAppName string = intelligenceApp.name
output intelligenceFqdn string = intelligenceApp.properties.configuration.ingress.fqdn
output intelligenceImage string = containerImage
output openAiAccountName string = aiAccount.name
output openAiDeploymentName string = aiDeployment.name
output openAiModel string = '${openAiModelName}:${openAiModelVersion}'
