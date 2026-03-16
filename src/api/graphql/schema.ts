/**
 * GraphQL schema definition.
 * Complements the REST API for clients that prefer graph-style queries.
 */

import { gql } from 'apollo-server-express';

export const typeDefs = gql`
  scalar JSON
  scalar DateTime

  enum JobStatus {
    PENDING
    QUEUED
    RUNNING
    COMPLETED
    FAILED
    RETRYING
    CANCELLED
    TIMED_OUT
    SKIPPED
  }

  enum JobPriority {
    CRITICAL
    HIGH
    MEDIUM
    LOW
    BACKGROUND
  }

  enum JobType {
    HTTP_REQUEST
    SHELL_COMMAND
    DATA_PIPELINE
    EMAIL_NOTIFICATION
    REPORT_GENERATION
    FILE_PROCESSING
    DATABASE_CLEANUP
    WEBHOOK
    CUSTOM
  }

  type RetryConfig {
    maxRetries: Int!
    retryDelay: Int!
    retryBackoff: String!
    retryOn: [String!]!
  }

  type JobDependency {
    jobId: ID!
    requireStatus: [JobStatus!]!
  }

  type Job {
    id: ID!
    name: String!
    description: String
    type: JobType!
    payload: JSON!
    status: JobStatus!
    priority: JobPriority!
    scheduledAt: DateTime
    cronExpression: String
    timezone: String!
    nextRunAt: DateTime
    lastRunAt: DateTime
    workerId: ID
    startedAt: DateTime
    completedAt: DateTime
    timeoutMs: Int!
    retryConfig: RetryConfig!
    retryCount: Int!
    maxRetries: Int!
    dependencies: [JobDependency!]!
    result: JSON
    errorMessage: String
    tags: [String!]!
    createdAt: DateTime!
    updatedAt: DateTime!
    executionHistory: [ExecutionLog!]!
  }

  type ExecutionLog {
    id: ID!
    jobId: ID!
    workerId: ID!
    attemptNumber: Int!
    status: String!
    startedAt: DateTime!
    completedAt: DateTime
    durationMs: Int
    stdout: String
    stderr: String
    exitCode: Int
    errorMessage: String
    createdAt: DateTime!
  }

  type WorkerNode {
    id: ID!
    hostname: String!
    ipAddress: String!
    pid: Int!
    status: String!
    currentJobCount: Int!
    maxConcurrency: Int!
    lastHeartbeatAt: DateTime!
    registeredAt: DateTime!
  }

  type PaginatedJobs {
    data: [Job!]!
    total: Int!
    page: Int!
    limit: Int!
    totalPages: Int!
  }

  type JobStats {
    total: Int!
    byStatus: JSON!
    byPriority: JSON!
    avgDurationMs: Float!
  }

  type QueueHealth {
    mainQueue: JSON!
    dlqCount: Int!
    isHealthy: Boolean!
  }

  input CreateJobInput {
    name: String!
    description: String
    type: JobType!
    payload: JSON!
    priority: JobPriority
    scheduledAt: DateTime
    cronExpression: String
    timezone: String
    timeoutMs: Int
    tags: [String!]
    metadata: JSON
  }

  type Query {
    job(id: ID!): Job
    jobs(
      status: JobStatus
      priority: JobPriority
      page: Int
      limit: Int
      search: String
    ): PaginatedJobs!
    jobStats: JobStats!
    workers: [WorkerNode!]!
    queueHealth: QueueHealth!
  }

  type Mutation {
    createJob(input: CreateJobInput!): Job!
    cancelJob(id: ID!): Job!
    retryJob(id: ID!): Job!
  }
`;
