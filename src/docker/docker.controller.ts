import { Body, Controller, HttpException, HttpStatus, Logger, Post, Res } from '@nestjs/common'
import { Response } from 'express'
import { DockerService } from './docker.service'

@Controller('docker')
export class DockerController {
  private readonly logger = new Logger(DockerController.name)

  constructor(private readonly dockerService: DockerService) { }

  @Post('export')
  async exportImage(
    @Body('imageName') imageName: string,
    @Body('autoPull') autoPull: boolean = true,
    @Res() response: Response
  ) {
    if (!imageName) {
      throw new HttpException('Image name is required', HttpStatus.BAD_REQUEST)
    }

    try {
      // 处理官方镜像名称
      const [name, tag] = imageName.split(':')
      const isOfficialImage = !name.includes('/')
      const fullImageName = isOfficialImage ? `library/${name}:${tag || 'latest'}` : imageName

      const exists = await this.dockerService.imageExists(imageName)
      if (!exists && !autoPull) {
        throw new HttpException(`Image ${imageName} does not exist locally`, HttpStatus.BAD_REQUEST)
      }

      const stream = await this.dockerService.getImageStream(imageName, autoPull)

      // 获取镜像信息用于设置响应头
      const image = this.dockerService.getImage(fullImageName)
      const imageInfo = await image.inspect()
      const imageSize = imageInfo.Size

      const fileName = `${imageName.replace(/[\/\:]/g, '_')}.tar`
      response.set({
        'Content-Type': 'application/x-tar',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': imageSize.toString(),
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked'
      })

      stream.pipe(response)
    } catch (error) {
      this.logger.error(`Failed to export image: ${error.message}`)
      throw new HttpException(`Failed to export image: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }

  @Post('size')
  async getImageSize(@Body('imageName') imageName: string) {
    if (!imageName) {
      throw new HttpException('Image name is required', HttpStatus.BAD_REQUEST)
    }

    try {
      // 首先尝试从 Docker Hub 获取镜像信息
      const hubInfo = await this.dockerService.getDockerHubImageInfo(imageName)

      // 如果是本地镜像，获取本地大小
      const exists = await this.dockerService.imageExists(imageName)
      if (exists) {
        const [name, tag] = imageName.split(':')
        const isOfficialImage = !name.includes('/')
        const fullImageName = isOfficialImage ? `library/${name}:${tag || 'latest'}` : imageName

        const image = this.dockerService.getImage(fullImageName)
        const imageInfo = await image.inspect()

        return {
          size: imageInfo.Size,
          localExists: true,
          hubSize: hubInfo.size,
          description: hubInfo.description
        }
      }

      return {
        size: hubInfo.size,
        localExists: false,
        description: hubInfo.description
      }
    } catch (error) {
      this.logger.error(`Failed to get image size: ${error.message}`)
      throw new HttpException(`Failed to get image size: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
