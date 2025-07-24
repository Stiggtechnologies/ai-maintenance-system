# StiggSyncAI Azure Deployment Script
# Run this script to deploy the complete AI maintenance system to Azure

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
    [string]$StripeApiKey = "",
    
    [Parameter(Mandatory=$false)]
    [string]$AzureOpenAIKey = ""
)

Write-Host "🚀 Starting StiggSyncAI Azure Deployment..." -ForegroundColor Green

# Login to Azure
Write-Host "1. Logging into Azure..." -ForegroundColor Yellow
az login
az account set --subscription $SubscriptionId

# Create Resource Group
Write-Host "2. Creating Resource Group..." -ForegroundColor Yellow
az group create --name $ResourceGroupName --location $Location

# Deploy Infrastructure with Terraform
Write-Host "3. Deploying Infrastructure with Terraform..." -ForegroundColor Yellow
cd .devops/terraform
terraform init
terraform plan -var="resource_group_name=$ResourceGroupName" -var="location=$Location" -var="sql_admin_password=$SqlAdminPassword"
terraform apply -auto-approve -var="resource_group_name=$ResourceGroupName" -var="location=$Location" -var="sql_admin_password=$SqlAdminPassword"

# Get infrastructure outputs
$acrName = terraform output -raw container_registry_name
$aksName = terraform output -raw aks_cluster_name
$sqlServer = terraform output -raw sql_server_fqdn
$keyVaultName = terraform output -raw key_vault_name

Write-Host "4. Infrastructure deployed successfully!" -ForegroundColor Green
Write-Host "   - Container Registry: $acrName" -ForegroundColor Cyan
Write-Host "   - AKS Cluster: $aksName" -ForegroundColor Cyan
Write-Host "   - SQL Server: $sqlServer" -ForegroundColor Cyan
Write-Host "   - Key Vault: $keyVaultName" -ForegroundColor Cyan

# Store secrets in Key Vault
Write-Host "5. Storing secrets in Key Vault..." -ForegroundColor Yellow
if ($StripeApiKey) {
    az keyvault secret set --vault-name $keyVaultName --name "STRIPE-API-KEY" --value $StripeApiKey
}
if ($AzureOpenAIKey) {
    az keyvault secret set --vault-name $keyVaultName --name "AZURE-OPENAI-KEY" --value $AzureOpenAIKey
}

# Build and push Docker image
Write-Host "6. Building and pushing Docker image..." -ForegroundColor Yellow
cd ../..
az acr login --name $acrName
docker build -t stiggsyncai:latest .
docker tag stiggsyncai:latest "$acrName.azurecr.io/stiggsyncai:latest"
docker push "$acrName.azurecr.io/stiggsyncai:latest"

# Deploy database schema
Write-Host "7. Deploying database schema..." -ForegroundColor Yellow
$connectionString = "Server=tcp:$sqlServer,1433;Database=stiggsyncai-db-prod;User ID=sqladmin;Password=$SqlAdminPassword;Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;"
sqlcmd -S $sqlServer -d "stiggsyncai-db-prod" -U "sqladmin" -P $SqlAdminPassword -i "sql/schema.sql"
sqlcmd -S $sqlServer -d "stiggsyncai-db-prod" -U "sqladmin" -P $SqlAdminPassword -i "sql/seed_data.sql"

# Get AKS credentials
Write-Host "8. Configuring Kubernetes..." -ForegroundColor Yellow
az aks get-credentials --resource-group $ResourceGroupName --name $aksName --overwrite-existing

# Create Kubernetes namespace
kubectl create namespace stiggsyncai-prod --dry-run=client -o yaml | kubectl apply -f -

# Create Kubernetes secrets
Write-Host "9. Creating Kubernetes secrets..." -ForegroundColor Yellow
kubectl create secret generic stiggsyncai-secrets -n stiggsyncai-prod `
    --from-literal=db-connection-string="$connectionString" `
    --from-literal=redis-connection-string="$(terraform output -raw redis_connection_string)" `
    --from-literal=openai-api-key="$AzureOpenAIKey" `
    --from-literal=stripe-api-key="$StripeApiKey" `
    --from-literal=appinsights-connection-string="$(terraform output -raw application_insights_connection_string)" `
    --dry-run=client -o yaml | kubectl apply -f -

# Deploy to Kubernetes
Write-Host "10. Deploying to Kubernetes..." -ForegroundColor Yellow
# Update deployment with correct image
(Get-Content .devops/k8s/deployment.yaml) -replace 'acrstiggsyncai.azurecr.io/stiggsyncai:latest', "$acrName.azurecr.io/stiggsyncai:latest" | Set-Content .devops/k8s/deployment.yaml

kubectl apply -f .devops/k8s/deployment.yaml
kubectl apply -f .devops/k8s/service.yaml
kubectl apply -f .devops/k8s/ingress.yaml

# Wait for deployment
Write-Host "11. Waiting for deployment to be ready..." -ForegroundColor Yellow
kubectl wait --for=condition=available --timeout=300s deployment/stiggsyncai-api -n stiggsyncai-prod

# Get external IP
Write-Host "12. Getting service information..." -ForegroundColor Yellow
$externalIP = kubectl get service stiggsyncai-service -n stiggsyncai-prod -o jsonpath='{.status.loadBalancer.ingress[0].ip}'

Write-Host "🎉 Deployment completed successfully!" -ForegroundColor Green
Write-Host "📊 Dashboard URL: http://$externalIP" -ForegroundColor Cyan
Write-Host "🔗 API Endpoint: http://$externalIP/api" -ForegroundColor Cyan
Write-Host "📱 Mobile App: http://$externalIP/mobile" -ForegroundColor Cyan

Write-Host "`n📋 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Configure your domain name to point to: $externalIP"
Write-Host "2. Set up SSL certificate for production"
Write-Host "3. Configure Azure AD application registration"
Write-Host "4. Test the 15 AI agents with the demo script"
Write-Host "5. Set up monitoring alerts in Application Insights"

Write-Host "`n🧪 Test the deployment:" -ForegroundColor Yellow
Write-Host "curl -X POST http://$externalIP/api/agent-orchestrator -H 'Content-Type: application/json' -d '{\"Agent\":\"MaintenanceStrategyDevelopmentAgent\",\"OrgId\":1,\"Industry\":\"Oil & Gas\"}'"