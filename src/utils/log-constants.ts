// why: shared log directory and timestamp constants used by both the main logger
// and the HTTP request/response logger. Centralising removes the S4 duplication
// and ensures both log streams write to the same directory with the same timestamp base.

export const LOGS_DIRECTORY = 'logs'

export const LOG_FILE_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
