#!/bin/bash
# Prerequisites Check Script for StiggSyncAI Deployment (Linux/Mac)
# Run this first to verify you have everything needed

echo "🔍 Checking Prerequisites for StiggSyncAI Deployment..."

all_good=true

# Check Azure CLI
echo ""
echo "1. Checking Azure CLI..."
if command -v az &> /dev/null; then
    echo "   ✅ Azure CLI installed: $(az --version | head -n1)"
    
    # Check if logged in
    if az account show &> /dev/null; then
        account_info=$(az account show --query '{name:name, id:id, user:user.name}' -o json)
        user_name=$(echo $account_info | jq -r '.user')
        subscription_name=$(echo $account_info | jq -r '.name')
        subscription_id=$(echo $account_info | jq -r '.id')
        echo "   ✅ Logged into Azure as: $user_name"
        echo "   📋 Subscription: $subscription_name ($subscription_id)"
    else
        echo "   ⚠️  Not logged into Azure. Run: az login"
        all_good=false
    fi
else
    echo "   ❌ Azure CLI not found. Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    all_good=false
fi

# Check Docker
echo ""
echo "2. Checking Docker..."
if command -v docker &> /dev/null; then
    docker_version=$(docker --version)
    echo "   ✅ Docker installed: $docker_version"
    
    # Check if Docker is running
    if docker info &> /dev/null; then
        echo "   ✅ Docker is running"
    else
        echo "   ⚠️  Docker is not running. Start Docker Desktop or Docker daemon"
        all_good=false
    fi
else
    echo "   ❌ Docker not found. Install from: https://www.docker.com/products/docker-desktop"
    all_good=false
fi

# Check Terraform
echo ""
echo "3. Checking Terraform..."
if command -v terraform &> /dev/null; then
    terraform_version=$(terraform --version | head -n1)
    echo "   ✅ Terraform installed: $terraform_version"
else
    echo "   ❌ Terraform not found. Install from: https://www.terraform.io/downloads"
    all_good=false
fi

# Check kubectl
echo ""
echo "4. Checking kubectl..."
if command -v kubectl &> /dev/null; then
    kubectl_version=$(kubectl version --client --short 2>/dev/null || kubectl version --client 2>/dev/null | head -n1)
    echo "   ✅ kubectl installed: $kubectl_version"
else
    echo "   ❌ kubectl not found. Install from: https://kubernetes.io/docs/tasks/tools/"
    all_good=false
fi

# Check SQL Server tools
echo ""
echo "5. Checking SQL Server tools..."
if command -v sqlcmd &> /dev/null; then
    echo "   ✅ sqlcmd installed"
else
    echo "   ❌ sqlcmd not found. Install SQL Server command line tools"
    echo "      Ubuntu/Debian: https://docs.microsoft.com/en-us/sql/linux/sql-server-linux-setup-tools"
    echo "      Mac: brew install mssql-tools18"
    all_good=false
fi

# Check jq (for JSON parsing)
echo ""
echo "6. Checking jq..."
if command -v jq &> /dev/null; then
    echo "   ✅ jq installed"
else
    echo "   ⚠️  jq not found (recommended for JSON parsing)"
    echo "      Install: sudo apt-get install jq (Linux) or brew install jq (Mac)"
fi

# Summary
echo ""
echo "============================================================"
if [ "$all_good" = true ]; then
    echo "🎉 All prerequisites are ready!"
    echo ""
    echo "🚀 You can now run the deployment:"
    echo "chmod +x deploy/azure-setup.sh"
    echo "./deploy/azure-setup.sh 'your-subscription-id' 'rg-stiggsyncai-prod' 'East US' 'YourSecure123!'"
else
    echo "❌ Some prerequisites are missing. Please install the missing tools above."
    echo ""
    echo "📋 Installation Guide:"
    echo "1. Install missing tools from the links above"
    echo "2. Restart your terminal"
    echo "3. Run this script again to verify"
    echo "4. Then run the deployment script"
fi

echo ""
echo "💡 Need help? Check deploy/step-by-step-guide.md for detailed instructions"