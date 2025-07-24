using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Identity.Client;
using Microsoft.Data.SqlClient;
using System.Text.Json;
using BCrypt.Net;
using StackExchange.Redis;

namespace StiggSyncAI.Functions
{
    public class Token
    {
        private readonly ILogger<Token> _logger;
        private readonly IConfidentialClientApplication _entraApp;
        private readonly string _sqlConnectionString;
        private readonly IDatabase _redis;

        public Token(ILogger<Token> logger, IConfidentialClientApplication entraApp)
        {
            _logger = logger;
            _entraApp = entraApp;
            _sqlConnectionString = Environment.GetEnvironmentVariable("SqlConnectionString") ?? "";
            var redisConnection = Environment.GetEnvironmentVariable("RedisConnectionString");
            if (!string.IsNullOrEmpty(redisConnection))
            {
                _redis = ConnectionMultiplexer.Connect(redisConnection).GetDatabase();
            }
        }

        [Function("Token")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "token")] HttpRequestData req)
        {
            _logger.LogInformation("Processing token request.");

            try
            {
                var formData = await req.ReadFormAsync();
                var username = formData["username"].ToString();
                var password = formData["password"].ToString();

                if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
                {
                    _logger.LogWarning("Invalid username or password.");
                    var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await errorResponse.WriteStringAsync("Username and password are required.");
                    return errorResponse;
                }

                using var conn = new SqlConnection(_sqlConnectionString);
                await conn.OpenAsync();
                var cmd = new SqlCommand("SELECT user_id, org_id, password_hash, is_active FROM users WHERE username = @username", conn);
                cmd.Parameters.AddWithValue("@username", username);
                using var reader = await cmd.ExecuteReaderAsync();

                if (!await reader.ReadAsync() || !BCrypt.Net.BCrypt.Verify(password, reader["password_hash"].ToString()) || !(bool)reader["is_active"])
                {
                    _logger.LogWarning("Invalid credentials or inactive user for {username}", username);
                    var errorResponse = req.CreateResponse(HttpStatusCode.Unauthorized);
                    await errorResponse.WriteStringAsync("Invalid credentials or inactive user.");
                    return errorResponse;
                }

                var userId = (int)reader["user_id"];
                var orgId = (int)reader["org_id"];
                await reader.CloseAsync();

                // Check concurrent user limits
                if (_redis != null)
                {
                    var key = $"org:{orgId}:active_users";
                    var activeUsers = await _redis.SetLengthAsync(key);
                    var orgCmd = new SqlCommand("SELECT max_concurrent_users FROM organizations WHERE org_id = @orgId", conn);
                    orgCmd.Parameters.AddWithValue("@orgId", orgId);
                    var maxUsers = (int)await orgCmd.ExecuteScalarAsync();

                    if (activeUsers >= maxUsers)
                    {
                        _logger.LogWarning("Concurrent user limit reached for org_id {orgId}", orgId);
                        var errorResponse = req.CreateResponse(HttpStatusCode.Forbidden);
                        await errorResponse.WriteStringAsync("Concurrent user limit reached.");
                        return errorResponse;
                    }

                    await _redis.SetAddAsync(key, userId);
                    await _redis.KeyExpireAsync(key, TimeSpan.FromHours(1));
                }

                // Get Entra ID token
                var tokenResult = await _entraApp.AcquireTokenForClient(new[] { "api://your-api/.default" }).ExecuteAsync();
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { access_token = tokenResult.AccessToken, token_type = "bearer" });

                // Audit log
                var auditCmd = new SqlCommand(
                    "INSERT INTO audit_logs (org_id, user_id, action, details, timestamp) VALUES (@orgId, @userId, @action, @details, @timestamp)",
                    conn);
                auditCmd.Parameters.AddWithValue("@orgId", orgId);
                auditCmd.Parameters.AddWithValue("@userId", userId);
                auditCmd.Parameters.AddWithValue("@action", "Login");
                auditCmd.Parameters.AddWithValue("@details", $"User {username} logged in");
                auditCmd.Parameters.AddWithValue("@timestamp", DateTime.UtcNow);
                await auditCmd.ExecuteNonQueryAsync();

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing token request.");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync("Internal server error.");
                return errorResponse;
            }
        }
    }
}