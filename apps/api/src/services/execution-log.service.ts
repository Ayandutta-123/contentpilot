import { ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';

interface LogInput {
  tenantId: string;
  contentId?: string;
  workflowStep: string;
  engine?: ContentEngine;
  status?: ExecutionStatus;
  message?: string;
  errorDetails?: Prisma.InputJsonValue;
  durationMs?: number;
}

class ExecutionLogService {
  async log(input: LogInput): Promise<string> {
    const record = await prisma.executionLog.create({
      data: {
        tenantId: input.tenantId,
        contentId: input.contentId,
        workflowStep: input.workflowStep,
        engine: input.engine,
        status: input.status ?? ExecutionStatus.RUNNING,
        message: input.message,
        errorDetails: input.errorDetails ?? undefined,
        durationMs: input.durationMs,
      },
    });
    return record.id;
  }

  async query(
    tenantId: string,
    filters: {
      status?: ExecutionStatus;
      engine?: ContentEngine;
      from?: Date;
      to?: Date;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where = {
      tenantId,
      ...(filters.status && { status: filters.status }),
      ...(filters.engine && { engine: filters.engine }),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from && { gte: filters.from }),
              ...(filters.to && { lte: filters.to }),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.executionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { content: { select: { headline: true, engine: true } } },
      }),
      prisma.executionLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async clear(tenantId: string, filters: { status?: ExecutionStatus } = {}) {
    const result = await prisma.executionLog.deleteMany({
      where: {
        tenantId,
        ...(filters.status ? { status: filters.status } : {}),
      },
    });
    return { deletedCount: result.count };
  }
}

export const executionLogService = new ExecutionLogService();
