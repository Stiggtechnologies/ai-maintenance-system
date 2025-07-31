# Azure AI Foundry Infrastructure for StiggSyncAI

# AI Foundry Hub Workspace
resource "azurerm_machine_learning_workspace" "ai_foundry_hub" {
  name                = "${var.project_name}-ai-foundry-hub"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_insights_id = azurerm_application_insights.main.id
  key_vault_id        = azurerm_key_vault.main.id
  storage_account_id  = azurerm_storage_account.main.id

  kind = "Default"  # ✅ valid kind

  identity {
    type = "SystemAssigned"
  }

  tags = var.common_tags
}

# AI Foundry Project Workspace (second workspace)
resource "azurerm_machine_learning_workspace" "ai_foundry_project" {
  name                = "${var.project_name}-ai-foundry-project"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_insights_id = azurerm_application_insights.main.id
  key_vault_id        = azurerm_key_vault.main.id
  storage_account_id  = azurerm_storage_account.main.id

  kind = "Default"  # 🔄 previously "Project", but only "Default" and "FeatureStore" are allowed

  identity {
    type = "SystemAssigned"
  }

  tags = var.common_tags
}
