# 🚀 **EXACTLY Where to Run the Deployment Script**

## 📍 **Location: Your Computer's Command Line**

The deployment script runs on **YOUR computer** (not in this web interface) and connects to Azure to create your infrastructure.

### **🔧 Step-by-Step Process:**

## **1. Download the Project**
- Click the **Download** button in this interface
- Extract to a folder like:
  - Windows: `C:\StiggSyncAI`
  - Mac: `~/StiggSyncAI`
  - Linux: `~/StiggSyncAI`

## **2. Open Command Line**

### **Windows:**
1. Press `Windows Key + R`
2. Type `powershell` and press Enter
3. Navigate to project:
   ```powershell
   cd C:\StiggSyncAI
   ```

### **Mac:**
1. Press `Cmd + Space`
2. Type `terminal` and press Enter
3. Navigate to project:
   ```bash
   cd ~/StiggSyncAI
   ```

### **Linux:**
1. Open Terminal (`Ctrl + Alt + T`)
2. Navigate to project:
   ```bash
   cd ~/StiggSyncAI
   ```

## **3. Check Prerequisites**
```bash
# Run the prerequisites check first
.\deploy\prerequisites-check.ps1    # Windows
./deploy/prerequisites-check.sh     # Mac/Linux
```

## **4. Run the Deployment**

### **Windows (PowerShell):**
```powershell
# Navigate to your project folder
cd C:\StiggSyncAI

# Run the AI Foundry deployment
.\deploy\ai-foundry-enhanced-setup.ps1 -SubscriptionId "your-azure-subscription-id" -SqlAdminPassword "YourSecure123!"
```

### **Mac/Linux (Terminal):**
```bash
# Navigate to your project folder
cd ~/StiggSyncAI

# Make script executable
chmod +x deploy/azure-setup.sh

# Run the deployment
./deploy/azure-setup.sh "your-azure-subscription-id" "rg-stiggsyncai-prod" "East US" "YourSecure123!"
```

## **🎯 What Happens:**

1. **Script connects to Azure** from your computer
2. **Creates infrastructure** (AKS, SQL Database, Redis, etc.)
3. **Builds and deploys** your AI maintenance system
4. **Configures 15 AI agents** with AI Foundry
5. **Returns URLs** to access your system

## **📊 You'll See Output Like:**
```
🚀 Deploying Enhanced Azure AI Foundry for StiggSyncAI...
1. Running base Azure deployment...
2. Setting up Enhanced AI Foundry...
...
🎉 Enhanced Azure AI Foundry deployment completed!
🌐 Application URL: http://20.62.146.123
```

## **⏱️ Timeline:**
- **Prerequisites check**: 2-3 minutes
- **Deployment**: 30-45 minutes
- **Total**: ~45 minutes

## **🔑 What You Need:**
1. **Azure Subscription ID** (get from: `az account show`)
2. **Secure SQL Password** (8+ chars, mixed case, numbers, symbols)
3. **Command line access** on your computer

## **🆘 Common Issues:**

### **"Command not found"**
- Install missing prerequisites using the check script

### **"Permission denied"**
- Windows: Run PowerShell as Administrator
- Mac/Linux: Use `chmod +x` on scripts

### **"Azure login required"**
- Run: `az login`
- Select your subscription: `az account set --subscription "your-id"`

**The key point: You run this on YOUR computer's command line, not in this web interface. The script then connects to Azure and creates everything for you!**

**Ready to start? Run the prerequisites check first!**