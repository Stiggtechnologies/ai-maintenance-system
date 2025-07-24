# Azure AI Foundry Deployment Script for StiggSyncAI
# This script sets up Azure AI Foundry integration alongside the existing deployment

param(
    [Parameter(Mandatory=$true)]
    [string]$SubscriptionId,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName = "rg-stiggsyncai-prod",
    
    [Parameter(Mandatory=$true)]
    [string]$Location = "East US",
    
    [Parameter(Mandatory=$true)]
    [string]$SqlAdminPassword,
    
    [Parameter(Mandatory=$false)]
    [string]$AIFoundryName = "stiggsyncai-ai-foundry",
    
    [Parameter(Mandatory=$false)]
    [string]$OpenAIDeploymentName = "gpt-4"
)

Write-Host "🚀 Setting up Azure AI Foundry for StiggSyncAI..." -ForegroundColor Green

# Login to Azure
Write-Host "1. Logging into Azure..." -ForegroundColor Yellow
az login
az account set --subscription $SubscriptionId

# Install Azure AI extension if not already installed
Write-Host "2. Installing Azure AI CLI extension..." -ForegroundColor Yellow
az extension add --name ml --upgrade

# Create AI Foundry Hub
Write-Host "3. Creating Azure AI Foundry Hub..." -ForegroundColor Yellow
az ml workspace create `
    --name "$AIFoundryName-hub" `
    --resource-group $ResourceGroupName `
    --location $Location `
    --kind "hub" `
    --display-name "StiggSyncAI AI Foundry Hub" `
    --description "AI Foundry Hub for StiggSyncAI maintenance and reliability system"

# Create AI Foundry Project
Write-Host "4. Creating AI Foundry Project..." -ForegroundColor Yellow
az ml workspace create `
    --name "$AIFoundryName-project" `
    --resource-group $ResourceGroupName `
    --location $Location `
    --kind "project" `
    --hub-id "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.MachineLearningServices/workspaces/$AIFoundryName-hub" `
    --display-name "StiggSyncAI M&R Project" `
    --description "AI project for 15 specialized maintenance and reliability agents"

# Create Azure OpenAI Service
Write-Host "5. Creating Azure OpenAI Service..." -ForegroundColor Yellow
az cognitiveservices account create `
    --name "$AIFoundryName-openai" `
    --resource-group $ResourceGroupName `
    --location $Location `
    --kind "OpenAI" `
    --sku "S0" `
    --custom-domain "$AIFoundryName-openai"

# Deploy GPT-4 model
Write-Host "6. Deploying GPT-4 model..." -ForegroundColor Yellow
az cognitiveservices account deployment create `
    --name "$AIFoundryName-openai" `
    --resource-group $ResourceGroupName `
    --deployment-name $OpenAIDeploymentName `
    --model-name "gpt-4" `
    --model-version "0613" `
    --model-format "OpenAI" `
    --sku-capacity 10 `
    --sku-name "Standard"

# Get OpenAI endpoint and key
Write-Host "7. Retrieving AI service credentials..." -ForegroundColor Yellow
$openAIEndpoint = az cognitiveservices account show --name "$AIFoundryName-openai" --resource-group $ResourceGroupName --query "properties.endpoint" -o tsv
$openAIKey = az cognitiveservices account keys list --name "$AIFoundryName-openai" --resource-group $ResourceGroupName --query "key1" -o tsv

# Update Key Vault with AI Foundry credentials
Write-Host "8. Storing AI Foundry credentials in Key Vault..." -ForegroundColor Yellow
$keyVaultName = "kv-stiggsyncai-prod"

az keyvault secret set --vault-name $keyVaultName --name "AzureAIFoundryEndpoint" --value $openAIEndpoint
az keyvault secret set --vault-name $keyVaultName --name "AzureAIFoundryKey" --value $openAIKey
az keyvault secret set --vault-name $keyVaultName --name "AzureOpenAIDeploymentName" --value $OpenAIDeploymentName

# Update Kubernetes secrets
Write-Host "9. Updating Kubernetes secrets..." -ForegroundColor Yellow
kubectl patch secret stiggsyncai-secrets -n stiggsyncai-prod -p="{`"data`":{`"AzureAIFoundryEndpoint`":`"$(echo -n $openAIEndpoint | base64 -w 0)`",`"AzureAIFoundryKey`":`"$(echo -n $openAIKey | base64 -w 0)`",`"AzureOpenAIDeploymentName`":`"$(echo -n $OpenAIDeploymentName | base64 -w 0)`"}}"

# Restart deployment to pick up new secrets
Write-Host "10. Restarting application deployment..." -ForegroundColor Yellow
kubectl rollout restart deployment/stiggsyncai-api -n stiggsyncai-prod
kubectl rollout status deployment/stiggsyncai-api -n stiggsyncai-prod

Write-Host "🎉 Azure AI Foundry setup completed!" -ForegroundColor Green
Write-Host "🤖 AI Foundry Hub: $AIFoundryName-hub" -ForegroundColor Cyan
Write-Host "📊 AI Project: $AIFoundryName-project" -ForegroundColor Cyan
Write-Host "🧠 OpenAI Endpoint: $openAIEndpoint" -ForegroundColor Cyan
Write-Host "🚀 GPT-4 Deployment: $OpenAIDeploymentName" -ForegroundColor Cyan

Write-Host "`n📋 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Access AI Foundry: https://ai.azure.com"
Write-Host "2. Configure additional models (GPT-3.5, embeddings, etc.)"
Write-Host "3. Set up prompt flow for complex AI workflows"
Write-Host "4. Configure content safety and responsible AI policies"
Write-Host "5. Test the enhanced AI agents with improved capabilities"

Write-Host "`n🧪 Test AI Foundry Integration:" -ForegroundColor Yellow
Write-Host "curl -X POST http://your-external-ip/api/ai-agent -H 'Content-Type: application/json' -d '{`"Query`":`"Analyze pump vibration data and recommend maintenance actions`",`"OrgId`":1,`"SubscriptionPlan`":`"enterprise`"}'"