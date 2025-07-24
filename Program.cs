using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.ApplicationInsights.Extensibility;
using StiggSyncAI.Functions;
using Microsoft.Identity.Client;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((context, services) =>
    {
        services.AddApplicationInsightsTelemetryWorkerService();
        services.ConfigureFunctionsApplicationInsights();
        services.Configure<TelemetryConfiguration>(config =>
        {
            config.TelemetryInitializers.Add(new OperationCorrelationTelemetryInitializer());
        });
        services.AddHttpClient();
        
        // Configure Entra ID
        services.AddSingleton<IConfidentialClientApplication>(sp =>
        {
            return ConfidentialClientApplicationBuilder
                .Create(Environment.GetEnvironmentVariable("EntraClientId") ?? "your-entra-client-id")
                .WithClientSecret(Environment.GetEnvironmentVariable("EntraClientSecret") ?? "your-entra-client-secret")
                .WithAuthority(new Uri($"https://login.microsoftonline.com/{Environment.GetEnvironmentVariable("EntraTenantId") ?? "your-tenant-id"}"))
                .Build();
        });
        
        // Register custom services
        var startup = new Startup();
        startup.ConfigureServices(services, context.Configuration);
    })
    .Build();

await host.RunAsync();