terraform {
  required_version = ">= 1.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 3.117.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "rg-stiggsyncai-tfstate"
    storage_account_name = "sastiggsyncaitfstate"
    container_name       = "tfstate"
    key                  = "stiggsyncai.terraform.tfstate"
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }

  subscription_id = "c71b1fa8-5cde-40b6-a934-e09f0fa65584"
}

data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.common_tags
}

resource "azurerm_network_security_group" "main" {
  name                = "${var.resource_group_name}-nsg"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "HTTPS"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "HTTP"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = var.common_tags
}

resource "azurerm_container_registry" "main" {
  name                = var.acr_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Premium"
  admin_enabled       = true
  tags                = var.common_tags
}

resource "azurerm_kubernetes_cluster" "main" {
  name                = var.aks_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "${var.aks_name}-dns"
  kubernetes_version  = var.kubernetes_version

  default_node_pool {
    name       = "default"
    node_count = var.node_count
    vm_size    = var.node_vm_size

    upgrade_settings {
      max_surge = "10%"
    }
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin = "azure"
    network_policy = "azure"
  }

  auto_scaler_profile {
    balance_similar_node_groups   = true
    max_graceful_termination_sec = 600
    scale_down_delay_after_add   = "10m"
    scale_down_unneeded          = "10m"
  }

  tags       = var.common_tags
  depends_on = [azurerm_log_analytics_workspace.main]
}

resource "azurerm_mssql_server" "main" {
  name                         = var.sql_server_name
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = var.sql_admin_username
  administrator_login_password = var.sql_admin_password
  tags                         = var.common_tags
}

resource "azurerm_mssql_elasticpool" "main" {
  name                = "${var.sql_server_name}-pool"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  server_name         = azurerm_mssql_server.main.name

  sku {
    name     = "StandardPool"
    tier     = "Standard"
    capacity = 100
  }

  per_database_settings {
    min_capacity = 0
    max_capacity = 20
  }

  max_size_gb = 100
  tags        = var.common_tags
}

resource "azurerm_mssql_database" "main" {
  name            = var.sql_database_name
  server_id       = azurerm_mssql_server.main.id
  elastic_pool_id = azurerm_mssql_elasticpool.main.id
  tags            = var.common_tags

  depends_on = [azurerm_mssql_elasticpool.main]
}

resource "azurerm_redis_cache" "main" {
  name                  = var.redis_name
  location              = azurerm_resource_group.main.location
  resource_group_name   = azurerm_resource_group.main.name
  capacity              = 2
  family                = "C"
  sku_name              = "Standard"
  non_ssl_port_enabled  = false
  minimum_tls_version   = "1.2"

  redis_configuration {
    maxmemory_policy = "allkeys-lru"
  }

  tags = var.common_tags
}

resource "azurerm_key_vault" "main" {
  name                = var.key_vault_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "premium"

  access_policy {
    tenant_id         = data.azurerm_client_config.current.tenant_id
    object_id         = data.azurerm_client_config.current.object_id
    key_permissions   = ["Create", "Get", "List", "Update", "Delete", "Recover", "Backup", "Restore"]
    secret_permissions = ["Set", "Get", "List", "Delete", "Recover", "Backup", "Restore"]
  }

  access_policy {
    tenant_id         = data.azurerm_client_config.current.tenant_id
    object_id         = azurerm_kubernetes_cluster.main.identity[0].principal_id
    secret_permissions = ["Get", "List"]
  }

  tags = var.common_tags
}

resource "azurerm_application_insights" "main" {
  name                = var.app_insights_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_type    = "web"
  tags                = var.common_tags
}

resource "azurerm_log_analytics_workspace" "main" {
  name              = var.log_analytics_name
  location          = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku               = "PerGB2018"
  retention_in_days = 30
  tags              = var.common_tags
}

resource "azurerm_storage_account" "main" {
  name                     = var.storage_account_name
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "GRS"
  min_tls_version          = "TLS1_2"

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }
  }

  tags = var.common_tags
}
