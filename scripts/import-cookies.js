#!/usr/bin/env node
// One-time importer: converts a browser-extension cookie export (e.g. Cookie-Editor,
// EditThisCookie) into the Playwright storageState format the scraper loads.
//
// Usage: node scripts/import-cookies.js [input=cookie.json] [output=.storage/auth.json]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const inputPath = resolve(process.argv[2] ?? 'cookie.json')
const outputPath = resolve(process.argv[3] ?? '.storage/auth.json')

if (!existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`)
  process.exit(1)
}

const raw = readFileSync(inputPath, 'utf-8')
const firstBracket = raw.indexOf('[')
if (firstBracket === -1) {
  console.error('Input does not contain a JSON array.')
  process.exit(1)
}

let extensionCookies
try {
  extensionCookies = JSON.parse(raw.slice(firstBracket))
} catch (err) {
  console.error(`Failed to parse cookie JSON: ${err.message}`)
  process.exit(1)
}

if (!Array.isArray(extensionCookies)) {
  console.error('Parsed cookie data is not an array.')
  process.exit(1)
}

const sameSiteMap = {
  unspecified: 'Lax',
  no_restriction: 'None',
  lax: 'Lax',
  strict: 'Strict',
  none: 'None',
}

const playwrightCookies = extensionCookies.map((c) => {
  const domain = c.hostOnly ? c.domain.replace(/^\./, '') : c.domain
  const expires =
    c.session || typeof c.expirationDate !== 'number' ? -1 : Math.floor(c.expirationDate)
  const sameSiteKey = typeof c.sameSite === 'string' ? c.sameSite.toLowerCase() : 'unspecified'
  return {
    name: c.name,
    value: c.value,
    domain,
    path: c.path ?? '/',
    expires,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: sameSiteMap[sameSiteKey] ?? 'Lax',
  }
})

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify({ cookies: playwrightCookies, origins: [] }, null, 2))

const nowSeconds = Date.now() / 1000
const session = playwrightCookies.find((c) => c.name === 'pplx.session-id')
const sessionStatus = !session
  ? 'no pplx.session-id found (login will be required)'
  : session.expires === -1
    ? 'session cookie (expires when browser closes)'
    : session.expires < nowSeconds
      ? `EXPIRED ${new Date(session.expires * 1000).toISOString()}`
      : `valid until ${new Date(session.expires * 1000).toISOString()}`

console.log(`Imported ${playwrightCookies.length} cookies -> ${outputPath}`)
console.log(`pplx.session-id: ${sessionStatus}`)
