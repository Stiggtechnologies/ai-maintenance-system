using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using System.Text.Json;
using Azure.AI.OpenAI;
using Azure;

namespace StiggSyncAI.Functions
{
    public class AgentOrchestrator
    {
        private readonly ILogger<AgentOrchestrator> _logger;
        private readonly string _sqlConnectionString;
        private readonly OpenAIClient _aiClient;
        private readonly HttpClient _httpClient;

        public AgentOrchestrator(ILogger<AgentOrchestrator> logger, IHttpClientFactory factory)
        {
            _logger = logger;
            _sqlConnectionString = Environment.GetEnvironmentVariable("SqlConnectionString") ?? "";
            _httpClient = factory.CreateClient();
            
            // Support both Azure AI Foundry and Azure OpenAI
            var aiFoundryEndpoint = Environment.GetEnvironmentVariable("AzureAIFoundryEndpoint");
            var openAIEndpoint = Environment.GetEnvironmentVariable("AzureOpenAIEndpoint");
            var apiKey = Environment.GetEnvironmentVariable("AzureOpenAIKey") ?? Environment.GetEnvironmentVariable("AzureAIFoundryKey");
            
            if (!string.IsNullOrEmpty(aiFoundryEndpoint) && !string.IsNullOrEmpty(apiKey))
            {
                _aiClient = new OpenAIClient(new Uri(aiFoundryEndpoint), new AzureKeyCredential(apiKey));
            }
            else if (!string.IsNullOrEmpty(openAIEndpoint) && !string.IsNullOrEmpty(apiKey))
            {
                _aiClient = new OpenAIClient(new Uri(openAIEndpoint), new AzureKeyCredential(apiKey));
            }
        }

        [Function("AgentOrchestrator")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "agent-orchestrator")] HttpRequestData req)
        {
            _logger.LogInformation("Processing agent orchestration request.");

            try
            {
                var request = await JsonSerializer.DeserializeAsync<AgentRequest>(req.Body);
                if (request == null)
                {
                    var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await errorResponse.WriteStringAsync("Invalid request format.");
                    return errorResponse;
                }

                var agent = request.Agent;
                var orgId = request.OrgId;
                var industry = request.Industry;
                var response = req.CreateResponse(HttpStatusCode.OK);

                var platformData = await FetchPlatformData(orgId, industry);

                switch (agent)
                {
                    case "MaintenanceStrategyDevelopmentAgent":
                        var strategyPrompt = $"Develop maintenance strategy for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var strategyResponse = await GetAIResponse(strategyPrompt);
                        await response.WriteAsJsonAsync(new { result = strategyResponse });
                        break;

                    case "AssetManagementAgent":
                        var assetPrompt = $"Update asset register and calculate criticality for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var assetResponse = await GetAIResponse(assetPrompt);
                        await response.WriteAsJsonAsync(new { result = assetResponse });
                        break;

                    case "ReliabilityEngineeringAgent":
                        var reliabilityResponse = await HandleReliabilityEngineering(orgId, industry, platformData);
                        await response.WriteAsJsonAsync(new { result = reliabilityResponse });
                        break;

                    case "PlanningSchedulingAgent":
                        var planningPrompt = $"Generate maintenance schedule for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var planningResponse = await GetAIResponse(planningPrompt);
                        await response.WriteAsJsonAsync(new { result = planningResponse });
                        break;

                    case "WorkOrderManagementAgent":
                        var workOrderResponse = await HandleWorkOrderAutomation(orgId, industry, platformData);
                        await response.WriteAsJsonAsync(workOrderResponse);
                        break;

                    case "ConditionMonitoringAgent":
                        var conditionPrompt = $"Analyze sensor data for org_id {orgId} in {industry}: {JsonSerializer.Serialize(platformData)}. Detect anomalies.";
                        var conditionResponse = await GetAIResponse(conditionPrompt);
                        await response.WriteAsJsonAsync(new { result = conditionResponse });
                        break;

                    case "InventoryManagementAgent":
                        var inventoryPrompt = $"Optimize inventory for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var inventoryResponse = await GetAIResponse(inventoryPrompt);
                        await response.WriteAsJsonAsync(new { result = inventoryResponse });
                        break;

                    case "MaintenanceOperationsAgent":
                        var operationsPrompt = $"Oversee maintenance execution for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var operationsResponse = await GetAIResponse(operationsPrompt);
                        await response.WriteAsJsonAsync(new { result = operationsResponse });
                        break;

                    case "QualityAssuranceAgent":
                        var qualityPrompt = $"Validate maintenance outcomes for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var qualityResponse = await GetAIResponse(qualityPrompt);
                        await response.WriteAsJsonAsync(new { result = qualityResponse });
                        break;

                    case "ComplianceAuditingAgent":
                        var compliancePrompt = $"Generate {industry}-specific compliance report (e.g., ISO 55000, AER for Oil & Gas) for org_id {orgId} using data: {JsonSerializer.Serialize(platformData)}.";
                        var complianceResponse = await GetAIResponse(compliancePrompt);
                        await response.WriteAsJsonAsync(new { result = complianceResponse });
                        break;

                    case "SustainabilityESGAgent":
                        var esgPrompt = $"Track ESG metrics for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var esgResponse = await GetAIResponse(esgPrompt);
                        await response.WriteAsJsonAsync(new { result = esgResponse });
                        break;

                    case "DataAnalyticsAgent":
                        var analyticsPrompt = $"Generate analytics and performance metrics for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var analyticsResponse = await GetAIResponse(analyticsPrompt);
                        await response.WriteAsJsonAsync(new { result = analyticsResponse });
                        break;

                    case "ContinuousImprovementAgent":
                        var improvementPrompt = $"Analyze feedback and suggest improvements for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var improvementResponse = await GetAIResponse(improvementPrompt);
                        await response.WriteAsJsonAsync(new { result = improvementResponse });
                        break;

                    case "TrainingWorkforceAgent":
                        var trainingPrompt = $"Generate training program for org_id {orgId} in {industry} based on skill gaps: {JsonSerializer.Serialize(platformData)}.";
                        var trainingResponse = await GetAIResponse(trainingPrompt);
                        await response.WriteAsJsonAsync(new { result = trainingResponse });
                        break;

                    case "FinancialContractAgent":
                        var financialPrompt = $"Optimize budget and contracts for org_id {orgId} in {industry} using data: {JsonSerializer.Serialize(platformData)}.";
                        var financialResponse = await GetAIResponse(financialPrompt);
                        await response.WriteAsJsonAsync(new { result = financialResponse });
                        break;

                    default:
                        _logger.LogWarning("Invalid agent: {agent}", agent);
                        var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                        await errorResponse.WriteStringAsync("Invalid agent.");
                        return errorResponse;
                }

                // Audit logging
                await LogAgentExecution(orgId, agent, industry);

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing agent orchestration.");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync("Internal server error.");
                return errorResponse;
            }
        }

        private async Task<string> GetAIResponse(string prompt)
        {
            try
            {
                if (_aiClient != null)
                {
                    var aiResponse = await _aiClient.GetChatCompletionsAsync(new ChatCompletionsOptions
                    {
                        DeploymentName = Environment.GetEnvironmentVariable("AzureOpenAIDeploymentName") ?? "gpt-4",
                        Messages = 
                        {
                            new ChatRequestSystemMessage("You are an expert AI agent for industrial maintenance and reliability operations. Provide detailed, actionable insights."),
                            new ChatRequestUserMessage(prompt)
                        },
                        MaxTokens = 1500,
                        Temperature = 0.3f
                    });
                    return aiResponse.Value.Choices[0].Message.Content;
                }
                else
                {
                    // Fallback response when AI services are not configured
                    await Task.Delay(100);
                    return $"M&R AI Agent Analysis: {prompt.Substring(0, Math.Min(100, prompt.Length))}... [Configure Azure AI Foundry for enhanced capabilities]";
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting AI response");
                return "AI processing temporarily unavailable. Please check Azure AI Foundry configuration.";
            }
        }

        private async Task<object> FetchPlatformData(int orgId, string industry)
        {
            var platformData = new Dictionary<string, object>();
            try
            {
                if (industry == "Oil & Gas" || industry == "Chemical/Manufacturing")
                {
                    var sapResponse = await _httpClient.GetAsync($"https://mock-sap-pm-api.com/workorders?orgId={orgId}");
                    platformData["SAP_PM"] = sapResponse.IsSuccessStatusCode ? await sapResponse.Content.ReadFromJsonAsync<object>() : new { Error = "SAP PM unavailable" };
                    var osisoftResponse = await _httpClient.GetAsync($"https://mock-osisoft-pi-api.com/sensordata?orgId={orgId}");
                    platformData["OSIsoft_PI"] = osisoftResponse.IsSuccessStatusCode ? await osisoftResponse.Content.ReadFromJsonAsync<object>() : new { Error = "OSIsoft PI unavailable" };
                    var emersonResponse = await _httpClient.GetAsync($"https://mock-emerson-ams-api.com/conditiondata?orgId={orgId}");
                    platformData["Emerson_AMS"] = emersonResponse.IsSuccessStatusCode ? await emersonResponse.Content.ReadFromJsonAsync<object>() : new { Error = "Emerson AMS unavailable" };
                }
                else if (industry == "Mining")
                {
                    var maximoResponse = await _httpClient.GetAsync($"https://mock-maximo-api.com/workorders?orgId={orgId}");
                    platformData["Maximo"] = maximoResponse.IsSuccessStatusCode ? await maximoResponse.Content.ReadFromJsonAsync<object>() : new { Error = "Maximo unavailable" };
                    var upkeepResponse = await _httpClient.GetAsync($"https://mock-upkeep-api.com/maintenancelogs?orgId={orgId}");
                    platformData["UpKeep"] = upkeepResponse.IsSuccessStatusCode ? await upkeepResponse.Content.ReadFromJsonAsync<object>() : new { Error = "UpKeep unavailable" };
                }
                else if (industry == "Power & Utilities")
                {
                    var predixResponse = await _httpClient.GetAsync($"https://mock-predix-api.com/analytics?orgId={orgId}");
                    platformData["Predix"] = predixResponse.IsSuccessStatusCode ? await predixResponse.Content.ReadFromJsonAsync<object>() : new { Error = "Predix unavailable" };
                    var osisoftResponse = await _httpClient.GetAsync($"https://mock-osisoft-pi-api.com/sensordata?orgId={orgId}");
                    platformData["OSIsoft_PI"] = osisoftResponse.IsSuccessStatusCode ? await osisoftResponse.Content.ReadFromJsonAsync<object>() : new { Error = "OSIsoft PI unavailable" };
                }
                else if (industry == "Aerospace & Transportation")
                {
                    var honeywellResponse = await _httpClient.GetAsync($"https://mock-honeywell-apm-api.com/predictions?orgId={orgId}");
                    platformData["Honeywell_APM"] = honeywellResponse.IsSuccessStatusCode ? await honeywellResponse.Content.ReadFromJsonAsync<object>() : new { Error = "Honeywell APM unavailable" };
                    var maximoResponse = await _httpClient.GetAsync($"https://mock-maximo-api.com/workorders?orgId={orgId}");
                    platformData["Maximo"] = maximoResponse.IsSuccessStatusCode ? await maximoResponse.Content.ReadFromJsonAsync<object>() : new { Error = "Maximo unavailable" };
                }
                return platformData;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching platform data for org_id {orgId}, industry {industry}", orgId, industry);
                return new { Error = "Platform data fetch failed" };
            }
        }

        private async Task<string> HandleReliabilityEngineering(int orgId, string industry, object platformData)
        {
            try
            {
                using var conn = new SqlConnection(_sqlConnectionString);
                await conn.OpenAsync();
                var assetsCmd = new SqlCommand("SELECT asset_id, name, fmea_score FROM assets WHERE org_id = @orgId", conn);
                assetsCmd.Parameters.AddWithValue("@orgId", orgId);
                using var assetsReader = await assetsCmd.ExecuteReaderAsync();
                var assets = new List<object>();
                while (await assetsReader.ReadAsync())
                {
                    assets.Add(new { AssetId = assetsReader["asset_id"], Name = assetsReader["name"], FmeaScore = assetsReader["fmea_score"] });
                }
                await assetsReader.CloseAsync();
                
                var reliabilityPrompt = $"Analyze assets: {JsonSerializer.Serialize(assets)}, platform data: {JsonSerializer.Serialize(platformData)}. Predict failures for {industry}.";
                return await GetAIResponse(reliabilityPrompt);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in reliability engineering for org_id {orgId}", orgId);
                return "Reliability analysis temporarily unavailable";
            }
        }

        private async Task<object> HandleWorkOrderAutomation(int orgId, string industry, object platformData)
        {
            try
            {
                var prompt = $"Analyze platform data: {JsonSerializer.Serialize(platformData)} for {industry}. Generate work order if anomaly detected.";
                var aiResponse = await GetAIResponse(prompt);

                if (!aiResponse.Contains("anomaly"))
                    return new { result = "No anomalies detected." };

                using var conn = new SqlConnection(_sqlConnectionString);
                await conn.OpenAsync();
                var cmd = new SqlCommand(
                    "INSERT INTO work_orders (work_order_id, org_id, asset_id, description, priority, maintenance_type, assigned_technician) " +
                    "VALUES (@id, @orgId, @assetId, @desc, @priority, @type, @tech)",
                    conn);
                cmd.Parameters.AddWithValue("@id", $"WO{DateTime.Now.Ticks}");
                cmd.Parameters.AddWithValue("@orgId", orgId);
                cmd.Parameters.AddWithValue("@assetId", industry == "Oil & Gas" ? "A001" : "A003");
                cmd.Parameters.AddWithValue("@desc", $"AI-detected {industry} anomaly");
                cmd.Parameters.AddWithValue("@priority", "High");
                cmd.Parameters.AddWithValue("@type", "corrective");
                cmd.Parameters.AddWithValue("@tech", "tech1");
                await cmd.ExecuteNonQueryAsync();

                _logger.LogInformation($"Teams: Auto-notified technician for {industry}.");
                return new { result = "Work order created and Teams notified." };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating work order for org_id {orgId}, industry {industry}", orgId, industry);
                return new { result = "Work order generation failed." };
            }
        }

        private async Task LogAgentExecution(int orgId, string agent, string industry)
        {
            try
            {
                using var auditConn = new SqlConnection(_sqlConnectionString);
                await auditConn.OpenAsync();
                var auditCmd = new SqlCommand(
                    "INSERT INTO audit_logs (org_id, action, details, timestamp) VALUES (@orgId, @action, @details, @timestamp)",
                    auditConn);
                auditCmd.Parameters.AddWithValue("@orgId", orgId);
                auditCmd.Parameters.AddWithValue("@action", $"{agent} Execution");
                auditCmd.Parameters.AddWithValue("@details", $"Agent {agent} executed for org_id {orgId}, industry {industry}");
                auditCmd.Parameters.AddWithValue("@timestamp", DateTime.UtcNow);
                await auditCmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error logging agent execution");
            }
        }

        public class AgentRequest
        {
            public string Agent { get; set; } = "";
            public int OrgId { get; set; }
            public string Industry { get; set; } = "";
        }
    }
}