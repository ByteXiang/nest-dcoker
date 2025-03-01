import { Logger } from '@nestjs/common'

// Docker image name utilities
export class DockerImageUtils {
  /**
   * Parse and normalize Docker image name
   * @param imageName Original image name
   * @returns Normalized image information
   */
  static parseImageName(imageName: string) {
    const [name, tag = 'latest'] = imageName.split(':')
    const isOfficialImage = !name.includes('/')
    const fullImageName = isOfficialImage ? `library/${name}:${tag}` : imageName
    const normalizedName = isOfficialImage ? `library/${name}` : name

    return {
      name,
      tag,
      isOfficialImage,
      fullImageName,
      normalizedName,
      fileName: `${imageName.replace(/[\/\:]/g, '_')}.tar`
    }
  }
}

// Error handling utilities
export class DockerError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode: number = 500
  ) {
    super(message)
    this.name = 'DockerError'
  }

  static fromError(error: any): DockerError {
    if (error instanceof DockerError) {
      return error
    }

    // Handle Docker pull errors
    if (error.message?.includes('pull access denied')) {
      if (error.message.includes('may require \'docker login\'')) {
        return new DockerError(
          '需要登录 Docker Hub 才能拉取此镜像',
          'AUTH_REQUIRED',
          401
        )
      }
      return new DockerError(
        '没有权限拉取此镜像，可能是私有镜像或镜像不存在',
        'ACCESS_DENIED',
        403
      )
    }

    if (error.message?.includes('repository does not exist')) {
      return new DockerError(
        '镜像不存在，请检查镜像名称是否正确',
        'IMAGE_NOT_FOUND',
        404
      )
    }

    // Handle common Docker errors
    if (error.statusCode === 404) {
      return new DockerError(
        '镜像不存在，请检查镜像名称是否正确',
        'IMAGE_NOT_FOUND',
        404
      )
    }

    if (error.code === 'ECONNREFUSED') {
      return new DockerError(
        'Docker 服务未启动，请确保 Docker Desktop 正在运行',
        'DOCKER_NOT_RUNNING',
        500
      )
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
      return new DockerError(
        '连接超时，请检查网络连接或重试',
        'CONNECTION_TIMEOUT',
        408
      )
    }

    if (error.code === 'ENOTFOUND') {
      return new DockerError(
        '无法连接到 Docker Hub，请检查网络连接',
        'NETWORK_ERROR',
        503
      )
    }

    return new DockerError(
      error.message || '未知错误',
      'UNKNOWN_ERROR',
      500
    )
  }
}

// Logging utilities
export class DockerLogger extends Logger {
  constructor(context: string) {
    super(context)
  }

  logOperation(operation: string, imageName: string, details?: any) {
    const message = `${operation}: ${imageName}`
    if (details) {
      this.log({ message, ...details })
    } else {
      this.log(message)
    }
  }

  logError(operation: string, error: any, imageName?: string) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const message = imageName
      ? `${operation} failed for ${imageName}: ${errorMessage}`
      : `${operation} failed: ${errorMessage}`
    this.error(message)
  }
}
