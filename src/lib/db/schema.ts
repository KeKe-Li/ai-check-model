import { pgTable, uuid, text, integer, timestamp, numeric, jsonb, index } from 'drizzle-orm/pg-core'

/**
 * 验证任务表 - 记录每次 API 端点验证任务
 */
export const verificationJobs = pgTable(
  'verification_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    endpointUrl: text('endpoint_url').notNull(),
    endpointDomain: text('endpoint_domain').notNull(),
    modelClaimed: text('model_claimed').notNull(),
    modelDetected: text('model_detected'),
    totalScore: integer('total_score'),
    confidenceLevel: text('confidence_level'),
    status: text('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    statusIdx: index('verification_jobs_status_idx').on(table.status),
    endpointDomainIdx: index('verification_jobs_endpoint_domain_idx').on(table.endpointDomain),
    createdAtIdx: index('verification_jobs_created_at_idx').on(table.createdAt),
  })
)

/**
 * 检测结果表 - 记录每个检测器的执行结果
 */
export const detectionResults = pgTable(
  'detection_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => verificationJobs.id, { onDelete: 'cascade' }),
    detectorName: text('detector_name').notNull(),
    score: integer('score').notNull(),
    maxScore: integer('max_score').notNull(),
    status: text('status').notNull(),
    details: jsonb('details'),
    findings: jsonb('findings'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    jobIdIdx: index('detection_results_job_id_idx').on(table.jobId),
  })
)

/**
 * 排行榜表 - 聚合各端点的历史验证数据
 */
export const leaderboardEntries = pgTable(
  'leaderboard_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    endpointDomain: text('endpoint_domain').notNull().unique(),
    displayName: text('display_name'),
    totalChecks: integer('total_checks').notNull().default(0),
    avgScore: numeric('avg_score', { precision: 5, scale: 2 }),
    lastCheckedAt: timestamp('last_checked_at'),
    modelsVerified: jsonb('models_verified'),
    overallStatus: text('overall_status'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    endpointDomainIdx: index('leaderboard_entries_endpoint_domain_idx').on(table.endpointDomain),
    avgScoreIdx: index('leaderboard_entries_avg_score_idx').on(table.avgScore),
  })
)

export type VerificationJob = typeof verificationJobs.$inferSelect
export type NewVerificationJob = typeof verificationJobs.$inferInsert
export type DetectionResult = typeof detectionResults.$inferSelect
export type NewDetectionResult = typeof detectionResults.$inferInsert
export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect
export type NewLeaderboardEntry = typeof leaderboardEntries.$inferInsert
