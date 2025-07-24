#!/bin/bash
# StiggSyncAI Azure Deployment Script (Linux/Mac)
# Usage: ./azure-setup.sh <subscription-id> <resource-group> <location> <sql-password> [stripe-key] [openai-key]

set -e

SUBSCRIPTION_ID=$1
RESOURCE_GROUP=${2:-"rg-stiggsyncai-prod"}
LOCATION=${3:-"East US"}
SQL_ADMIN_PASSWORD=$4
STRIPE_API_KEY=$5
AZURE_OPENAI_KEY=$6

if [ -z "$SUBSCRIPTION_ID" ] || [ -z "$SQL_ADMIN_PASSWORD" ]; then
    echo "Usage: $0 <subscription-id> [resource-group] [location] <sql-password> [stripe-key] [openai-key]"
    exit 1
fi

echo "🚀 Starting StiggSyncAI Azure Deployment..."

# Login to Azure
echo "1. Logging into Azure..."
az login
az account set --subscription $SUBSCRIPTION_ID

# Create Resource Group
echo "2. Creating Resource Group..."
az group create --name $RESOURCE_GROUP --location "$LOCATION"

# Deploy Infrastructure with Terraform
echo "3. Deploying Infrastructure with Terraform..."
cd .devops/terraform
terraform init
terraform plan -var="resource_group_name=$RESOURCE_GROUP" -var="location=$LOCATION" -var="sql_admin_password=$SQL_ADMIN_PASSWORD"
terraform apply -auto-approve -var="resource_group_name=$RESOURCE_GROUP" -var="location=$LOCATION" -var="sql_admin_password=$SQL_ADMIN_PASSWORD"

# Get infrastructure outputs
ACR_NAME=$(terraform output -raw container_registry_name)
AKS_NAME=$(terraform output -raw aks_cluster_name)
SQL_SERVER=$(terraform output -raw sql_server_fqdn)
KEY_VAULT_NAME=$(terraform output -raw key_vault_name)

echo "4. Infrastructure deployed successfully!"
echo "   - Container Registry: $ACR_NAME"
echo "   - AKS Cluster: $AKS_NAME"
echo "   - SQL Server: $SQL_SERVER"
echo "   - Key Vault: $KEY_VAULT_NAME"

# Store secrets in Key Vault
echo "5. Storing secrets in Key Vault..."
if [ ! -z "$STRIPE_API_KEY" ]; then
    az keyvault secret set --vault-name $KEY_VAULT_NAME --name "STRIPE-API-KEY" --value "$STRIPE_API_KEY"
fi
if [ ! -z "$AZURE_OPENAI_KEY" ]; then
    az keyvault secret set --vault-name $KEY_VAULT_NAME --name "AZURE-OPENAI-KEY" --value "$AZURE_OPENAI_KEY"
fi

# Build and push Docker image
echo "6. Building and pushing Docker image..."
cd ../..
az acr login --name $ACR_NAME
docker build -t stiggsyncai:latest .
docker tag stiggsyncai:latest "$ACR_NAME.azurecr.io/stiggsyncai:latest"
docker push "$ACR_NAME.azurecr.io/stiggsyncai:latest"

# Deploy database schema
echo "7. Deploying database schema..."
CONNECTION_STRING="Server=tcp:$SQL_SERVER,1433;Database=stiggsyncai-db-prod;User ID=sqladmin;Password=$SQL_ADMIN_PASSWORD;Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;"
sqlcmd -S $SQL_SERVER -d "stiggsyncai-db-prod" -U "sqladmin" -P "$SQL_ADMIN_PASSWORD" -i "sql/schema.sql"
sqlcmd -S $SQL_SERVER -d "stiggsyncai-db-prod" -U "sqladmin" -P "$SQL_ADMIN_PASSWORD" -i "sql/seed_data.sql"

# Get AKS credentials
echo "8. Configuring Kubernetes..."
az aks get-credentials --resource-group $RESOURCE_GROUP --name $AKS_NAME --overwrite-existing

# Create Kubernetes namespace
kubectl create namespace stiggsyncai-prod --dry-run=client -o yaml | kubectl apply -f -

# Create Kubernetes secrets
echo "9. Creating Kubernetes secrets..."
REDIS_CONNECTION=$(cd .devops/terraform && terraform output -raw redis_connection_string)
APPINSIGHTS_CONNECTION=$(cd .devops/terraform && terraform output -raw application_insights_connection_string)

kubectl create secret generic stiggsyncai-secrets -n stiggsyncai-prod \
    --from-literal=db-connection-string="$CONNECTION_STRING" \
    --from-literal=redis-connection-string="$REDIS_CONNECTION" \
    --from-literal=openai-api-key="$AZURE_OPENAI_KEY" \
    --from-literal=stripe-api-key="$STRIPE_API_KEY" \
    --from-literal=appinsights-connection-string="$APPINSIGHTS_CONNECTION" \
    --dry-run=client -o yaml | kubectl apply -f -

# Deploy to Kubernetes
echo "10. Deploying to Kubernetes..."
# Update deployment with correct image
sed -i "s|acrstiggsyncai.azurecr.io/stiggsyncai:latest|$ACR_NAME.azurecr.io/stiggsyncai:latest|g" .devops/k8s/deployment.yaml

kubectl apply -f .devops/k8s/deployment.yaml
kubectl apply -f .devops/k8s/service.yaml
kubectl apply -f .devops/k8s/ingress.yaml

# Wait for deployment
echo "11. Waiting for deployment to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/stiggsyncai-api -n stiggsyncai-prod

# Get external IP
echo "12. Getting service information..."
EXTERNAL_IP=$(kubectl get service stiggsyncai-service -n stiggsyncai-prod -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

echo "🎉 Deployment completed successfully!"
echo "📊 Dashboard URL: http://$EXTERNAL_IP"
echo "🔗 API Endpoint: http://$EXTERNAL_IP/api"
echo "📱 Mobile App: http://$EXTERNAL_IP/mobile"

echo ""
echo "📋 Next Steps:"
echo "1. Configure your domain name to point to: $EXTERNAL_IP"
echo "2. Set up SSL certificate for production"
echo "3. Configure Azure AD application registration"
echo "4. Test the 15 AI agents with the demo script"
echo "5. Set up monitoring alerts in Application Insights"

echo ""
echo "🧪 Test the deployment:"
echo "curl -X POST http://$EXTERNAL_IP/api/agent-orchestrator -H 'Content-Type: application/json' -d '{\"Agent\":\"MaintenanceStrategyDevelopmentAgent\",\"OrgId\":1,\"Industry\":\"Oil & Gas\"}'"