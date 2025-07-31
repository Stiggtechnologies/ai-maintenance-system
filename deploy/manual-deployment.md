# 🔧 Manual Step-by-Step Deployment

If you prefer to understand each step or the automated script fails, follow this manual deployment guide.

## Phase 1: Infrastructure Setup (15-20 minutes)

### Step 1: Create Resource Group
```bash
az group create --name rg-stiggsyncai-prod --location "East US"
```

### Step 2: Deploy Infrastructure with Terraform
```bash
cd .devops/terraform

# Initialize Terraform
terraform init

# Review the plan
  terraform plan -var="sql_admin_password=YourSecurePassword123!"

# Apply infrastructure
terraform apply -var="sql_admin_password=YourSecurePassword123!" -auto-approve
```

### Step 3: Get Infrastructure Outputs
```bash
# Save these values for later steps
ACR_NAME=$(terraform output -raw container_registry_name)
AKS_NAME=$(terraform output -raw aks_cluster_name)
SQL_SERVER=$(terraform output -raw sql_server_fqdn)
KEY_VAULT_NAME=$(terraform output -raw key_vault_name)
REDIS_CONNECTION=$(terraform output -raw redis_connection_string)

echo "ACR: $ACR_NAME"
echo "AKS: $AKS_NAME"
echo "SQL: $SQL_SERVER"
echo "Key Vault: $KEY_VAULT_NAME"
```

## Phase 2: Application Build & Push (10-15 minutes)

### Step 4: Build Docker Image
```bash
# Return to project root
cd ../..

# Build the Docker image
docker build -t stiggsyncai:latest .

# Tag for ACR
docker tag stiggsyncai:latest "$ACR_NAME.azurecr.io/stiggsyncai:latest"
```

### Step 5: Push to Container Registry
```bash
# Login to ACR
az acr login --name $ACR_NAME

# Push image
docker push "$ACR_NAME.azurecr.io/stiggsyncai:latest"

# Verify image was pushed
az acr repository list --name $ACR_NAME --output table
```

## Phase 3: Database Setup (5-10 minutes)

### Step 6: Configure SQL Database
```bash
# Create firewall rule for Azure services
az sql server firewall-rule create \
  --resource-group rg-stiggsyncai-prod \
  --server stiggsyncai-sql-prod \
  --name AllowAllAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# Test connection
sqlcmd -S $SQL_SERVER -d stiggsyncai-db-prod -U sqladmin -P "YourSecurePassword123!" -Q "SELECT 1"
```

### Step 7: Deploy Database Schema
```bash
# Apply schema
sqlcmd -S $SQL_SERVER -d stiggsyncai-db-prod -U sqladmin -P "YourSecurePassword123!" -i sql/schema.sql

# Apply seed data
sqlcmd -S $SQL_SERVER -d stiggsyncai-db-prod -U sqladmin -P "YourSecurePassword123!" -i sql/seed_data.sql

# Verify tables were created
sqlcmd -S $SQL_SERVER -d stiggsyncai-db-prod -U sqladmin -P "YourSecurePassword123!" -Q "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES"
```

## Phase 4: Kubernetes Deployment (10-15 minutes)

### Step 8: Configure Kubernetes
```bash
# Get AKS credentials
az aks get-credentials --resource-group rg-stiggsyncai-prod --name $AKS_NAME --overwrite-existing

# Verify connection
kubectl get nodes
```

### Step 9: Create Namespace and Secrets
```bash
# Create namespace
kubectl create namespace stiggsyncai-prod

# Create connection strings
DB_CONNECTION="Server=tcp:$SQL_SERVER,1433;Database=stiggsyncai-db-prod;User ID=sqladmin;Password=YourSecurePassword123!;Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;"

# Create secrets
kubectl create secret generic stiggsyncai-secrets -n stiggsyncai-prod \
  --from-literal=db-connection-string="$DB_CONNECTION" \
  --from-literal=redis-connection-string="$REDIS_CONNECTION" \
  --from-literal=openai-api-key="your-openai-key" \
  --from-literal=stripe-api-key="your-stripe-key" \
  --from-literal=appinsights-connection-string="$(cd .devops/terraform && terraform output -raw application_insights_connection_string)"

# Verify secrets
kubectl get secrets -n stiggsyncai-prod
```

### Step 10: Update Deployment Manifests
```bash
# Update image name in deployment
sed -i "s|acrstiggsyncai.azurecr.io/stiggsyncai:latest|$ACR_NAME.azurecr.io/stiggsyncai:latest|g" .devops/k8s/deployment.yaml

# Verify the change
grep "image:" .devops/k8s/deployment.yaml
```

### Step 11: Deploy to Kubernetes
```bash
# Apply deployment
kubectl apply -f .devops/k8s/deployment.yaml

# Apply service
kubectl apply -f .devops/k8s/service.yaml

# Apply ingress
kubectl apply -f .devops/k8s/ingress.yaml

# Check deployment status
kubectl get deployments -n stiggsyncai-prod
kubectl get pods -n stiggsyncai-prod
kubectl get services -n stiggsyncai-prod
```

## Phase 5: Verification & Testing (5-10 minutes)

### Step 12: Wait for Deployment
```bash
# Wait for deployment to be ready
kubectl wait --for=condition=available --timeout=300s deployment/stiggsyncai-api -n stiggsyncai-prod

# Check pod status
kubectl get pods -n stiggsyncai-prod

# If pods are not ready, check logs
kubectl logs -f deployment/stiggsyncai-api -n stiggsyncai-prod
```

### Step 13: Get External IP
```bash
# Get external IP (may take 5-10 minutes)
kubectl get service stiggsyncai-service -n stiggsyncai-prod

# Wait for external IP to be assigned
while true; do
  EXTERNAL_IP=$(kubectl get service stiggsyncai-service -n stiggsyncai-prod -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  if [ ! -z "$EXTERNAL_IP" ] && [ "$EXTERNAL_IP" != "null" ]; then
    echo "External IP: $EXTERNAL_IP"
    break
  fi
  echo "Waiting for external IP..."
  sleep 30
done
```

### Step 14: Test Application
```bash
# Test health endpoint
curl http://$EXTERNAL_IP/health

# Test authentication
curl -X POST http://$EXTERNAL_IP/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@demo.org&password=demo123"

# Test AI agent
curl -X POST http://$EXTERNAL_IP/api/agent-orchestrator \
  -H "Content-Type: application/json" \
  -d '{"Agent":"MaintenanceStrategyDevelopmentAgent","OrgId":1,"Industry":"Oil & Gas"}'
```

## Phase 6: Post-Deployment Configuration (Optional)

### Step 15: Configure Monitoring
```bash
# Check Application Insights
az monitor app-insights component show --app stiggsyncai-appinsights --resource-group rg-stiggsyncai-prod

# View logs in Application Insights
az monitor app-insights events show --app stiggsyncai-appinsights --type traces --start-time 2024-01-01T00:00:00Z
```

### Step 16: Set up Alerts
```bash
# Create CPU alert
az monitor metrics alert create \
  --name "High CPU Usage" \
  --resource-group rg-stiggsyncai-prod \
  --scopes /subscriptions/$(az account show --query id -o tsv)/resourceGroups/rg-stiggsyncai-prod/providers/Microsoft.ContainerService/managedClusters/aks-stiggsyncai-prod \
  --condition "avg Percentage CPU > 80" \
  --description "Alert when CPU usage is high"
```

### Step 17: Configure Backup
```bash
# Enable automated backup for SQL Database
az sql db ltr-policy set \
  --resource-group rg-stiggsyncai-prod \
  --server stiggsyncai-sql-prod \
  --database stiggsyncai-db-prod \
  --weekly-retention P4W \
  --monthly-retention P12M \
  --yearly-retention P5Y \
  --week-of-year 1
```

## Summary

Your deployment is now complete! You should have:

✅ **Infrastructure**: AKS, SQL Database, Redis, Container Registry, Key Vault  
✅ **Application**: 15 AI agents running in Kubernetes  
✅ **Database**: Schema and seed data deployed  
✅ **Monitoring**: Application Insights configured  
✅ **Security**: Secrets stored in Key Vault  

### Access URLs:
- **Dashboard**: `http://$EXTERNAL_IP`
- **API**: `http://$EXTERNAL_IP/api`
- **Mobile**: `http://$EXTERNAL_IP/mobile`
- **Health**: `http://$EXTERNAL_IP/health`

### Default Credentials:
- Username: `admin@demo.org`
- Password: `demo123`

### Next Steps:
1. Configure custom domain and SSL
2. Set up Azure AD authentication
3. Configure monitoring alerts
4. Test all 15 AI agents
5. Set up backup and disaster recovery

If you encounter any issues, check the troubleshooting guide or the application logs.