import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import 'reflect-metadata'
import { AppModule } from './app.module'

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // 先设置静态文件服务
  app.useStaticAssets(join(__dirname, 'public'))

  // 再设置API前缀，这样不会影响静态文件的访问
  app.setGlobalPrefix('api')

  const port = process.env.PORT || 3000
  await app.listen(port)
  logger.log(`Application is running on: http://localhost:${port}`)
}

bootstrap()
