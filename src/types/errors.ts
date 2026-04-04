export class AgoraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'AgoraError';
  }
}

export class AuthError extends AgoraError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends AgoraError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AgoraError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}
