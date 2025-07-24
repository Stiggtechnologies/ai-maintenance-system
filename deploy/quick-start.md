# ⚡ Quick Start Deployment Guide

## 🚀 Deploy in 5 Commands (30 minutes)

### Prerequisites Check
```bash
# Verify you have these installed:
az --version          # Azure CLI
docker --version      # Docker
terraform --version   # Terraform
kubectl version       # Kubernetes CLI
sqlcmd -?            # SQL Server tools
```

### 1. Login to Azure
```bash
az login
az account set --subscription "your-subscription-id"
```

### 2. Get Your Values
- **Subscription ID**: `az account show --query id -o tsv`
- **SQL Password**: Create secure password (8+ chars, mixed case, numbers, symbols)
- **Stripe Key**: Get from https://dashboard.stripe.com/apikeys (optional)
- **OpenAI Key**: Get from Azure OpenAI service (optional)

### 3. Run Deployment Script

**Windows:**
```powershell
.\deploy\azure-setup.ps1 -SubscriptionId "your-sub-id" -SqlAdminPassword "YourPassword123!"
```

**Linux/Mac:**
```bash
chmod +x deploy/azure-setup.sh
./deploy/azure-setup.sh "your-sub-id" "rg-stiggsyncai-prod" "East US" "YourPassword123!"
```

### 4. Wait for Completion (20-30 minutes)
You'll see:
```
🚀 Starting StiggSyncAI Azure Deployment...
...
🎉 Deployment completed successfully!
📊 Dashboard URL: http://YOUR_EXTERNAL_IP
```

### 5. Test Your Deployment
```bash
# Health check
curl http://YOUR_EXTERNAL_IP/health

# Test AI agent
curl -X POST http://YOUR_EXTERNAL_IP/api/agent-orchestrator \
  -H "Content-Type: application/json" \
  -d '{"Agent":"MaintenanceStrategyDevelopmentAgent","OrgId":1,"Industry":"Oil & Gas"}'
```

## 🎯 What You Get

- **15 AI Agents** for maintenance & reliability
- **Multi-industry support** (Oil & Gas, Mining, Power, Chemical, Aerospace)
- **Enterprise integrations** (SAP PM, Maximo, Predix)
- **Mobile app** with offline capability
- **Real-time dashboards** with Power BI
- **Auto-scaling** Kubernetes deployment
- **Production-ready** monitoring and security

## 🔑 Default Login
```
Username: admin@demo.org
Password: demo123
```

## 💰 Estimated Costs
- **Development**: $200-400/month
- **Production**: $500-1,200/month

## 🆘 Need Help?
- Check `deploy/troubleshooting.md` for common issues
- View logs: `kubectl logs -f deployment/stiggsyncai-api -n stiggsyncai-prod`
- Create GitHub issue for support

---
**That's it! Your enterprise AI maintenance system is now running in Azure! 🎉**