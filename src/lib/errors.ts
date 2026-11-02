import { Protocol } from '../types'

export class GopherError extends Error {
  constructor(public reason: "timeout" | "refused" | "parse" | "toobig", message: string) {
    super(message)
    this.name = 'GopherError'
  }
}

export class NNTPError extends Error {
  constructor(public code: number, message: string) {
    super(message)
    this.name = 'NNTPError'
  }
}

export class FingerError extends Error {
  constructor(public reason: "timeout" | "refused" | "toobig", message: string) {
    super(message)
    this.name = 'FingerError'
  }
}

export class ForbiddenHostError extends Error {
  constructor(host: string, port: number) {
    super(`Host ${host}:${port} is not in the allow-list`)
    this.name = 'ForbiddenHostError'
  }
}
