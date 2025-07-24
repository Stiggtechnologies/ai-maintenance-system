# Azure AI Foundry Infrastructure for StiggSyncAI

# AI Foundry Hub
resource "azurerm_machine_learning_workspace" "ai_foundry_hub" {
  name                = "${var.project_name}-ai-foundry-hub"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_insights_id = azurerm_application_insights.main.id
  key_vault_id        = azurerm_key_vault.main.id
  storage_account_id  = azurerm_storage_account.main.id
  
  # AI Foundry Hub specific configuration
  kind = "Hub"
  
  identity {
    type = "SystemAssigned"
  }
  
  tags = var.common_tags
}

# AI Foundry Project
resource "azurerm_machine_learning_workspace" "ai_foundry_project" {
  name                = "${var.project_name}-ai-foundry-project"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_insights_id = azurerm_application_insights.main.id
  key_vault_id        = azurerm_key_vault.main.id
  storage_account_id  = azurerm_storage_account.main.id
  
  # AI Foundry Project specific configuration
  kind = "Project"
  
  # Link to the hub
  hub_workspace_id = azurerm_machine_learning_workspace.ai_foundry_hub.id
  
  identity {
    type = "SystemAssigned"
  }
  
  tags = var.common_tags
}

# Azure OpenAI Service for AI Foundry
resource "azurerm_cognitive_account" "openai_foundry" {
  name                = "${var.project_name}-openai-foundry"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  kind                = "OpenAI"
  sku_name           = "S0"
  
  custom_subdomain_name = "${var.project_name}-openai-foundry"
  
  network_acls {
    default_action = "Allow"
    
    # Restrict to Azure services and specific IPs
    ip_rules = [var.allowed_ip_range]
  }
  
  tags = var.common_tags
}

# GPT-4 Deployment
resource "azurerm_cognitive_deployment" "gpt4" {
  name                 = "gpt-4"
  cognitive_account_id = azurerm_cognitive_account.openai_foundry.id
  
  model {
    format  = "OpenAI"
    name    = "gpt-4"
    version = "0613"
  }
  
  scale {
    type     = "Standard"
    capacity = 10
  }
}

# GPT-3.5 Turbo Deployment
resource "azurerm_cognitive_deployment" "gpt35_turbo" {
  name                 = "gpt-35-turbo"
  cognitive_account_id = azurerm_cognitive_account.openai_foundry.id
  
  model {
    format  = "OpenAI"
    name    = "gpt-35-turbo"
    version = "0613"
  }
  
  scale {
    type     = "Standard"
    capacity = 20
  }
}

# Text Embedding Deployment
resource "azurerm_cognitive_deployment" "text_embedding" {
  name                 = "text-embedding-ada-002"
  cognitive_account_id = azurerm_cognitive_account.openai_foundry.id
  
  model {
    format  = "OpenAI"
    name    = "text-embedding-ada-002"
    version = "2"
  }
  
  scale {
    type     = "Standard"
    capacity = 10
  }
}

# Content Safety Service
resource "azurerm_cognitive_account" "content_safety" {
  name                = "${var.project_name}-content-safety"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  kind                = "ContentSafety"
  sku_name           = "S0"
  
  tags = var.common_tags
}

# Computer Vision for Asset Inspection
resource "azurerm_cognitive_account" "computer_vision" {
  name                = "${var.project_name}-computer-vision"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  kind                = "ComputerVision"
  sku_name           = "S1"
  
  tags = var.common_tags
}

# Store AI Foundry secrets in Key Vault
resource "azurerm_key_vault_secret" "ai_foundry_endpoint" {
  name         = "AzureAIFoundryEndpoint"
  value        = azurerm_cognitive_account.openai_foundry.endpoint
  key_vault_id = azurerm_key_vault.main.id
  
  depends_on = [azurerm_key_vault.main]
}

resource "azurerm_key_vault_secret" "ai_foundry_key" {
  name         = "AzureAIFoundryKey"
  value        = azurerm_cognitive_account.openai_foundry.primary_access_key
  key_vault_id = azurerm_key_vault.main.id
  
  depends_on = [azurerm_key_vault.main]
}

resource "azurerm_key_vault_secret" "openai_deployment_name" {
  name         = "AzureOpenAIDeploymentName"
  value        = azurerm_cognitive_deployment.gpt4.name
  key_vault_id = azurerm_key_vault.main.id
  
  depends_on = [azurerm_key_vault.main]
}

# Outputs for AI Foundry
output "ai_foundry_hub_name" {
  description = "Name of the AI Foundry Hub"
  value       = azurerm_machine_learning_workspace.ai_foundry_hub.name
}

output "ai_foundry_project_name" {
  description = "Name of the AI Foundry Project"
  value       = azurerm_machine_learning_workspace.ai_foundry_project.name
}

output "openai_foundry_endpoint" {
  description = "Azure OpenAI Foundry endpoint"
  value       = azurerm_cognitive_account.openai_foundry.endpoint
}

output "openai_foundry_key" {
  description = "Azure OpenAI Foundry key"
  value       = azurerm_cognitive_account.openai_foundry.primary_access_key
  sensitive   = true
}

output "gpt4_deployment_name" {
  description = "GPT-4 deployment name"
  value       = azurerm_cognitive_deployment.gpt4.name
}