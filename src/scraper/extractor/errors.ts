export class ExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractionError'
  }
}

export class NavigationError extends ExtractionError {
  constructor(message: string) {
    super(message)
    this.name = 'NavigationError'
  }
}

export class NoDataError extends ExtractionError {
  constructor(message: string) {
    super(message)
    this.name = 'NoDataError'
  }
}

export class ParsingError extends ExtractionError {
  constructor(message: string) {
    super(message)
    this.name = 'ParsingError'
  }
}

export class AuthError extends ExtractionError {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export class NotFoundError extends ExtractionError {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ServerError extends ExtractionError {
  constructor(message: string) {
    super(message)
    this.name = 'ServerError'
  }
}
