import { Module } from '@nestjs/common';
import { CoreModule, REDIS } from './common/core.module';
import { loggerModule } from './common/logger';
import { postbackQueueProvider } from './common/queues';
import { ConversionService } from './postbacks/conversion.service';
import { ClickService } from './tracking/click.service';
import { TrackerController } from './tracking/tracker.controller';
import { EventsService } from './tracking/events.service';
import { SdkController } from './tracking/sdk.controller';

/**
 * Proses "tracker": endpoint publik klik & postback masuk.
 * Dipisahkan dari API dashboard agar tetap berjalan saat dashboard/API/worker bermasalah (read.md 17.10).
 */
@Module({
  imports: [loggerModule('tracker'), CoreModule],
  controllers: [TrackerController, SdkController],
  providers: [ClickService, ConversionService, EventsService, postbackQueueProvider(REDIS)],
})
export class TrackerModule {}
