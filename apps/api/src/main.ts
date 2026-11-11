import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { applyHttpSetup } from './common/http-setup';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  applyHttpSetup(app, env);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: env.DASHBOARD_ORIGIN, credentials: true });
  app.useBodyParser('json', { limit: '256kb' });

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('EAIP API')
      .setDescription('Enterprise Ads Intelligence Platform — REST API v1')
      .setVersion('0.1.0')
      .addCookieAuth('eaip_session')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Organization-Id' }, 'organization')
      .build();
    SwaggerModule.setup('api/v1/docs', app, SwaggerModule.createDocument(app, config));
  }

  await app.listen(env.API_PORT, '0.0.0.0');
}

void bootstrap();
