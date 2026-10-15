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

@description('Region of the Log Analytics workspace. Scheduled query rules must be deployed there.')
param location string = resourceGroup().location

@description('Existing Log Analytics workspace that receives the relay AppTraces and Event Hubs application metrics.')
param logAnalyticsWorkspaceId string

@description('Existing Event Hubs namespace name that the relay consumes.')
param eventHubNamespaceName string

@description('Event Hub entity whose ConsumerLag is watched. This is the EntityName dimension, not a safety limit.')
param eventHubName string

@description('Azure Functions app name. AppTraces for this role are the failure-log query scope.')
@minLength(2)
@maxLength(60)
param functionAppName string

@description('Operator mailbox for the relay action group. No address is assumed.')
param alertEmail string

@description('Operator-chosen ConsumerLag event count. This is not an equipment, process, or safety limit.')
@minValue(1)
param consumerLagThreshold int

var actionGroupName = take('${prefix}-${environmentName}-aio-relay', 260)
var failureAlertName = take('${prefix}-${environmentName}-aio-relay-failures', 260)
var lagAlertName = take('${prefix}-${environmentName}-aio-consumer-lag', 260)
var failureQuery = join([
  'AppTraces'
  '| where Message has "SyncAI relay consecutive failures"'
  '    or Message has "SyncAI relay delivery failed"'
  '    or Message has "SyncAI relay checkpoint lag"'
  '    or Message has "SyncAI relay dead-lettered"'
  '| where AppRoleName =~ "${functionAppName}"'
], '\n')

resource eventHubNamespace 'Microsoft.EventHub/namespaces@2024-01-01' existing = {
  name: eventHubNamespaceName
}

resource relayOperators 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  properties: {
    groupShortName: 'aioRelay'
    enabled: true
    emailReceivers: [
      {
        name: 'relayOperator'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

// Application metrics logs are what emit ConsumerLag for an Event Hubs namespace.
resource applicationMetrics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'syncai-relay-application-metrics'
  scope: eventHubNamespace
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        category: 'ApplicationMetricsLogs'
        enabled: true
      }
    ]
  }
}

resource failureLogs 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: failureAlertName
  location: location
  properties: {
    displayName: failureAlertName
    description: 'Relay failure, dead-letter, or checkpoint-lag log lines. This is an operator alarm for a stuck consumer, not an equipment limit.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      logAnalyticsWorkspaceId
    ]
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: failureQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        relayOperators.id
      ]
    }
  }
}

resource consumerLag 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: lagAlertName
  location: 'global'
  tags: {
    product: 'SyncAI'
    component: 'azure-iot-operations-relay'
  }
  properties: {
    description: 'Event Hubs ConsumerLag on the relay hub. consumerLagThreshold is an operator-chosen event count, not an equipment limit.'
    severity: 2
    enabled: true
    scopes: [
      eventHubNamespace.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    targetResourceType: 'Microsoft.EventHub/namespaces'
    targetResourceRegion: location
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'ConsumerLag'
          metricName: 'ConsumerLag'
          metricNamespace: 'Microsoft.EventHub/namespaces'
          dimensions: [
            {
              name: 'EntityName'
              operator: 'Include'
              values: [
                eventHubName
              ]
            }
          ]
          operator: 'GreaterThan'
          threshold: consumerLagThreshold
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: relayOperators.id
      }
    ]
  }
  dependsOn: [
    applicationMetrics
  ]
}
