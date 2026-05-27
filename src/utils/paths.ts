import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

/**
 * Robustly get the current file path in ESM environments.
 */
export function getFilePath(importMetaUrl: string): string {
  return fileURLToPath(importMetaUrl)
}

/**
 * Robustly get the current directory path in ESM environments (successor to __dirname).
 */
export function getDirPath(importMetaUrl: string): string {
  return dirname(getFilePath(importMetaUrl))
}

/**
 * Robustly join paths starting from the current directory.
 */
export function joinFromDir(importMetaUrl: string, ...paths: string[]): string {
  return join(getDirPath(importMetaUrl), ...paths)
}

/**
 * Robustly resolve paths starting from the current directory.
 */
export function resolveFromDir(importMetaUrl: string, ...paths: string[]): string {
  return resolve(getDirPath(importMetaUrl), ...paths)
}

/**
 * Robustly get the project root directory.
 * Assumes this file is located in src/utils/
 */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Robustly join paths from the project root.
 */
export function joinFromRoot(...paths: string[]): string {
  return join(PROJECT_ROOT, ...paths)
}
