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

@description('Azure region used by the existing Container Apps environment.')
param location string = resourceGroup().location

@description('Existing Azure Container Registry name from foundation.bicep.')
param registryName string

@description('Existing Azure Container Apps environment name from foundation.bicep.')
param containerEnvironmentName string

@description('Existing user-assigned managed identity name from foundation.bicep.')
param workloadIdentityName string

@description('Immutable image reference, preferably repository@sha256:digest.')
param containerImage string

@description('Minimum warm replicas. Production refuses scale-to-zero.')
@minValue(1)
param minReplicas int = 1

@description('Maximum web replicas for the first Azure stamp.')
@minValue(1)
param maxReplicas int = 5

var appName = take('${prefix}-${environmentName}-web', 32)

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerEnvironmentName
}

resource workloadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: workloadIdentityName
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: {
    product: 'SyncAI'
    edition: 'azure'
    environment: environmentName
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
        targetPort: 80
        transport: 'auto'
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
    }
    template: {
      containers: [
        {
          name: 'web'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 80
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
                port: 80
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
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '75'
              }
            }
          }
        ]
      }
    }
  }
}

output containerAppName string = web.name
output fqdn string = web.properties.configuration.ingress.fqdn
output image string = containerImage
