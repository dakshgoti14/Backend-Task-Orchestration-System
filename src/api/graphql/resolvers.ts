import { jobService } from '../../services/JobService';
import { workerService } from '../../services/WorkerService';
import { queueManager } from '../../queue/QueueManager';
import { executionRepository } from '../../db/repositories/ExecutionRepository';
import { Job } from '../../models/Job';

interface GQLContext {
  user?: { userId: string; organizationId: string };
}

export const resolvers = {
  Query: {
    job: async (_: unknown, { id }: { id: string }, ctx: GQLContext) => {
      if (!ctx.user) throw new Error('Unauthenticated');
      return jobService.getJob(id, ctx.user.organizationId);
    },

    jobs: async (
      _: unknown,
      args: { status?: string; priority?: string; page?: number; limit?: number; search?: string },
      ctx: GQLContext,
    ) => {
      if (!ctx.user) throw new Error('Unauthenticated');
      return jobService.listJobs({
        ...args,
        organizationId: ctx.user.organizationId,
        page: args.page ?? 1,
        limit: args.limit ?? 20,
      } as Parameters<typeof jobService.listJobs>[0]);
    },

    jobStats: async (_: unknown, __: unknown, ctx: GQLContext) => {
      if (!ctx.user) throw new Error('Unauthenticated');
      return jobService.getJobStats(ctx.user.organizationId);
    },

    workers: async () => workerService.listWorkers(),

    queueHealth: async () => queueManager.getHealth(),
  },

  Mutation: {
    createJob: async (_: unknown, { input }: { input: Parameters<typeof jobService.createJob>[0] }, ctx: GQLContext) => {
      if (!ctx.user) throw new Error('Unauthenticated');
      return jobService.createJob({
        ...input,
        organizationId: ctx.user.organizationId,
        createdBy: ctx.user.userId,
      });
    },

    cancelJob: async (_: unknown, { id }: { id: string }, ctx: GQLContext) => {
      if (!ctx.user) throw new Error('Unauthenticated');
      return jobService.cancelJob(id, ctx.user.organizationId);
    },

    retryJob: async (_: unknown, { id }: { id: string }, ctx: GQLContext) => {
      if (!ctx.user) throw new Error('Unauthenticated');
      return jobService.retryJob(id, ctx.user.organizationId);
    },
  },

  Job: {
    executionHistory: async (job: Job) => executionRepository.findByJobId(job.id),
  },
};
