import { Body, Controller, HttpException, HttpStatus, Post, Res } from '@nestjs/common'
import { Response } from 'express'
import { DockerService } from './docker.service'
import { DockerError, DockerImageUtils, DockerLogger } from './utils'

@Controller('docker')
export class DockerController {
  private readonly logger: DockerLogger

  constructor(private readonly dockerService: DockerService) {
    this.logger = new DockerLogger(DockerController.name)
  }

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
      const { fileName } = DockerImageUtils.parseImageName(imageName)
      this.logger.logOperation('Exporting image', imageName)

      const imageInfo = await this.dockerService.getImageInfo(imageName, autoPull)

      if (!imageInfo.exists && !autoPull) {
        throw new DockerError(`Image ${imageName} does not exist locally`, 'IMAGE_NOT_FOUND', HttpStatus.BAD_REQUEST)
      }

      if (!imageInfo.stream) {
        throw new DockerError('Failed to get image stream', 'STREAM_NOT_AVAILABLE')
      }

      response.set({
        'Content-Type': 'application/x-tar',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked'
      })

      imageInfo.stream.pipe(response)
    } catch (error) {
      this.logger.logError('Export image', error, imageName)
      const dockerError = DockerError.fromError(error)
      throw new HttpException(dockerError.message, dockerError.statusCode)
    }
  }

  @Post('check')
  async checkImage(@Body('imageName') imageName: string) {
    if (!imageName) {
      throw new HttpException('Image name is required', HttpStatus.BAD_REQUEST)
    }

    try {
      this.logger.logOperation('Checking image', imageName)
      const imageInfo = await this.dockerService.getImageInfo(imageName)

      return {
        exists: imageInfo.exists
      }
    } catch (error) {
      this.logger.logError('Check image', error, imageName)
      const dockerError = DockerError.fromError(error)
      throw new HttpException(dockerError.message, dockerError.statusCode)
    }
  }
}
