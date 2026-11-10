import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import cookieParser from 'cookie-parser';
import type { Response } from 'express';
import helmet from 'helmet';
import type { Env } from '../config/env';

/** Format error seragam: { error: { code, message, details? } }. Detail internal tidak dibocorkan. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const obj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : { message: body };
      const code = (obj.code as string) ?? HttpStatus[status] ?? 'ERROR';
      const message = Array.isArray(obj.message) ? 'Input tidak valid' : ((obj.message as string) ?? exception.message);
      const details = Array.isArray(obj.message) ? obj.message : obj.missing;
      res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
      return;
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        res.status(409).json({ error: { code: 'CONFLICT', message: 'Data dengan nilai unik yang sama sudah ada' } });
        return;
      }
      if (exception.code === 'P2025') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Data tidak ditemukan' } });
        return;
      }
    }
    this.logger.error(exception instanceof Error ? { err: exception.message, stack: exception.stack } : { err: exception }, 'Unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' } });
  }
}

export function applyHttpSetup(app: INestApplication, env: Env) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', env.TRUST_PROXY_HOPS);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: false }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
