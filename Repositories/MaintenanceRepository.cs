using Microsoft.EntityFrameworkCore;
using StiggSyncAI.Models;

namespace StiggSyncAI.Repositories
{
    public interface IMaintenanceRepository
    {
        // Work Order operations
        Task<WorkOrder> CreateWorkOrderAsync(WorkOrder workOrder);
        Task<WorkOrder> UpdateWorkOrderAsync(WorkOrder workOrder);
        Task<List<WorkOrder>> GetWorkOrdersAsync();
        Task<WorkOrder?> GetWorkOrderByIdAsync(Guid id);
        Task<List<WorkOrder>> GetQueuedWorkOrdersAsync();

        // Asset operations
        Task<Asset> CreateAssetAsync(Asset asset);
        Task<Asset> UpdateAssetAsync(Asset asset);
        Task<List<Asset>> GetAssetsAsync();
        Task<Asset?> GetAssetByIdAsync(Guid id);
        Task<List<SensorReading>> GetAssetSensorReadingsAsync(Guid assetId);

        // Audit operations
        Task CreateAgentInteractionLogAsync(AgentInteractionLog log);
        Task CreateAuditLogAsync(AuditLog log);
        Task<List<AuditLog>> GetAuditLogsAsync(int pageSize, int page);

        // ESG operations
        Task<ESGMetric> CreateESGMetricAsync(ESGMetric metric);
        Task<List<ESGMetric>> GetESGMetricsAsync(DateTime fromDate, DateTime toDate);
    }

    public class MaintenanceRepository : IMaintenanceRepository
    {
        private readonly MaintenanceDbContext _context;

        public MaintenanceRepository(MaintenanceDbContext context)
        {
            _context = context;
        }

        public async Task<WorkOrder> CreateWorkOrderAsync(WorkOrder workOrder)
        {
            _context.WorkOrders.Add(workOrder);
            await _context.SaveChangesAsync();
            return workOrder;
        }

        public async Task<WorkOrder> UpdateWorkOrderAsync(WorkOrder workOrder)
        {
            _context.WorkOrders.Update(workOrder);
            await _context.SaveChangesAsync();
            return workOrder;
        }

        public async Task<List<WorkOrder>> GetWorkOrdersAsync()
        {
            return await _context.WorkOrders
                .Include(wo => wo.Asset)
                .Include(wo => wo.Tasks)
                .Include(wo => wo.RequiredParts)
                .ToListAsync();
        }

        public async Task<WorkOrder?> GetWorkOrderByIdAsync(Guid id)
        {
            return await _context.WorkOrders
                .Include(wo => wo.Asset)
                .Include(wo => wo.Tasks)
                .Include(wo => wo.RequiredParts)
                .FirstOrDefaultAsync(wo => wo.Id == id);
        }

        public async Task<List<WorkOrder>> GetQueuedWorkOrdersAsync()
        {
            return await _context.WorkOrders
                .Where(wo => wo.Status == "Queued")
                .ToListAsync();
        }

        public async Task<Asset> CreateAssetAsync(Asset asset)
        {
            _context.Assets.Add(asset);
            await _context.SaveChangesAsync();
            return asset;
        }

        public async Task<Asset> UpdateAssetAsync(Asset asset)
        {
            _context.Assets.Update(asset);
            await _context.SaveChangesAsync();
            return asset;
        }

        public async Task<List<Asset>> GetAssetsAsync()
        {
            return await _context.Assets
                .Include(a => a.MaintenanceHistory)
                .Include(a => a.SensorReadings)
                .ToListAsync();
        }

        public async Task<Asset?> GetAssetByIdAsync(Guid id)
        {
            return await _context.Assets
                .Include(a => a.MaintenanceHistory)
                .Include(a => a.SensorReadings)
                .FirstOrDefaultAsync(a => a.Id == id);
        }

        public async Task<List<SensorReading>> GetAssetSensorReadingsAsync(Guid assetId)
        {
            return await _context.SensorReadings
                .Where(sr => sr.AssetId == assetId)
                .OrderByDescending(sr => sr.Timestamp)
                .Take(1000)
                .ToListAsync();
        }

        public async Task CreateAgentInteractionLogAsync(AgentInteractionLog log)
        {
            _context.AgentInteractionLogs.Add(log);
            await _context.SaveChangesAsync();
        }

        public async Task CreateAuditLogAsync(AuditLog log)
        {
            _context.AuditLogs.Add(log);
            await _context.SaveChangesAsync();
        }

        public async Task<List<AuditLog>> GetAuditLogsAsync(int pageSize, int page)
        {
            return await _context.AuditLogs
                .OrderByDescending(al => al.Timestamp)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();
        }

        public async Task<ESGMetric> CreateESGMetricAsync(ESGMetric metric)
        {
            _context.ESGMetrics.Add(metric);
            await _context.SaveChangesAsync();
            return metric;
        }

        public async Task<List<ESGMetric>> GetESGMetricsAsync(DateTime fromDate, DateTime toDate)
        {
            return await _context.ESGMetrics
                .Where(em => em.ReportingDate >= fromDate && em.ReportingDate <= toDate)
                .OrderByDescending(em => em.ReportingDate)
                .ToListAsync();
        }
    }

    public class MaintenanceDbContext : DbContext
    {
        public MaintenanceDbContext(DbContextOptions<MaintenanceDbContext> options) : base(options) { }

        public DbSet<Asset> Assets { get; set; }
        public DbSet<WorkOrder> WorkOrders { get; set; }
        public DbSet<WorkOrderTask> WorkOrderTasks { get; set; }
        public DbSet<MaintenanceHistory> MaintenanceHistories { get; set; }
        public DbSet<SparePart> SpareParts { get; set; }
        public DbSet<SensorReading> SensorReadings { get; set; }
        public DbSet<AgentInteractionLog> AgentInteractionLogs { get; set; }
        public DbSet<AuditLog> AuditLogs { get; set; }
        public DbSet<ESGMetric> ESGMetrics { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Configure relationships
            modelBuilder.Entity<WorkOrder>()
                .HasOne(wo => wo.Asset)
                .WithMany()
                .HasForeignKey(wo => wo.AssetId);

            modelBuilder.Entity<WorkOrderTask>()
                .HasOne<WorkOrder>()
                .WithMany(wo => wo.Tasks)
                .HasForeignKey(wot => wot.WorkOrderId);

            modelBuilder.Entity<SensorReading>()
                .HasOne<Asset>()
                .WithMany(a => a.SensorReadings)
                .HasForeignKey(sr => sr.AssetId);

            modelBuilder.Entity<MaintenanceHistory>()
                .HasOne<Asset>()
                .WithMany(a => a.MaintenanceHistory)
                .HasForeignKey(mh => mh.AssetId);

            // Configure indexes for performance
            modelBuilder.Entity<WorkOrder>()
                .HasIndex(wo => wo.Status);

            modelBuilder.Entity<Asset>()
                .HasIndex(a => a.Status);

            modelBuilder.Entity<SensorReading>()
                .HasIndex(sr => new { sr.AssetId, sr.Timestamp });

            modelBuilder.Entity<AuditLog>()
                .HasIndex(al => al.Timestamp);

            // Configure JSON columns
            modelBuilder.Entity<Asset>()
                .Property(a => a.Specifications)
                .HasConversion(
                    v => System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                    v => System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(v, (System.Text.Json.JsonSerializerOptions?)null) ?? new Dictionary<string, object>()
                );

            modelBuilder.Entity<SensorReading>()
                .Property(sr => sr.Metadata)
                .HasConversion(
                    v => System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                    v => System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(v, (System.Text.Json.JsonSerializerOptions?)null) ?? new Dictionary<string, object>()
                );
        }
    }
}