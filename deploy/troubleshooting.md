# 🔧 Troubleshooting Guide for StiggSyncAI Deployment

## Common Deployment Issues and Solutions

### 1. Prerequisites Issues

#### Docker Desktop Not Running
**Error**: `Cannot connect to the Docker daemon`
**Solution**:
```bash
# Windows: Start Docker Desktop application
# Linux: 
sudo systemctl start docker
sudo systemctl enable docker

# Mac: Start Docker Desktop application
```

#### Azure CLI Not Logged In
**Error**: `Please run 'az login' to setup account`
**Solution**:
```bash
az login
az account set --subscription "your-subscription-id"
```

#### Insufficient Azure Permissions
**Error**: `The client does not have authorization to perform action`
**Solution**:
```bash
# Check your role assignments
az role assignment list --assignee $(az account show --query user.name -o tsv)

# You need at least "Contributor" role on the subscription
# Contact your Azure administrator to assign proper permissions
```

### 2. Terraform Issues

#### Terraform State Lock
**Error**: `Error locking state: Error acquiring the state lock`
**Solution**:
```bash
cd .devops/terraform
terraform force-unlock LOCK_ID
```

#### Resource Already Exists
**Error**: `A resource with the ID already exists`
**Solution**:
```bash
# Import existing resource
terraform import azurerm_resource_group.main /subscriptions/SUBSCRIPTION_ID/resourceGroups/RESOURCE_GROUP_NAME

# Or destroy and recreate
terraform destroy
terraform apply
```

#### Terraform Version Mismatch
**Error**: `This configuration does not support Terraform version`
**Solution**:
```bash
# Install specific Terraform version
tfenv install 1.6.0
tfenv use 1.6.0
```

### 3. Docker Build Issues

#### Docker Build Fails
**Error**: `failed to solve with frontend dockerfile.v0`
**Solution**:
```bash
# Clean Docker cache
docker system prune -a

# Rebuild with no cache
docker build --no-cache -t stiggsyncai:latest .
```

#### Container Registry Access Denied
**Error**: `unauthorized: authentication required`
**Solution**:
```bash
# Login to ACR
az acr login --name acrstiggsyncai

# Check ACR permissions
az acr show --name acrstiggsyncai --query "adminUserEnabled"
```

### 4. Kubernetes Deployment Issues

#### Pods Not Starting
**Error**: `ImagePullBackOff` or `CrashLoopBackOff`
**Solution**:
```bash
# Check pod status
kubectl describe pod POD_NAME -n stiggsyncai-prod

# Check logs
kubectl logs POD_NAME -n stiggsyncai-prod

# Common fixes:
# 1. Check image name and tag
# 2. Verify secrets are created
# 3. Check resource limits
```

#### Service Not Accessible
**Error**: External IP shows `<pending>`
**Solution**:
```bash
# Check service status
kubectl get service stiggsyncai-service -n stiggsyncai-prod

# Check load balancer events
kubectl describe service stiggsyncai-service -n stiggsyncai-prod

# Wait longer (can take 5-10 minutes for Azure Load Balancer)
```

#### Secrets Not Found
**Error**: `couldn't find key in Secret`
**Solution**:
```bash
# Check if secrets exist
kubectl get secrets -n stiggsyncai-prod

# Recreate secrets
kubectl delete secret stiggsyncai-secrets -n stiggsyncai-prod
kubectl create secret generic stiggsyncai-secrets -n stiggsyncai-prod \
  --from-literal=db-connection-string="your-connection-string" \
  --from-literal=redis-connection-string="your-redis-string"
```

### 5. Database Issues

#### SQL Connection Timeout
**Error**: `A network-related or instance-specific error occurred`
**Solution**:
```bash
# Check firewall rules
az sql server firewall-rule create \
  --resource-group rg-stiggsyncai-prod \
  --server stiggsyncai-sql-prod \
  --name AllowAllAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# Test connection
sqlcmd -S stiggsyncai-sql-prod.database.windows.net -d stiggsyncai-db-prod -U sqladmin -P "YourPassword"
```

#### Database Schema Not Applied
**Error**: `Invalid object name 'organizations'`
**Solution**:
```bash
# Manually apply schema
sqlcmd -S stiggsyncai-sql-prod.database.windows.net -d stiggsyncai-db-prod -U sqladmin -P "YourPassword" -i sql/schema.sql
sqlcmd -S stiggsyncai-sql-prod.database.windows.net -d stiggsyncai-db-prod -U sqladmin -P "YourPassword" -i sql/seed_data.sql
```

### 6. Application Runtime Issues

#### AI Agents Not Responding
**Error**: `AI processing failed` or timeout errors
**Solution**:
```bash
# Check Application Insights logs
az monitor app-insights events show --app stiggsyncai-appinsights --type exceptions

# Verify Azure OpenAI key
kubectl get secret stiggsyncai-secrets -n stiggsyncai-prod -o yaml

# Check agent orchestrator logs
kubectl logs -f deployment/stiggsyncai-api -n stiggsyncai-prod | grep "AgentOrchestrator"
```

#### Authentication Issues
**Error**: `Unauthorized` or `Invalid credentials`
**Solution**:
```bash
# Test token endpoint
curl -X POST http://YOUR_EXTERNAL_IP/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@demo.org&password=demo123"

# Check Entra ID configuration
az ad app list --display-name "StiggSyncAI"
```

#### High Memory Usage
**Error**: `OOMKilled` in pod status
**Solution**:
```bash
# Increase memory limits
kubectl patch deployment stiggsyncai-api -n stiggsyncai-prod -p '{"spec":{"template":{"spec":{"containers":[{"name":"stiggsyncai-api","resources":{"limits":{"memory":"2Gi"}}}]}}}}'

# Scale horizontally
kubectl scale deployment stiggsyncai-api --replicas=5 -n stiggsyncai-prod
```

### 7. Performance Issues

#### Slow Response Times
**Solution**:
```bash
# Check resource usage
kubectl top pods -n stiggsyncai-prod

# Scale up
kubectl scale deployment stiggsyncai-api --replicas=10 -n stiggsyncai-prod

# Check database performance
az sql db show-usage --resource-group rg-stiggsyncai-prod --server stiggsyncai-sql-prod --name stiggsyncai-db-prod
```

#### Redis Connection Issues
**Error**: `Redis timeout` or connection errors
**Solution**:
```bash
# Check Redis status
az redis show --resource-group rg-stiggsyncai-prod --name redis-stiggsyncai-prod

# Test Redis connection
redis-cli -h redis-stiggsyncai-prod.redis.cache.windows.net -p 6380 -a "your-redis-key" --tls
```

### 8. Monitoring and Debugging

#### Enable Debug Logging
```bash
# Update deployment with debug logging
kubectl set env deployment/stiggsyncai-api ASPNETCORE_ENVIRONMENT=Development -n stiggsyncai-prod

# View detailed logs
kubectl logs -f deployment/stiggsyncai-api -n stiggsyncai-prod --tail=100
```

#### Application Insights Queries
```kusto
// Check for errors
exceptions
| where timestamp > ago(1h)
| order by timestamp desc

// Check performance
requests
| where timestamp > ago(1h)
| summarize avg(duration) by name
| order by avg_duration desc

// Check AI agent performance
traces
| where message contains "Agent"
| where timestamp > ago(1h)
| order by timestamp desc
```

### 9. Recovery Procedures

#### Complete Redeployment
```bash
# Delete everything and start over
kubectl delete namespace stiggsyncai-prod
terraform destroy -auto-approve
./deploy/azure-setup.sh "subscription-id" "rg-stiggsyncai-prod" "East US" "password"
```

#### Rollback Deployment
```bash
# Rollback to previous version
kubectl rollout undo deployment/stiggsyncai-api -n stiggsyncai-prod

# Check rollout status
kubectl rollout status deployment/stiggsyncai-api -n stiggsyncai-prod
```

### 10. Getting Help

#### Collect Diagnostic Information
```bash
# Create diagnostic bundle
mkdir diagnostics
kubectl get all -n stiggsyncai-prod > diagnostics/k8s-resources.txt
kubectl describe deployment stiggsyncai-api -n stiggsyncai-prod > diagnostics/deployment-details.txt
kubectl logs deployment/stiggsyncai-api -n stiggsyncai-prod --tail=1000 > diagnostics/app-logs.txt
az resource list --resource-group rg-stiggsyncai-prod --output table > diagnostics/azure-resources.txt
```

#### Contact Support
- **GitHub Issues**: https://github.com/Stiggtechnologies/ai-maintenance-system/issues
- **Email**: support@stiggtechnologies.com
- **Azure Support**: Create support ticket in Azure portal

---

**Remember**: Most deployment issues are related to permissions, networking, or configuration. Always check the logs first and verify your prerequisites are properly installed and configured.