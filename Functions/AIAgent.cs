using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Threading.Tasks;
using System.Text.Json;
using Azure.AI.OpenAI;
using Azure;
using Azure.AI.OpenAI;
using Azure;

namespace StiggSyncAI.Functions
{
    public class AIAgent
    {
        private readonly ILogger<AIAgent> _logger;
        private readonly HttpClient _httpClient;
        private readonly OpenAIClient _openAIClient;
        private readonly OpenAIClient _openAIClient;

        public AIAgent(ILogger<AIAgent> logger, IHttpClientFactory factory)
        {
            _logger = logger;
            _httpClient = factory.CreateClient();
            
            // Support both Azure AI Foundry and Azure OpenAI
            var aiFoundryEndpoint = Environment.GetEnvironmentVariable("AzureAIFoundryEndpoint");
            var openAIEndpoint = Environment.GetEnvironmentVariable("AzureOpenAIEndpoint");
            var apiKey = Environment.GetEnvironmentVariable("AzureOpenAIKey") ?? Environment.GetEnvironmentVariable("AzureAIFoundryKey");
            
            if (!string.IsNullOrEmpty(aiFoundryEndpoint) && !string.IsNullOrEmpty(apiKey))
            {
                _openAIClient = new OpenAIClient(new Uri(aiFoundryEndpoint), new AzureKeyCredential(apiKey));
            }
            else if (!string.IsNullOrEmpty(openAIEndpoint) && !string.IsNullOrEmpty(apiKey))
            {
                _openAIClient = new OpenAIClient(new Uri(openAIEndpoint), new AzureKeyCredential(apiKey));
            }
            
            // Support both Azure AI Foundry and Azure OpenAI
            var aiFoundryEndpoint = Environment.GetEnvironmentVariable("AzureAIFoundryEndpoint");
            var openAIEndpoint = Environment.GetEnvironmentVariable("AzureOpenAIEndpoint");
            var apiKey = Environment.GetEnvironmentVariable("AzureOpenAIKey") ?? Environment.GetEnvironmentVariable("AzureAIFoundryKey");
            
            if (!string.IsNullOrEmpty(aiFoundryEndpoint) && !string.IsNullOrEmpty(apiKey))
            {
                _openAIClient = new OpenAIClient(new Uri(aiFoundryEndpoint), new AzureKeyCredential(apiKey));
            }
            else if (!string.IsNullOrEmpty(openAIEndpoint) && !string.IsNullOrEmpty(apiKey))
            {
                _openAIClient = new OpenAIClient(new Uri(openAIEndpoint), new AzureKeyCredential(apiKey));
            }
        }

        [Function("AIAgent")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "ai-agent")] HttpRequestData req)
        {
            _logger.LogInformation("Processing AI Agent request.");

            try
            {
                var request = await JsonSerializer.DeserializeAsync<AIRequest>(req.Body);
                if (string.IsNullOrEmpty(request?.Query))
                {
                    _logger.LogWarning("Empty query received.");
                    var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await errorResponse.WriteStringAsync("Query is required.");
                    return errorResponse;
                }

                // Try Azure AI Foundry/OpenAI first, then fallback to AI Studio
                if (_openAIClient != null)
                {
                    try
                    {
                        var chatResponse = await _openAIClient.GetChatCompletionsAsync(new ChatCompletionsOptions
                        {
                            DeploymentName = Environment.GetEnvironmentVariable("AzureOpenAIDeploymentName") ?? "gpt-4",
                            Messages = 
                            {
                                new ChatRequestSystemMessage("You are an AI assistant for industrial maintenance and reliability operations."),
                                new ChatRequestUserMessage(request.Query)
                            },
                            MaxTokens = 1000,
                            Temperature = 0.7f
                        });
                        
                        var response = req.CreateResponse(HttpStatusCode.OK);
                        await response.WriteAsJsonAsync(new { response = chatResponse.Value.Choices[0].Message.Content });
                        return response;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Azure AI Foundry/OpenAI request failed, trying fallback");
                    }
                }

                // Fallback to Azure AI Studio
                var aiStudioUrl = Environment.GetEnvironmentVariable("AzureAIStudioUrl");
                if (!string.IsNullOrEmpty(aiStudioUrl))
                {
                    try
                    {
                        var aiResponse = await _httpClient.PostAsJsonAsync(aiStudioUrl, request);
                        if (aiResponse.IsSuccessStatusCode)
                        {
                            var aiData = await aiResponse.Content.ReadFromJsonAsync<AIStudioResponse>();
                            var response = req.CreateResponse(HttpStatusCode.OK);
                            await response.WriteAsJsonAsync(new { response = aiData?.Response ?? "AI response processed" });
                            return response;
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "AI Studio request failed");
                    }
                }
                
                // Final fallback response
                {
                    var response = req.CreateResponse(HttpStatusCode.OK);
                    await response.WriteAsJsonAsync(new { response = $"AI maintenance assistant: I've processed your query about '{request.Query}'. For full AI capabilities, please configure Azure AI Foundry or Azure OpenAI service." });
                    return response;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing AI agent request.");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync("Internal server error.");
                return errorResponse;
            }
        }
            // Try Azure AI Foundry/OpenAI first, then fallback to AI Studio
                try
                {
                    var chatResponse = await _openAIClient.GetChatCompletionsAsync(new ChatCompletionsOptions
                    {
                        DeploymentName = Environment.GetEnvironmentVariable("AzureOpenAIDeploymentName") ?? "gpt-4",
                        Messages = 
                        {
                            new ChatRequestSystemMessage("You are an AI assistant for industrial maintenance and reliability operations."),
                            new ChatRequestUserMessage(request.Query)
                        },
                        MaxTokens = 1000,
                        Temperature = 0.7f
                    });
                    
                    var response = req.CreateResponse(HttpStatusCode.OK);
                    await response.WriteAsJsonAsync(new { response = chatResponse.Value.Choices[0].Message.Content });
                    return response;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Azure AI Foundry/OpenAI request failed, trying fallback");
                }
        }
            // Fallback to Azure AI Studio
            var aiStudioUrl = Environment.GetEnvironmentVariable("AzureAIStudioUrl");
            if (!string.IsNullOrEmpty(aiStudioUrl))
            {
                try
                {
                    var aiResponse = await _httpClient.PostAsJsonAsync(aiStudioUrl, request);
                    if (aiResponse.IsSuccessStatusCode)
                    {
                        var aiData = await aiResponse.Content.ReadFromJsonAsync<AIStudioResponse>();
                        var response = req.CreateResponse(HttpStatusCode.OK);
                        await response.WriteAsJsonAsync(new { response = aiData?.Response ?? "AI response processed" });
                        return response;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "AI Studio request failed");
                }
            }
            
            // Final fallback response
            {
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { response = $"AI maintenance assistant: I've processed your query about '{request.Query}'. For full AI capabilities, please configure Azure AI Foundry or Azure OpenAI service." });
                return response;
            }
        }
    }
}