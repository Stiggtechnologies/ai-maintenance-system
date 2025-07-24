# 🚀 Where to Run the Azure AI Foundry Deployment

## 📁 **Step 1: Get the Code**

### Option A: Download from this project
1. Click the **Download** button in this interface
2. Extract the ZIP file to a folder like `C:\StiggSyncAI` (Windows) or `~/StiggSyncAI` (Mac/Linux)

### Option B: Clone from GitHub (if already pushed)
```bash
git clone https://github.com/Stiggtechnologies/ai-maintenance-system.git
cd ai-maintenance-system
```

## 💻 **Step 2: Open Command Line**

### Windows:
1. Press `Windows + R`
2. Type `powershell` and press Enter
3. Navigate to your project folder:
   ```powershell
   cd C:\StiggSyncAI
   ```

### Mac:
1. Press `Cmd + Space`
2. Type `terminal` and press Enter
3. Navigate to your project folder:
   ```bash
   cd ~/StiggSyncAI
   ```

### Linux:
1. Open Terminal (Ctrl + Alt + T)
2. Navigate to your project folder:
   ```bash
   cd ~/StiggSyncAI
   ```

## 🔧 **Step 3: Install Prerequisites**

### Windows (PowerShell as Administrator):
```powershell
# Install Chocolatey package manager
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install required tools
choco install azure-cli docker-desktop terraform kubernetes-cli sqlserver-cmdlineutils -y

# Refresh environment
refreshenv
```

### Mac:
```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required tools
brew install azure-cli docker terraform kubernetes-cli
brew install --cask docker

# Install SQL Server tools
brew tap microsoft/mssql-release https://github.com/Microsoft/homebrew-mssql-release
brew install mssql-tools18
```

### Linux (Ubuntu/Debian):
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

# Install SQL Server tools
curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
curl https://packages.microsoft.com/config/ubuntu/20.04/prod.list | sudo tee /etc/apt/sources.list.d/msprod.list
sudo apt-get update
sudo apt-get install mssql-tools18 unixodbc-dev
```

## 🔑 **Step 4: Get Your Azure Information**

1. **Login to Azure**:
   ```bash
   az login
   ```

2. **Get your Subscription ID**:
   ```bash
   az account show --query id -o tsv
   ```
   Copy this ID - you'll need it for deployment.

3. **Create a secure SQL password** (requirements):
   - At least 8 characters
   - Include uppercase, lowercase, numbers, and symbols
   - Example: `MySecure123!`

## 🚀 **Step 5: Run the AI Foundry Deployment**

### From your project directory, run:

**Windows:**
```powershell
# Make sure you're in the project directory
cd C:\StiggSyncAI

# Run the enhanced AI Foundry deployment
.\deploy\ai-foundry-enhanced-setup.ps1 -SubscriptionId "your-subscription-id-here" -SqlAdminPassword "MySecure123!"
```

**Mac/Linux:**
```bash
# Make sure you're in the project directory
cd ~/StiggSyncAI

# Make script executable
chmod +x deploy/azure-setup.sh

# Run the deployment
./deploy/azure-setup.sh "your-subscription-id-here" "rg-stiggsyncai-prod" "East US" "MySecure123!"
```

## 📊 **Step 6: Monitor the Deployment**

You'll see output like this:
```
🚀 Deploying Enhanced Azure AI Foundry for StiggSyncAI...
1. Running base Azure deployment...
2. Setting up Enhanced AI Foundry...
3. Creating AI Foundry Hub with enhanced capabilities...
4. Creating M&R specialized AI project...
5. Deploying multiple AI models...
   - GPT-4 Turbo
   - GPT-3.5 Turbo
   - Text Embeddings
6. Setting up Computer Vision for asset inspection...
7. Setting up Content Safety...
...
🎉 Enhanced Azure AI Foundry deployment completed!
```

## ⏱️ **Timeline:**
- **Prerequisites**: 10-15 minutes (one-time setup)
- **Deployment**: 30-45 minutes
- **Total**: 45-60 minutes

## 🎯 **After Deployment:**

You'll get URLs like:
- **Dashboard**: `http://20.62.146.123` (your actual IP will be different)
- **API**: `http://20.62.146.123/api`
- **Mobile**: `http://20.62.146.123/mobile`

**Default Login:**
- Username: `admin@demo.org`
- Password: `demo123`

## 🆘 **If You Get Stuck:**

1. **Check prerequisites**: `az --version && docker --version`
2. **Verify Azure login**: `az account show`
3. **Check the troubleshooting guide**: `deploy/troubleshooting.md`
4. **View detailed logs** in the terminal output

The deployment script handles everything automatically - you just need to run it from the command line in your project directory!

**Ready to start? Which operating system are you using?**