# StiggSyncAI - AI-Powered Maintenance & Reliability System

[![Build Status](https://dev.azure.com/stiggtechnologies/StiggSyncAI/_apis/build/status/StiggSyncAI-Pipeline?branchName=main)](https://dev.azure.com/stiggtechnologies/StiggSyncAI/_build/latest?definitionId=1&branchName=main)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![.NET](https://img.shields.io/badge/.NET-8.0-purple.svg)](https://dotnet.microsoft.com/download)
[![Azure](https://img.shields.io/badge/Azure-Cloud-blue.svg)](https://azure.microsoft.com)

## 🎯 Overview

StiggSyncAI is a comprehensive, enterprise-grade AI-powered maintenance and reliability system featuring **15 specialized AI agents** designed to optimize industrial maintenance operations. Built with cutting-edge technology and industry best practices, it integrates seamlessly with Azure cloud services and enterprise systems like SAP PM and Maximo.

## 🤖 AI Agents Architecture

The system implements **15 specialized M&R (Maintenance & Reliability) AI agents**:

### Core M&R Agents
1. **Preventive Maintenance Agent** - Schedules and optimizes preventive maintenance activities
2. **Predictive Analytics Agent** - Analyzes sensor data for failure prediction
3. **Asset Health Agent** - Monitors and assesses overall asset health status
4. **Work Order Agent** - Automates work order creation and management
5. **Root Cause Analysis Agent** - Identifies root causes of equipment failures

### Operational Excellence Agents
6. **Spare Parts Agent** - Optimizes inventory and parts management
7. **Performance Analysis Agent** - Analyzes equipment performance metrics
8. **Failure Mode Agent** - Studies and categorizes failure patterns
9. **Cost Optimization Agent** - Optimizes maintenance costs and budgets
10. **Compliance Agent** - Ensures regulatory and safety compliance

### Strategic Intelligence Agents
11. **Risk Assessment Agent** - Evaluates and mitigates operational risks
12. **Energy Efficiency Agent** - Optimizes energy consumption patterns
13. **Environmental Agent** - Tracks environmental impact and ESG metrics
14. **Safety Agent** - Monitors and ensures workplace safety
15. **Reliability Agent** - Enhances overall system reliability

## 🏗️ Architecture

### Technology Stack
- **Backend**: .NET 8, Azure Functions, C#
- **AI/ML**: Azure AI Studio, Azure OpenAI Service
- **Database**: Azure SQL with Elastic Pools
- **Caching**: Redis for high-performance data access
- **Security**: Azure Key Vault, Entra ID Authentication
- **Orchestration**: Azure Kubernetes Service (AKS)
- **Monitoring**: Application Insights, Log Analytics
- **DevOps**: Azure DevOps, Terraform, Docker

### Key Features
- ✅ **15 Specialized AI Agents** for comprehensive M&R coverage
- ✅ **Enterprise Integration** with SAP PM, Maximo
- ✅ **Digital Twin Integration** for real-time asset monitoring
- ✅ **ESG Tracking & Reporting** for sustainability compliance
- ✅ **Blockchain Audit Trail** for immutable maintenance records
- ✅ **Mobile-First Design** for field technicians
- ✅ **Risk-Based Inspection** algorithms
- ✅ **Auto-Scaling Infrastructure** for enterprise workloads
- ✅ **Real-time Analytics** and reporting dashboards

## 🚀 Quick Start

### Prerequisites
- .NET 8 SDK
- Azure CLI
- Docker Desktop
- Terraform (for infrastructure)
- Azure Subscription

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Stiggtechnologies/ai-maintenance-system.git
   cd ai-maintenance-system
   ```

2. **Configure local settings**
   ```bash
   cp local.settings.json.example local.settings.json
   # Update connection strings and API keys
   ```

3. **Set up the database**
   ```bash
   # Run SQL scripts
   sqlcmd -S "(localdb)\mssqllocaldb" -i sql/schema.sql
   sqlcmd -S "(localdb)\mssqllocaldb" -i sql/seed_data.sql
   ```

4. **Start the application**
   ```bash
   dotnet restore
   dotnet build
   func start
   ```

### Azure Deployment

1. **Deploy Infrastructure**
   ```bash
   cd .devops/terraform
   terraform init
   terraform plan
   terraform apply
   ```

2. **Deploy Application**
   ```bash
   # Using Azure DevOps Pipeline
   git push origin main
   
   # Or manual deployment
   az acr build --registry acrstiggsyncai --image stiggsyncai:latest .
   kubectl apply -f .devops/k8s/
   ```

## 📊 System Capabilities

### AI-Powered Features
- **Predictive Maintenance**: ML models predict equipment failures 30-90 days in advance
- **Anomaly Detection**: Real-time identification of abnormal equipment behavior
- **Intelligent Scheduling**: AI-optimized maintenance scheduling based on multiple factors
- **Cost Optimization**: AI-driven recommendations for maintenance cost reduction
- **Resource Planning**: Intelligent spare parts and workforce optimization

### Enterprise Integration
- **SAP PM Integration**: Bidirectional sync with SAP Plant Maintenance
- **Maximo Compatibility**: Native integration with IBM Maximo
- **ERP Connectivity**: Standard APIs for enterprise resource planning systems
- **IoT Platform Support**: Integration with major IoT platforms and sensors

### Advanced Analytics
- **Real-time Dashboards**: Executive and operational dashboards
- **ESG Reporting**: Comprehensive environmental, social, and governance metrics
- **KPI Tracking**: Industry-standard maintenance KPIs and custom metrics
- **Trend Analysis**: Historical data analysis and future trend predictions

## 🔧 Configuration

### Environment Variables
```bash
# Database
DefaultConnection="Server=...;Database=StiggSyncAI;..."
Redis="localhost:6379"

# Azure Services
AzureOpenAI__Endpoint="https://your-openai.openai.azure.com/"
AzureOpenAI__ApiKey="your-api-key"
KeyVaultUrl="https://kv-stiggsyncai.vault.azure.net/"
APPLICATIONINSIGHTS_CONNECTION_STRING="..."

# Feature Flags
Features__BlockchainAudit=true
Features__DigitalTwins=true
Features__ESGTracking=true
Features__MobileApp=true
```

### Agent Configuration
Each AI agent can be configured independently:

```json
{
  "AgentSettings": {
    "PreventiveMaintenance": {
      "Enabled": true,
      "ModelVersion": "gpt-4",
      "MaxRetries": 3,
      "TimeoutSeconds": 30
    },
    "PredictiveAnalytics": {
      "Enabled": true,
      "ConfidenceThreshold": 0.85,
      "PredictionWindow": "90d"
    }
  }
}
```

## 📱 API Reference

### Core Endpoints

#### Agent Processing
```http
POST /api/agent/process
Content-Type: application/json

{
  "agentType": "preventive-maintenance",
  "userId": "user@company.com",
  "parameters": {
    "assetId": "guid",
    "action": "schedule"
  }
}
```

#### Work Order Management
```http
POST /api/workorder/create
PUT /api/workorder/{id}
GET /api/workorder
```

#### Asset Management
```http
GET /api/assets
POST /api/assets
PUT /api/assets/{id}
```

#### Authentication
```http
POST /api/auth/validate
POST /api/auth/refresh
```

### Response Format
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... },
  "timestamp": "2024-01-15T10:30:00Z",
  "metadata": { ... }
}
```

## 🔒 Security

### Authentication & Authorization
- **Azure Entra ID**: Enterprise-grade identity management
- **JWT Tokens**: Secure API authentication
- **Role-Based Access**: Granular permission controls
- **Multi-Factor Authentication**: Enhanced security for admin access

### Data Protection
- **Encryption at Rest**: Azure SQL TDE, Storage encryption
- **Encryption in Transit**: TLS 1.3 for all communications
- **Key Management**: Azure Key Vault for secrets
- **Audit Logging**: Comprehensive audit trail with blockchain verification

### Compliance
- **SOC 2 Type II**: Security and availability controls
- **ISO 27001**: Information security management
- **GDPR**: European data protection compliance
- **HIPAA**: Healthcare data protection (where applicable)

## 📈 Monitoring & Observability

### Application Insights
- **Performance Monitoring**: Response times, throughput, errors
- **Dependency Tracking**: Database, Redis, external API calls
- **Custom Telemetry**: Business metrics and KPIs
- **Alerting**: Proactive issue detection and notification

### Health Checks
```http
GET /health          # Overall system health
GET /health/ready    # Readiness probe
GET /health/live     # Liveness probe
```

### Metrics Dashboard
- **Agent Performance**: Processing times, success rates, error counts
- **System Resources**: CPU, memory, storage utilization
- **Business Metrics**: Work orders processed, assets monitored, cost savings

## 🧪 Testing

### Unit Tests
```bash
dotnet test --collect:"XPlat Code Coverage"
```

### Integration Tests
```bash
# Requires test database and Redis
dotnet test --filter Category=Integration
```

### Load Testing
```bash
# Using Azure Load Testing
az load test create --test-plan load-test-plan.yaml
```

## 📦 Deployment

### Container Deployment
```dockerfile
# Multi-stage build for optimized container
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "StiggSyncAI.dll"]
```

### Kubernetes Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stiggsyncai-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: stiggsyncai-api
  template:
    spec:
      containers:
      - name: stiggsyncai-api
        image: acrstiggsyncai.azurecr.io/stiggsyncai:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
```

### Auto-Scaling Configuration
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: stiggsyncai-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: stiggsyncai-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

## 🤝 Contributing

We welcome contributions! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Standards
- Follow C# coding conventions
- Write comprehensive unit tests
- Document public APIs
- Use meaningful commit messages

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋‍♂️ Support

### Documentation
- [User Guide](docs/user-guide.md)
- [API Documentation](docs/api-reference.md)
- [Deployment Guide](docs/deployment.md)
- [Troubleshooting](docs/troubleshooting.md)

### Getting Help
- **GitHub Issues**: For bugs and feature requests
- **Email Support**: support@stiggtechnologies.com
- **Community Forum**: [StiggSyncAI Community](https://community.stiggtechnologies.com)

### Enterprise Support
For enterprise customers, we offer:
- 24/7 technical support
- Dedicated customer success manager
- Custom training and onboarding
- Priority feature development

## 🎖️ Acknowledgments

- **Microsoft Azure**: Cloud platform and AI services
- **Open Source Community**: Various libraries and tools
- **Industrial Partners**: Domain expertise and validation
- **Beta Customers**: Feedback and real-world testing

---

**Built with ❤️ by [Stigg Technologies](https://stiggtechnologies.com)**

For more information, visit our [website](https://stiggtechnologies.com) or contact us at [info@stiggtechnologies.com](mailto:info@stiggtechnologies.com).