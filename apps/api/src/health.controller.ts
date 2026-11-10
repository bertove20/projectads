import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type Redis from 'ioredis';
import { Public } from './common/decorators';
import { REDIS } from './common/core.module';
import { PrismaService } from './common/prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check() {
    const checks: Record<string, 'ok' | 'error'> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }
    try {
      checks.redis = (await this.redis.ping()) === 'PONG' ? 'ok' : 'error';
    } catch {
      checks.redis = 'error';
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    if (!ok) throw new ServiceUnavailableException({ code: 'UNHEALTHY', message: JSON.stringify(checks) });
    return { status: 'ok', checks };
  }
}
