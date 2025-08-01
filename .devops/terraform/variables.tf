# Variables for StiggSyncAI Infrastructure

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
  default     = "rg-stiggsyncai-prod"
}

variable "location" {
  description = "Azure region for resources"
  type        = string
  default     = "Central US"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "stiggsyncai"
}

# Container Registry
variable "acr_name" {
  description = "Name of the Azure Container Registry"
  type        = string
  default     = "acrstiggsyncai"
}

# AKS Configuration
variable "aks_name" {
  description = "Name of the AKS cluster"
  type        = string
  default     = "aks-stiggsyncai-prod"
}

variable "kubernetes_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.30.14"
}

variable "node_count" {
  description = "Number of nodes in the default node pool"
  type        = number
  default     = 2
}

variable "node_vm_size" {
  description = "VM size for AKS nodes"
  type        = string
  default     = "Standard_D4s_v3"
}

# Database Configuration
variable "sql_server_name" {
  description = "Name of the SQL Server"
  type        = string
  default     = "stiggsyncai-sql-prod"
}

variable "sql_database_name" {
  description = "Name of the SQL Database"
  type        = string
  default     = "stiggsyncai-db-prod"
}

variable "sql_admin_username" {
  description = "SQL Server admin username"
  type        = string
  default     = "sqladmin"
  sensitive   = true
}

variable "sql_admin_password" {
  description = "SQL Server admin password"
  type        = string
  sensitive   = true
}

# Redis Configuration
variable "redis_name" {
  description = "Name of the Redis cache"
  type        = string
  default     = "redis-stiggsyncai-prod"
}

# Key Vault Configuration
variable "key_vault_name" {
  description = "Name of the Key Vault"
  type        = string
  default     = "kv-stiggsyncai-prod"
}

# Application Insights
variable "app_insights_name" {
  description = "Name of Application Insights"
  type        = string
  default     = "stiggsyncai-appinsights"
}

# Log Analytics
variable "log_analytics_name" {
  description = "Name of Log Analytics workspace"
  type        = string
  default     = "log-stiggsyncai-prod"
}

# Storage Account
variable "storage_account_name" {
  description = "Name of the storage account"
  type        = string
  default     = "sastiggsyncaiprod"
}

# Network Configuration
variable "allowed_ip_range" {
  description = "Allowed IP range for network access"
  type        = string
  default     = "0.0.0.0/0"
}

# Common Tags
variable "common_tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default = {
    Environment = "Production"
    Project     = "StiggSyncAI"
    Owner       = "StiggTechnologies"
    CostCenter  = "IT-Operations"
    Backup      = "Required"
    Monitoring  = "Required"
  }
}

# Feature Flags
variable "enable_blockchain_audit" {
  description = "Enable blockchain audit features"
  type        = bool
  default     = true
}

variable "enable_digital_twins" {
  description = "Enable digital twins integration"
  type        = bool
  default     = true
}

variable "enable_esg_tracking" {
  description = "Enable ESG metrics tracking"
  type        = bool
  default     = true
}

variable "enable_mobile_app" {
  description = "Enable mobile app features"
  type        = bool
  default     = true
}

# Scaling Configuration
variable "min_node_count" {
  description = "Minimum number of nodes for auto-scaling"
  type        = number
  default     = 3
}

variable "max_node_count" {
  description = "Maximum number of nodes for auto-scaling"
  type        = number
  default     = 20
}

# Backup Configuration
variable "backup_retention_days" {
  description = "Number of days to retain backups"
  type        = number
  default     = 30
}

variable "enable_geo_redundancy" {
  description = "Enable geo-redundant backups"
  type        = bool
  default     = true
}