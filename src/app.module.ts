import { Module } from '@nestjs/common'
import { ServeStaticModule } from '@nestjs/serve-static'
import { join } from 'path'
import { DockerModule } from './docker/docker.module'

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/',
    }),
    DockerModule,
  ],
})
export class AppModule {}
