import { Injectable } from '@nestjs/common'
import Docker from 'dockerode'
import { platform } from 'os'
import { DockerError, DockerImageUtils, DockerLogger } from './utils'

interface ImageInfo {
  exists: boolean
  stream?: NodeJS.ReadableStream
}

@Injectable()
export class DockerService {
  private readonly docker: Docker
  private readonly logger: DockerLogger

  constructor() {
    this.logger = new DockerLogger(DockerService.name)

    if (platform() === 'win32') {
      this.docker = new Docker({
        socketPath: '//./pipe/docker_engine'
      })
    } else {
      this.docker = new Docker({ socketPath: '/var/run/docker.sock' })
    }
  }

  private async pullImage(imageName: string): Promise<void> {
    const { fullImageName } = DockerImageUtils.parseImageName(imageName)
    this.logger.logOperation('Pulling image', fullImageName)

    return new Promise((resolve, reject) => {
      this.docker.pull(fullImageName, {}, (err, stream) => {
        if (err) {
          this.logger.logError('Pull image', err, fullImageName)
          return reject(DockerError.fromError(err))
        }

        if (!stream) {
          const error = new DockerError('No stream returned from Docker', 'NO_STREAM_RETURNED')
          this.logger.logError('Pull image', error, fullImageName)
          return reject(error)
        }

        this.docker.modem.followProgress(stream, (err, output) => {
          if (err) {
            this.logger.logError('Process pull stream', err, fullImageName)
            return reject(DockerError.fromError(err))
          }

          this.logger.logOperation('Successfully pulled image', fullImageName)
          resolve()
        })
      })
    })
  }

  private async getLocalImageInfo(imageName: string): Promise<ImageInfo> {
    try {
      const { fullImageName } = DockerImageUtils.parseImageName(imageName)
      const images = await this.docker.listImages({
        filters: { reference: [imageName, fullImageName] }
      })

      if (images.length === 0) {
        return { exists: false }
      }

      const image = this.docker.getImage(fullImageName)
      const stream = await image.get()

      return {
        exists: true,
        stream
      }
    } catch (error) {
      if (error instanceof DockerError) {
        throw error
      }
      this.logger.logError('Get local image info', error, imageName)
      return { exists: false }
    }
  }

  async getImageInfo(imageName: string, autoPull: boolean = false): Promise<ImageInfo> {
    this.logger.logOperation('Getting image info', imageName)

    // 1. 获取本地镜像信息
    let imageInfo = await this.getLocalImageInfo(imageName)

    // 2. 如果本地不存在且需要拉取
    if (!imageInfo.exists && autoPull) {
      try {
        await this.pullImage(imageName)
        imageInfo = await this.getLocalImageInfo(imageName)
      } catch (error) {
        this.logger.logError('Pull image failed', error, imageName)
        throw new DockerError('Failed to pull image from Docker Hub', 'PULL_FAILED')
      }
    }

    return imageInfo
  }
}

