# 🚀 Complete Azure Deployment Walkthrough

## Step 1: Prerequisites Setup (15-20 minutes)

### 1.1 Install Required Tools

**Windows (PowerShell as Administrator):**
```powershell
# Install Chocolatey (package manager)
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install required tools
choco install azure-cli -y
choco install docker-desktop -y
choco install terraform -y
choco install kubernetes-cli -y
choco install sqlserver-cmdlineutils -y

# Refresh environment variables
refreshenv
```

**Linux/Mac:**
```bash
# Install Azure CLI
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Terraform
wget https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip
unzip terraform_1.6.0_linux_amd64.zip
sudo mv terraform /usr/local/bin/

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install SQL Server tools (Ubuntu/Debian)
curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
curl https://packages.microsoft.com/config/ubuntu/20.04/prod.list | sudo tee /etc/apt/sources.list.d/msprod.list
sudo apt-get update
sudo apt-get install mssql-tools unixodbc-dev
```

### 1.2 Verify Installations
```bash
# Check all tools are installed
az --version
docker --version
terraform --version
kubectl version --client
sqlcmd -?
```

## Step 2: Azure Account Setup (5-10 minutes)

### 2.1 Login to Azure
```bash
# Login to Azure
az login

# List your subscriptions
az account list --output table

# Set the subscription you want to use
az account set --subscription "your-subscription-id"

# Verify current subscription
az account show
```

### 2.2 Get Required Information
You'll need these values for deployment:
- **Subscription ID**: From `az account show`
- **SQL Admin Password**: Create a secure password (min 8 chars, uppercase, lowercase, number, special char)
- **Stripe API Key**: From your Stripe dashboard (optional for demo)
- **Azure OpenAI Key**: From Azure OpenAI service (optional for demo)

## Step 3: Download and Prepare Code (5 minutes)

### 3.1 Get the Code
```bash
# If you have the code locally, navigate to the directory
cd /path/to/ai-maintenance-system

# Or clone from GitHub (if already pushed)
git clone https://github.com/Stiggtechnologies/ai-maintenance-system.git
cd ai-maintenance-system
```

### 3.2 Make Scripts Executable (Linux/Mac only)
```bash
chmod +x deploy/azure-setup.sh
chmod +x deploy/github-setup.ps1
```

## Step 4: Run Automated Deployment (20-30 minutes)

### 4.1 Windows Deployment
```powershell
# Navigate to project directory
cd C:\path\to\ai-maintenance-system

# Run deployment script
.\deploy\azure-setup.ps1 `
  -SubscriptionId "your-subscription-id" `
  -ResourceGroupName "rg-stiggsyncai-prod" `
  -Location "East US" `
  -SqlAdminPassword "YourSecurePassword123!" `
  -StripeApiKey "sk_test_your_stripe_key" `
  -AzureOpenAIKey "your-azure-openai-key"
```

### 4.2 Linux/Mac Deployment
```bash
# Navigate to project directory
cd /path/to/ai-maintenance-system

# Run deployment script
./deploy/azure-setup.sh \
  "your-subscription-id" \
  "rg-stiggsyncai-prod" \
  "East US" \
  "YourSecurePassword123!" \
  "sk_test_your_stripe_key" \
  "your-azure-openai-key"
```

## Step 5: Monitor Deployment Progress

### 5.1 What You'll See
The script will show progress through these stages:
```
🚀 Starting StiggSyncAI Azure Deployment...
1. Logging into Azure...
2. Creating Resource Group...
3. Deploying Infrastructure with Terraform...
4. Infrastructure deployed successfully!
5. Storing secrets in Key Vault...
6. Building and pushing Docker image...
7. Deploying database schema...
8. Configuring Kubernetes...
9. Creating Kubernetes secrets...
10. Deploying to Kubernetes...
11. Waiting for deployment to be ready...
12. Getting service information...
🎉 Deployment completed successfully!
```

### 5.2 Expected Timeline
- **Infrastructure Creation**: 10-15 minutes
- **Docker Build & Push**: 5-10 minutes
- **Database Deployment**: 2-3 minutes
- **Kubernetes Deployment**: 5-10 minutes
- **Total Time**: 20-35 minutes

## Step 6: Verify Deployment

### 6.1 Check Azure Resources
```bash
# List all resources in the resource group
az resource list --resource-group rg-stiggsyncai-prod --output table

# Check AKS cluster status
az aks show --resource-group rg-stiggsyncai-prod --name aks-stiggsyncai-prod --query "provisioningState"

# Check SQL Database
az sql db show --resource-group rg-stiggsyncai-prod --server stiggsyncai-sql-prod --name stiggsyncai-db-prod
```

### 6.2 Test Application Endpoints
```bash
# Get the external IP (this will be shown at the end of deployment)
kubectl get service stiggsyncai-service -n stiggsyncai-prod

# Test health endpoint
curl http://YOUR_EXTERNAL_IP/health

# Test AI agent
curl -X POST http://YOUR_EXTERNAL_IP/api/agent-orchestrator \
  -H "Content-Type: application/json" \
  -d '{"Agent":"MaintenanceStrategyDevelopmentAgent","OrgId":1,"Industry":"Oil & Gas"}'
```

## Step 7: Access Your Application

### 7.1 Application URLs
After successful deployment, you'll have:
- **Main Dashboard**: `http://YOUR_EXTERNAL_IP`
- **API Endpoints**: `http://YOUR_EXTERNAL_IP/api`
- **Mobile App**: `http://YOUR_EXTERNAL_IP/mobile`
- **Health Check**: `http://YOUR_EXTERNAL_IP/health`

### 7.2 Default Login Credentials
```
Username: admin@demo.org
Password: demo123

Username: admin@alpha.org  
Password: alpha123
```

## Step 8: Test All 15 AI Agents

### 8.1 Test Script
```bash
# Test all 15 M&R agents
agents=("MaintenanceStrategyDevelopmentAgent" "AssetManagementAgent" "ReliabilityEngineeringAgent" "PlanningSchedulingAgent" "WorkOrderManagementAgent" "ConditionMonitoringAgent" "InventoryManagementAgent" "MaintenanceOperationsAgent" "QualityAssuranceAgent" "ComplianceAuditingAgent" "SustainabilityESGAgent" "DataAnalyticsAgent" "ContinuousImprovementAgent" "TrainingWorkforceAgent" "FinancialContractAgent")

for agent in "${agents[@]}"; do
  echo "Testing $agent..."
  curl -X POST http://YOUR_EXTERNAL_IP/api/agent-orchestrator \
    -H "Content-Type: application/json" \
    -d "{\"Agent\":\"$agent\",\"OrgId\":1,\"Industry\":\"Oil & Gas\"}"
  echo -e "\n"
done
```

## Step 9: Configure Custom Domain (Optional)

### 9.1 Set up DNS
```bash
# Create DNS record pointing to your external IP
# This depends on your DNS provider (GoDaddy, Cloudflare, etc.)
# Example: stiggsyncai.yourdomain.com -> YOUR_EXTERNAL_IP
```

### 9.2 Configure SSL Certificate
```bash
# Install cert-manager for automatic SSL
kubectl apply -f https://github.com/jetstack/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Wait for cert-manager to be ready
kubectl wait --for=condition=available --timeout=300s deployment/cert-manager -n cert-manager
```

## Troubleshooting Common Issues

### Issue 1: Docker Build Fails
```bash
# Check Docker is running
docker info

# If Docker Desktop isn't running, start it
# Windows: Start Docker Desktop application
# Linux: sudo systemctl start docker
```

### Issue 2: Terraform Fails
```bash
# Check Azure CLI login
az account show

# Re-login if needed
az login

# Check permissions
az role assignment list --assignee $(az account show --query user.name -o tsv)
```

### Issue 3: Kubernetes Deployment Fails
```bash
# Check pod status
kubectl get pods -n stiggsyncai-prod

# Check pod logs
kubectl logs -f deployment/stiggsyncai-api -n stiggsyncai-prod

# Check events
kubectl get events -n stiggsyncai-prod --sort-by='.lastTimestamp'
```

### Issue 4: Database Connection Fails
```bash
# Test SQL connection
sqlcmd -S stiggsyncai-sql-prod.database.windows.net -d stiggsyncai-db-prod -U sqladmin -P "YourPassword"

# Check firewall rules
az sql server firewall-rule list --resource-group rg-stiggsyncai-prod --server stiggsyncai-sql-prod
```

### Issue 5: Application Not Responding
```bash
# Check service status
kubectl get service stiggsyncai-service -n stiggsyncai-prod

# Check ingress
kubectl get ingress -n stiggsyncai-prod

# Scale deployment if needed
kubectl scale deployment stiggsyncai-api --replicas=5 -n stiggsyncai-prod
```

## Next Steps After Deployment

### 1. Set up Monitoring
- Configure Application Insights alerts
- Set up Azure Monitor dashboards
- Configure log analytics queries

### 2. Security Hardening
- Configure Azure AD authentication
- Set up network security groups
- Enable Azure Security Center

### 3. Backup Configuration
- Set up automated database backups
- Configure disaster recovery
- Test backup restoration

### 4. Performance Optimization
- Monitor resource usage
- Optimize database queries
- Configure CDN for static assets

## Support and Resources

### Getting Help
- **GitHub Issues**: Create issues for bugs or questions
- **Azure Support**: Use Azure support portal for infrastructure issues
- **Documentation**: Check Azure documentation for service-specific help

### Useful Commands
```bash
# Check deployment status
kubectl rollout status deployment/stiggsyncai-api -n stiggsyncai-prod

# View application logs
kubectl logs -f deployment/stiggsyncai-api -n stiggsyncai-prod

# Scale application
kubectl scale deployment stiggsyncai-api --replicas=10 -n stiggsyncai-prod

# Update application
kubectl set image deployment/stiggsyncai-api stiggsyncai-api=acrstiggsyncai.azurecr.io/stiggsyncai:new-tag -n stiggsyncai-prod
```

---

**🎉 Congratulations! Your StiggSyncAI system is now running in Azure with all 15 AI agents ready for production use!**