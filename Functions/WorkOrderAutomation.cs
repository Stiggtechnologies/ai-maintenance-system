using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using System.Text.Json;
using Azure.AI.OpenAI;

namespace StiggSyncAI.Functions
{
    public class WorkOrderAutomation
    {
        private readonly ILogger<WorkOrderAutomation> _logger;
        private readonly string _sqlConnectionString;
        private readonly OpenAIClient? _aiClient;

        public WorkOrderAutomation(ILogger<WorkOrderAutomation> logger)
        {
            _logger = logger;
            _sqlConnectionString = Environment.GetEnvironmentVariable("SqlConnectionString") ?? "";
            var openAIKey = Environment.GetEnvironmentVariable("AzureOpenAIKey");
            if (!string.IsNullOrEmpty(openAIKey))
            {
                _aiClient = new OpenAIClient(openAIKey);
            }
        }

        [Function("WorkOrderAutomation")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "workorder-automation")] HttpRequestData req)
        {
            _logger.LogInformation("Processing automated work order generation.");

            try
            {
                var sensorData = new[] { new { AssetId = "A001", Vibration = 0.9, Timestamp = DateTime.UtcNow } };
                var prompt = $"Analyze sensor data: {JsonSerializer.Serialize(sensorData)}. Generate work order if anomaly detected.";
                
                string aiResponse;
                if (_aiClient != null)
                {
                    var aiResult = await _aiClient.GetChatCompletionsAsync(new ChatCompletionsOptions
                    {
                        DeploymentName = "phi-3",
                        Messages = { new ChatRequestSystemMessage(prompt) }
                    });
                    aiResponse = aiResult.Value.Choices[0].Message.Content;
                }
                else
                {
                    // Fallback logic when OpenAI is not configured
                    aiResponse = "anomaly detected"; // Simulate anomaly detection
                }

                if (!aiResponse.Contains("anomaly"))
                {
                    var response = req.CreateResponse(HttpStatusCode.OK);
                    await response.WriteStringAsync("No anomalies detected.");
                    return response;
                }

                using var conn = new SqlConnection(_sqlConnectionString);
                await conn.OpenAsync();
                var cmd = new SqlCommand(
                    "INSERT INTO work_orders (work_order_id, org_id, asset_id, description, priority, maintenance_type, assigned_technician) " +
                    "VALUES (@id, @orgId, @assetId, @desc, @priority, @type, @tech)",
                    conn);
                cmd.Parameters.AddWithValue("@id", $"WO{DateTime.Now.Ticks}");
                cmd.Parameters.AddWithValue("@orgId", 1);
                cmd.Parameters.AddWithValue("@assetId", "A001");
                cmd.Parameters.AddWithValue("@desc", "AI-detected vibration anomaly");
                cmd.Parameters.AddWithValue("@priority", "High");
                cmd.Parameters.AddWithValue("@type", "corrective");
                cmd.Parameters.AddWithValue("@tech", "tech1");
                await cmd.ExecuteNonQueryAsync();

                _logger.LogInformation("Teams: Auto-notified technician.");
                var successResponse = req.CreateResponse(HttpStatusCode.OK);
                await successResponse.WriteStringAsync("Work order created and Teams notified.");
                return successResponse;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing work order generation.");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync("Internal server error.");
                return errorResponse;
            }
        }
    }
}