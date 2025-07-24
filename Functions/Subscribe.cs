using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using System.Text.Json;
using Stripe;

namespace StiggSyncAI.Functions
{
    public class Subscribe
    {
        private readonly ILogger<Subscribe> _logger;
        private readonly string _sqlConnectionString;

        public Subscribe(ILogger<Subscribe> logger)
        {
            _logger = logger;
            _sqlConnectionString = Environment.GetEnvironmentVariable("SqlConnectionString") ?? "";
            StripeConfiguration.ApiKey = Environment.GetEnvironmentVariable("STRIPE_API_KEY");
        }

        [Function("Subscribe")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "organizations/subscribe")] HttpRequestData req)
        {
            _logger.LogInformation("Processing subscription request.");

            try
            {
                var request = await JsonSerializer.DeserializeAsync<SubscriptionRequest>(req.Body);
                var token = req.Headers.GetValues("Authorization").FirstOrDefault()?.Replace("Bearer ", "");

                if (string.IsNullOrEmpty(token))
                {
                    _logger.LogWarning("Missing authorization token.");
                    var errorResponse = req.CreateResponse(HttpStatusCode.Unauthorized);
                    await errorResponse.WriteStringAsync("Authorization token required.");
                    return errorResponse;
                }

                using var conn = new SqlConnection(_sqlConnectionString);
                await conn.OpenAsync();
                var userCmd = new SqlCommand("SELECT user_id, org_id, role FROM users WHERE token = @token AND is_active = 1", conn);
                userCmd.Parameters.AddWithValue("@token", token);
                using var userReader = await userCmd.ExecuteReaderAsync();

                if (!await userReader.ReadAsync() || userReader["role"].ToString() != "admin")
                {
                    _logger.LogWarning("Unauthorized subscription attempt for token {token}", token);
                    var errorResponse = req.CreateResponse(HttpStatusCode.Forbidden);
                    await errorResponse.WriteStringAsync("Only admins can manage subscriptions.");
                    return errorResponse;
                }

                var userId = (int)userReader["user_id"];
                var orgId = (int)userReader["org_id"];
                await userReader.CloseAsync();

                var orgCmd = new SqlCommand("SELECT stripe_customer_id, subscription_plan, billing_cycle FROM organizations WHERE org_id = @orgId", conn);
                orgCmd.Parameters.AddWithValue("@orgId", orgId);
                using var orgReader = await orgCmd.ExecuteReaderAsync();

                if (!await orgReader.ReadAsync())
                {
                    _logger.LogWarning("Organization not found for org_id {orgId}", orgId);
                    var errorResponse = req.CreateResponse(HttpStatusCode.NotFound);
                    await errorResponse.WriteStringAsync("Organization not found.");
                    return errorResponse;
                }

                var customerId = orgReader["stripe_customer_id"]?.ToString();
                var currentPlan = orgReader["subscription_plan"]?.ToString();
                var currentCycle = orgReader["billing_cycle"]?.ToString();
                await orgReader.CloseAsync();

                if (currentPlan == request.Plan && currentCycle == request.BillingCycle)
                {
                    _logger.LogWarning("Already subscribed to plan {plan} for billing cycle {cycle}", request.Plan, request.BillingCycle);
                    var errorResponse = req.CreateResponse(HttpStatusCode.BadRequest);
                    await errorResponse.WriteStringAsync("Already subscribed to this plan.");
                    return errorResponse;
                }

                if (string.IsNullOrEmpty(customerId))
                {
                    var customer = await new CustomerService().CreateAsync(new CustomerCreateOptions { Name = orgId.ToString(), Email = "admin@org.com" });
                    customerId = customer.Id;
                }

                var lineItems = new List<SessionLineItemOptions>
                {
                    new SessionLineItemOptions
                    {
                        Price = request.BillingCycle == "annual" ? GetAnnualPriceId(request.Plan) : GetMonthlyPriceId(request.Plan),
                        Quantity = 1
                    }
                };

                foreach (var addOn in request.AddOns)
                {
                    if (addOn.Key == "ai_customization" && request.Plan != "enterprise")
                        continue;
                    if (addOn.Value > 0)
                    {
                        lineItems.Add(new SessionLineItemOptions
                        {
                            Price = GetAddOnPriceId(addOn.Key),
                            Quantity = addOn.Value
                        });
                    }
                }

                var session = await new CheckoutSessionService().CreateAsync(new SessionCreateOptions
                {
                    Customer = customerId,
                    PaymentMethodTypes = new List<string> { "card" },
                    LineItems = lineItems,
                    Mode = "subscription",
                    SuccessUrl = "https://stiggtechnologies.com/success",
                    CancelUrl = "https://stiggtechnologies.com/cancel",
                    Discounts = request.BillingCycle == "annual" ? new List<SessionDiscountOptions> { new SessionDiscountOptions { Coupon = "annual_discount" } } : null
                });

                var updateCmd = new SqlCommand(
                    "UPDATE organizations SET subscription_plan = @plan, max_concurrent_users = @maxUsers, stripe_customer_id = @customerId, billing_cycle = @cycle WHERE org_id = @orgId",
                    conn);
                updateCmd.Parameters.AddWithValue("@plan", request.Plan);
                updateCmd.Parameters.AddWithValue("@maxUsers", GetMaxUsers(request.Plan));
                updateCmd.Parameters.AddWithValue("@customerId", customerId);
                updateCmd.Parameters.AddWithValue("@cycle", request.BillingCycle);
                updateCmd.Parameters.AddWithValue("@orgId", orgId);
                await updateCmd.ExecuteNonQueryAsync();

                var auditCmd = new SqlCommand(
                    "INSERT INTO audit_logs (org_id, user_id, action, details, timestamp) VALUES (@orgId, @userId, @action, @details, @timestamp)",
                    conn);
                auditCmd.Parameters.AddWithValue("@orgId", orgId);
                auditCmd.Parameters.AddWithValue("@userId", userId);
                auditCmd.Parameters.AddWithValue("@action", "Subscribe");
                auditCmd.Parameters.AddWithValue("@details", $"Subscribed to {request.Plan} ({request.BillingCycle})");
                auditCmd.Parameters.AddWithValue("@timestamp", DateTime.UtcNow);
                await auditCmd.ExecuteNonQueryAsync();

                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new { checkout_url = session.Url });
                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing subscription request.");
                var errorResponse = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errorResponse.WriteStringAsync("Internal server error.");
                return errorResponse;
            }
        }

        private string GetMonthlyPriceId(string plan) => plan switch
        {
            "basic" => "price_basic_monthly",
            "pro" => "price_pro_monthly",
            "enterprise" => "price_enterprise_monthly",
            _ => throw new ArgumentException("Invalid plan")
        };

        private string GetAnnualPriceId(string plan) => plan switch
        {
            "basic" => "price_basic_annual",
            "pro" => "price_pro_annual",
            "enterprise" => "price_enterprise_annual",
            _ => throw new ArgumentException("Invalid plan")
        };

        private string GetAddOnPriceId(string addOn) => addOn switch
        {
            "extra_user" => "price_extra_user",
            "premium_support" => "price_premium_support",
            "ai_customization" => "price_ai_customization",
            _ => throw new ArgumentException("Invalid add-on")
        };

        private int GetMaxUsers(string plan) => plan switch
        {
            "freemium" => 1,
            "basic" => 5,
            "pro" => 20,
            "enterprise" => 100,
            _ => throw new ArgumentException("Invalid plan")
        };
    }

    public class SubscriptionRequest
    {
        public string Plan { get; set; } = "";
        public string BillingCycle { get; set; } = "";
        public Dictionary<string, int> AddOns { get; set; } = new();
    }
}