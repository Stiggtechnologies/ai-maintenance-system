using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Azure.Identity;
using Azure.Security.KeyVault.Secrets;
using StackExchange.Redis;
using StiggSyncAI.Services;
using StiggSyncAI.Models;
using StiggSyncAI.Repositories;
using AutoMapper;
using FluentValidation;

namespace StiggSyncAI.Functions
{
    public class Startup
    {
        public void ConfigureServices(IServiceCollection services, IConfiguration configuration)
        {
            // Azure Key Vault Configuration
            var keyVaultUrl = configuration["KeyVaultUrl"];
            if (!string.IsNullOrEmpty(keyVaultUrl))
            {
                var secretClient = new SecretClient(new Uri(keyVaultUrl), new DefaultAzureCredential());
                services.AddSingleton(secretClient);
            }

            // Database Configuration
            var connectionString = configuration.GetConnectionString("DefaultConnection");
            services.AddDbContext<MaintenanceDbContext>(options =>
                options.UseSqlServer(connectionString));

            // Redis Cache Configuration
            var redisConnectionString = configuration.GetConnectionString("Redis");
            if (!string.IsNullOrEmpty(redisConnectionString))
            {
                services.AddSingleton<IConnectionMultiplexer>(ConnectionMultiplexer.Connect(redisConnectionString));
                services.AddStackExchangeRedisCache(options =>
                {
                    options.Configuration = redisConnectionString;
                });
            }

            // AutoMapper Configuration
            services.AddAutoMapper(typeof(Startup));

            // FluentValidation
            services.AddValidatorsFromAssemblyContaining<Startup>();

            // HTTP Client Configuration
            services.AddHttpClient();

            // Register Services
            services.AddScoped<IAgentOrchestrator, AgentOrchestrator>();
            services.AddScoped<IAIAgentService, AIAgentService>();
            services.AddScoped<IWorkOrderService, WorkOrderService>();
            services.AddScoped<IAssetService, AssetService>();
            services.AddScoped<IMaintenanceRepository, MaintenanceRepository>();
            services.AddScoped<IAuditService, AuditService>();
            services.AddScoped<INotificationService, NotificationService>();
            services.AddScoped<IIntegrationService, IntegrationService>();
            services.AddScoped<IESGService, ESGService>();
            services.AddScoped<IBlockchainService, BlockchainService>();

            // Register AI Agents
            RegisterAIAgents(services);

            // Authentication & Authorization
            services.AddAuthentication("Bearer")
                .AddJwtBearer("Bearer", options =>
                {
                    options.Authority = configuration["AzureAd:Authority"];
                    options.Audience = configuration["AzureAd:Audience"];
                });

            services.AddAuthorization();
        }

        private void RegisterAIAgents(IServiceCollection services)
        {
            // Register all 15 M&R AI Agents
            services.AddScoped<IPreventiveMaintenanceAgent, PreventiveMaintenanceAgent>();
            services.AddScoped<IPredictiveAnalyticsAgent, PredictiveAnalyticsAgent>();
            services.AddScoped<IAssetHealthAgent, AssetHealthAgent>();
            services.AddScoped<IWorkOrderAgent, WorkOrderAgent>();
            services.AddScoped<IRootCauseAnalysisAgent, RootCauseAnalysisAgent>();
            services.AddScoped<ISparePartsAgent, SparePartsAgent>();
            services.AddScoped<IPerformanceAnalysisAgent, PerformanceAnalysisAgent>();
            services.AddScoped<IFailureModeAgent, FailureModeAgent>();
            services.AddScoped<ICostOptimizationAgent, CostOptimizationAgent>();
            services.AddScoped<IComplianceAgent, ComplianceAgent>();
            services.AddScoped<IRiskAssessmentAgent, RiskAssessmentAgent>();
            services.AddScoped<IEnergyEfficiencyAgent, EnergyEfficiencyAgent>();
            services.AddScoped<IEnvironmentalAgent, EnvironmentalAgent>();
            services.AddScoped<ISafetyAgent, SafetyAgent>();
            services.AddScoped<IReliabilityAgent, ReliabilityAgent>();
        }
    }
}