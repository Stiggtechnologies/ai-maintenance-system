# StiggSyncAI Azure Deployment Guide

This guide will help you deploy the complete AI-powered maintenance and reliability system to Azure.

## 🚀 Quick Deployment

### Prerequisites
- Azure CLI installed and configured
- Docker Desktop installed
- Terraform installed
- SQL Server command line tools (sqlcmd)
- kubectl installed
- PowerShell (Windows) or Bash (Linux/Mac)

### Option 1: Automated Deployment (Recommended)

**Windows (PowerShell):**
```powershell
.\deploy\azure-setup.ps1 -SubscriptionId "your-subscription-id" -ResourceGroupName "rg-stiggsyncai-prod" -Location "East US" -SqlAdminPassword "YourSecurePassword123!" -StripeApiKey "sk_test_your_stripe_key" -AzureOpenAIKey "your-azure-openai-key"
```

**Linux/Mac (Bash):**
```bash
chmod +x deploy/azure-setup.sh
./deploy/azure-setup.sh "your-subscription-id" "rg-stiggsyncai-prod" "East US" "YourSecurePassword123!" "sk_test_your_stripe_key" "your-azure-openai-key"
```

### Option 2: Manual Step-by-Step Deployment

#### Step 1: Login to Azure
```bash
az login
az account set --subscription "your-subscription-id"
```

#### Step 2: Create Resource Group
```bash
az group create --name "rg-stiggsyncai-prod" --location "East US"
```

#### Step 3: Deploy Infrastructure
```bash
cd .devops/terraform
terraform init
terraform apply -var="sql_admin_password=YourSecurePassword123!"
```

#### Step 4: Build and Push Docker Image
```bash
# Get ACR name from Terraform output
ACR_NAME=$(terraform output -raw container_registry_name)

# Build and push
az acr login --name $ACR_NAME
docker build -t stiggsyncai:latest .
docker tag stiggsyncai:latest "$ACR_NAME.azurecr.io/stiggsyncai:latest"
docker push "$ACR_NAME.azurecr.io/stiggsyncai:latest"
```

#### Step 5: Deploy Database
```bash
SQL_SERVER=$(terraform output -raw sql_server_fqdn)
sqlcmd -S $SQL_SERVER -d "stiggsyncai-db-prod" -U "sqladmin" -P "YourSecurePassword123!" -i "../../sql/schema.sql"
sqlcmd -S $SQL_SERVER -d "stiggsyncai-db-prod" -U "sqladmin" -P "YourSecurePassword123!" -i "../../sql/seed_data.sql"
```

#### Step 6: Deploy to Kubernetes
```bash
# Get AKS credentials
AKS_NAME=$(terraform output -raw aks_cluster_name)
az aks get-credentials --resource-group "rg-stiggsyncai-prod" --name $AKS_NAME

# Create namespace
kubectl create namespace stiggsyncai-prod

# Create secrets
kubectl create secret generic stiggsyncai-secrets -n stiggsyncai-prod \
    --from-literal=db-connection-string="Server=tcp:$SQL_SERVER,1433;Database=stiggsyncai-db-prod;User ID=sqladmin;Password=YourSecurePassword123!;Encrypt=true;" \
    --from-literal=redis-connection-string="$(terraform output -raw redis_connection_string)" \
    --from-literal=openai-api-key="your-azure-openai-key" \
    --from-literal=stripe-api-key="sk_test_your_stripe_key"

# Deploy application
kubectl apply -f ../k8s/deployment.yaml
kubectl apply -f ../k8s/service.yaml
kubectl apply -f ../k8s/ingress.yaml
```

## 🔧 Configuration

### Required Environment Variables
- `SqlConnectionString`: Azure SQL Database connection string
- `RedisConnectionString`: Azure Redis Cache connection string
- `STRIPE_API_KEY`: Stripe API key for subscription management
- `AzureOpenAIKey`: Azure OpenAI service key
- `AzureAIStudioUrl`: Azure AI Studio endpoint URL

### Optional Configuration
- `KeyVaultUrl`: Azure Key Vault URL for secrets management
- `APPLICATIONINSIGHTS_CONNECTION_STRING`: Application Insights connection string

## 🧪 Testing the Deployment

### 1. Health Check
```bash
curl http://your-external-ip/health
```

### 2. Test AI Agents
```bash
# Test Maintenance Strategy Agent
curl -X POST http://your-external-ip/api/agent-orchestrator \
  -H "Content-Type: application/json" \
  -d '{"Agent":"MaintenanceStrategyDevelopmentAgent","OrgId":1,"Industry":"Oil & Gas"}'

# Test Asset Management Agent
curl -X POST http://your-external-ip/api/agent-orchestrator \
  -H "Content-Type: application/json" \
  -d '{"Agent":"AssetManagementAgent","OrgId":2,"Industry":"Mining"}'
```

### 3. Test Authentication
```bash
curl -X POST http://your-external-ip/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@demo.org&password=demo123"
```

### 4. Run Demo Walkthrough
```bash
cd api
dotnet run demo_walkthrough.cs
```

## 📊 Monitoring & Observability

### Application Insights
- Navigate to Azure Portal → Application Insights → stiggsyncai-appinsights
- View real-time metrics, logs, and performance data
- Set up alerts for critical metrics

### Kubernetes Dashboard
```bash
kubectl proxy
# Access at http://localhost:8001/api/v1/namespaces/kubernetes-dashboard/services/https:kubernetes-dashboard:/proxy/
```

### Log Monitoring
```bash
# View application logs
kubectl logs -f deployment/stiggsyncai-api -n stiggsyncai-prod

# View all pods
kubectl get pods -n stiggsyncai-prod
```

## 🔒 Security Considerations

### 1. SSL/TLS Configuration
- Configure SSL certificate for production domain
- Update ingress configuration with TLS settings

### 2. Network Security
- Configure network security groups
- Enable Azure Firewall for additional protection
- Set up VPN for secure access

### 3. Identity & Access Management
- Configure Azure AD application registration
- Set up role-based access control (RBAC)
- Enable multi-factor authentication

## 🚀 Production Checklist

- [ ] SSL certificate configured
- [ ] Custom domain name configured
- [ ] Azure AD authentication configured
- [ ] Monitoring alerts set up
- [ ] Backup strategy implemented
- [ ] Disaster recovery plan in place
- [ ] Security scanning completed
- [ ] Performance testing completed
- [ ] Documentation updated

## 🆘 Troubleshooting

### Common Issues

1. **Docker build fails**
   - Ensure Docker Desktop is running
   - Check Dockerfile syntax
   - Verify all dependencies are available

2. **Kubernetes deployment fails**
   - Check pod logs: `kubectl logs <pod-name> -n stiggsyncai-prod`
   - Verify secrets are created correctly
   - Check resource quotas and limits

3. **Database connection issues**
   - Verify SQL Server firewall rules
   - Check connection string format
   - Ensure database exists and schema is deployed

4. **AI agents not responding**
   - Verify Azure OpenAI key is valid
   - Check Application Insights for errors
   - Ensure all required environment variables are set

### Support
- GitHub Issues: https://github.com/Stiggtechnologies/ai-maintenance-system/issues
- Email: support@stiggtechnologies.com
- Documentation: https://docs.stiggtechnologies.com

## 📈 Scaling & Performance

### Horizontal Pod Autoscaling
The system includes HPA configuration that automatically scales based on:
- CPU utilization (target: 70%)
- Memory utilization (target: 80%)
- Custom metrics from Application Insights

### Database Performance
- Azure SQL Elastic Pool for cost optimization
- Read replicas for improved performance
- Automated backup and point-in-time recovery

### Caching Strategy
- Redis for session management and licensing
- Application-level caching for frequently accessed data
- CDN for static assets

---

**Built with ❤️ by Stigg Technologies**