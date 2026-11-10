import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { applyHttpSetup } from './common/http-setup';
import { loadEnv } from './config/env';
import { TrackerModule } from './tracker.module';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(TrackerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  applyHttpSetup(app, env);
  // Postback masuk bisa berupa form-urlencoded atau JSON; batasi ukurannya.
  app.useBodyParser('json', { limit: '32kb' });
  app.useBodyParser('urlencoded', { limit: '32kb', extended: false });
  // Event JS SDK dikirim sebagai text/plain (fetch keepalive / sendBeacon) agar tidak memicu preflight CORS
  app.useBodyParser('text', { limit: '32kb', type: 'text/plain' });
  await app.listen(env.TRACKER_PORT, '0.0.0.0');
}

void bootstrap();
