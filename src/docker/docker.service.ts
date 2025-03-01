import { Injectable, Logger } from '@nestjs/common'
import Docker from 'dockerode'
import { platform } from 'os'

class DockerServiceError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
    this.name = 'DockerServiceError'
  }
}

@Injectable()
export class DockerService {
  private readonly docker: Docker
  private readonly logger = new Logger(DockerService.name)
  private readonly MAX_IMAGE_SIZE = 10 * 1024 * 1024 * 1024 // 10GB
  private readonly OPERATION_TIMEOUT = 30 * 60 * 1000 // 30分钟
  private readonly DOCKER_HUB_API = 'https://hub.docker.com/v2'

  constructor() {
    if (platform() === 'win32') {
      this.docker = new Docker({
        socketPath: '//./pipe/docker_engine'
      })
    } else {
      this.docker = new Docker({ socketPath: '/var/run/docker.sock' })
    }
  }

  async pullImage(imageName: string): Promise<void> {
    this.logger.log(`Pulling image: ${imageName}`)

    const [name, tag] = imageName.split(':')
    const isOfficialImage = !name.includes('/')
    const fullImageName = isOfficialImage ? `library/${name}:${tag || 'latest'}` : imageName

    return new Promise((resolve, reject) => {
      this.docker.pull(fullImageName, {}, (err, stream) => {
        if (err) {
          this.logger.error(`Error pulling image ${fullImageName}: ${err.message}`)
          return reject(err)
        }

        if (!stream) {
          this.logger.error(`No stream returned for image ${fullImageName}`)
          return reject(new DockerServiceError('No stream returned from Docker', 'NO_STREAM_RETURNED'))
        }

        this.docker.modem.followProgress(stream, (err, output) => {
          if (err) {
            this.logger.error(`Error processing pull stream: ${err.message}`)
            return reject(err)
          }

          this.logger.log(`Successfully pulled image: ${fullImageName}`)
          resolve()
        })
      })
    })
  }

  async imageExists(imageName: string): Promise<boolean> {
    try {
      const [name, tag] = imageName.split(':')
      const isOfficialImage = !name.includes('/')
      const fullImageName = isOfficialImage ? `library/${name}:${tag || 'latest'}` : imageName

      const images = await this.docker.listImages({
        filters: { reference: [imageName, fullImageName] }
      })
      return images.length > 0
    } catch (error) {
      this.logger.error(`Error checking image existence: ${error.message}`)
      return false
    }
  }

  getImage(imageName: string): Docker.Image {
    return this.docker.getImage(imageName)
  }

  async getImageStream(imageName: string, autoPull: boolean = true): Promise<NodeJS.ReadableStream> {
    try {
      const [name, tag] = imageName.split(':')
      const isOfficialImage = !name.includes('/')
      const fullImageName = isOfficialImage ? `library/${name}:${tag || 'latest'}` : imageName

      this.logger.log(`Checking image existence: ${fullImageName}`)
      const exists = await this.imageExists(imageName)

      if (!exists && autoPull) {
        this.logger.log(`Image not found locally, pulling: ${fullImageName}`)
        await this.pullImage(imageName)
      }

      try {
        const image = this.docker.getImage(fullImageName)
        const imageInfo = await image.inspect()

        if (imageInfo.Size > this.MAX_IMAGE_SIZE) {
          throw new DockerServiceError('Image size exceeds limit', 'SIZE_LIMIT_EXCEEDED')
        }

        return await image.get()
      } catch (error) {
        if (error.statusCode === 404) {
          const image = this.docker.getImage(imageName)
          const imageInfo = await image.inspect()

          if (imageInfo.Size > this.MAX_IMAGE_SIZE) {
            throw new DockerServiceError('Image size exceeds limit', 'SIZE_LIMIT_EXCEEDED')
          }

          return await image.get()
        }
        throw error
      }
    } catch (error) {
      this.logger.error(`Failed to get image stream for ${imageName}: ${error.message}`)
      throw error instanceof DockerServiceError ? error : new DockerServiceError(error.message)
    }
  }

  async getDockerHubImageInfo(imageName: string): Promise<{ size: number; description?: string }> {
    try {
      const [name, tag = 'latest'] = imageName.split(':')
      const isOfficialImage = !name.includes('/')
      const repository = isOfficialImage ? `library/${name}` : name

      // 1. 首先获取 token
      const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`
      const tokenResponse = await fetch(tokenUrl)
      if (!tokenResponse.ok) {
        throw new Error(`获取认证 token 失败: ${tokenResponse.statusText}`)
      }
      const tokenData = await tokenResponse.json()
      const token = tokenData.token

      // 2. 使用 token 获取 manifest
      const registryUrl = `https://registry.hub.docker.com/v2/${repository}/manifests/${tag}`
      const response = await fetch(registryUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
        }
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`镜像 ${imageName} 在 Docker Hub 上不存在`)
        }
        throw new Error(`获取镜像信息失败: ${response.statusText}`)
      }

      const manifest = await response.json()

      // 3. 计算所有层的总大小
      let totalSize = 0
      if (manifest.layers) {
        totalSize = manifest.layers.reduce((sum: number, layer: any) => {
          return sum + (layer.size || 0)
        }, 0)
      }

      // 4. 获取镜像描述信息（使用 Docker Hub API）
      let description = ''
      try {
        const hubResponse = await fetch(
          `${this.DOCKER_HUB_API}/repositories/${repository}/tags/${tag}`,
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
        if (hubResponse.ok) {
          const hubData = await hubResponse.json()
          description = hubData.description || ''
        }
      } catch (error) {
        this.logger.warn(`获取镜像描述信息失败: ${error.message}`)
      }

      return {
        size: totalSize,
        description
      }
    } catch (error) {
      this.logger.error(`获取 Docker Hub 镜像信息失败: ${error.message}`)
      // 如果获取失败，尝试获取本地镜像大小
      try {
        const exists = await this.imageExists(imageName)
        if (exists) {
          const image = this.getImage(imageName)
          const imageInfo = await image.inspect()
          return { size: imageInfo.Size }
        }
      } catch (localError) {
        this.logger.error(`获取本地镜像大小失败: ${localError.message}`)
      }

      return { size: 0 }
    }
  }
}
