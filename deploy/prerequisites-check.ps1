# Prerequisites Check Script for StiggSyncAI Deployment
# Run this first to verify you have everything needed

Write-Host "🔍 Checking Prerequisites for StiggSyncAI Deployment..." -ForegroundColor Green

$allGood = $true

# Check Azure CLI
Write-Host "`n1. Checking Azure CLI..." -ForegroundColor Yellow
try {
    $azVersion = az --version 2>$null
    if ($azVersion) {
        Write-Host "   ✅ Azure CLI installed" -ForegroundColor Green
        
        # Check if logged in
        $account = az account show 2>$null | ConvertFrom-Json
        if ($account) {
            Write-Host "   ✅ Logged into Azure as: $($account.user.name)" -ForegroundColor Green
            Write-Host "   📋 Subscription: $($account.name) ($($account.id))" -ForegroundColor Cyan
        } else {
            Write-Host "   ⚠️  Not logged into Azure. Run: az login" -ForegroundColor Red
            $allGood = $false
        }
    } else {
        Write-Host "   ❌ Azure CLI not found. Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Red
        $allGood = $false
    }
} catch {
    Write-Host "   ❌ Azure CLI not found" -ForegroundColor Red
    $allGood = $false
}

# Check Docker
Write-Host "`n2. Checking Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version 2>$null
    if ($dockerVersion) {
        Write-Host "   ✅ Docker installed: $dockerVersion" -ForegroundColor Green
        
        # Check if Docker is running
        $dockerInfo = docker info 2>$null
        if ($dockerInfo) {
            Write-Host "   ✅ Docker is running" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️  Docker is not running. Start Docker Desktop" -ForegroundColor Red
            $allGood = $false
        }
    } else {
        Write-Host "   ❌ Docker not found. Install from: https://www.docker.com/products/docker-desktop" -ForegroundColor Red
        $allGood = $false
    }
} catch {
    Write-Host "   ❌ Docker not found" -ForegroundColor Red
    $allGood = $false
}

# Check Terraform
Write-Host "`n3. Checking Terraform..." -ForegroundColor Yellow
try {
    $terraformVersion = terraform --version 2>$null
    if ($terraformVersion) {
        Write-Host "   ✅ Terraform installed: $($terraformVersion.Split("`n")[0])" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Terraform not found. Install from: https://www.terraform.io/downloads" -ForegroundColor Red
        $allGood = $false
    }
} catch {
    Write-Host "   ❌ Terraform not found" -ForegroundColor Red
    $allGood = $false
}

# Check kubectl
Write-Host "`n4. Checking kubectl..." -ForegroundColor Yellow
try {
    $kubectlVersion = kubectl version --client 2>$null
    if ($kubectlVersion) {
        Write-Host "   ✅ kubectl installed" -ForegroundColor Green
    } else {
        Write-Host "   ❌ kubectl not found. Install from: https://kubernetes.io/docs/tasks/tools/" -ForegroundColor Red
        $allGood = $false
    }
} catch {
    Write-Host "   ❌ kubectl not found" -ForegroundColor Red
    $allGood = $false
}

# Check SQL Server tools
Write-Host "`n5. Checking SQL Server tools..." -ForegroundColor Yellow
try {
    $sqlcmdVersion = sqlcmd -? 2>$null
    if ($sqlcmdVersion) {
        Write-Host "   ✅ sqlcmd installed" -ForegroundColor Green
    } else {
        Write-Host "   ❌ sqlcmd not found. Install SQL Server command line tools" -ForegroundColor Red
        $allGood = $false
    }
} catch {
    Write-Host "   ❌ sqlcmd not found" -ForegroundColor Red
    $allGood = $false
}

# Check PowerShell version
Write-Host "`n6. Checking PowerShell..." -ForegroundColor Yellow
$psVersion = $PSVersionTable.PSVersion
if ($psVersion.Major -ge 5) {
    Write-Host "   ✅ PowerShell $($psVersion.Major).$($psVersion.Minor) installed" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  PowerShell version is old. Consider upgrading to PowerShell 7+" -ForegroundColor Yellow
}

# Summary
Write-Host "`n" + "="*60 -ForegroundColor Cyan
if ($allGood) {
    Write-Host "🎉 All prerequisites are ready!" -ForegroundColor Green
    Write-Host "`n🚀 You can now run the deployment:" -ForegroundColor Yellow
    Write-Host ".\deploy\ai-foundry-enhanced-setup.ps1 -SubscriptionId 'your-subscription-id' -SqlAdminPassword 'YourSecure123!'" -ForegroundColor Cyan
} else {
    Write-Host "❌ Some prerequisites are missing. Please install the missing tools above." -ForegroundColor Red
    Write-Host "`n📋 Installation Guide:" -ForegroundColor Yellow
    Write-Host "1. Install missing tools from the links above" -ForegroundColor White
    Write-Host "2. Restart PowerShell/Terminal" -ForegroundColor White
    Write-Host "3. Run this script again to verify" -ForegroundColor White
    Write-Host "4. Then run the deployment script" -ForegroundColor White
}

Write-Host "`n💡 Need help? Check deploy/step-by-step-guide.md for detailed instructions" -ForegroundColor Cyan