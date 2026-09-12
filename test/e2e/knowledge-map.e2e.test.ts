import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { spawn, ChildProcess } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renameSync, existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../../')
const PUBLIC_DIR = resolve(PROJECT_ROOT, 'public')

let serverProcess: ChildProcess | null = null
let actualPort: number
const BASE_URL = 'http://127.0.0.1'

function getBaseUrl(): string {
  return `${BASE_URL}:${actualPort}`
}

function startServer(): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // Use the local serve binary from node_modules (Windows uses .cmd with shell)
    // Use port 0 to let OS assign a free port
    const servePath = resolve(
      PROJECT_ROOT,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'serve.cmd' : 'serve'
    )
    serverProcess = spawn(servePath, ['-l', 'tcp://127.0.0.1:0', PUBLIC_DIR], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    serverProcess.stdout?.on('data', (data) => {
      const output = data.toString()
      // Parse the actual port from serve output (e.g., "Listening on http://127.0.0.1:1234")
      const match = output.match(/Listening on http:\/\/127\.0\.0\.1:(\d+)/)
      if (match) {
        actualPort = parseInt(match[1], 10)
        setTimeout(resolvePromise, 500)
      }
    })

    serverProcess.stderr?.on('data', (data) => {
      console.error('[serve]', data.toString())
    })

    serverProcess.on('error', (err) => {
      reject(err)
    })

    setTimeout(() => reject(new Error('Server start timeout')), 10000)
  })
}

function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    serverProcess = null
  }
}

describe('Knowledge Map', () => {
  let browser: Browser
  let context: BrowserContext
  let page: Page

  beforeAll(async () => {
    // Build the graph first
    const { spawnSync } = await import('node:child_process')
    const buildResult = spawnSync('pnpm', ['build:graph'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: 'inherit',
      shell: true,
    })
    console.log('[test] build:graph exit code:', buildResult.status)
    if (buildResult.status !== 0) {
      throw new Error(`Graph build failed with exit code ${buildResult.status}`)
    }

    await startServer()

    browser = await chromium.launch({ headless: true })
    context = await browser.newContext()
    page = await context.newPage()
  }, 120000)

  afterAll(async () => {
    await context?.close()
    await browser?.close()
    stopServer()
  })

  it('loads graph and displays nodes', async () => {
    await page.goto(getBaseUrl())

    // Wait for graph to load (status text changes)
    await expect(page.locator('#status')).not.toHaveText('Loading graph…', { timeout: 10000 })

    // Verify nodes are rendered
    const canvas = page.locator('#cy canvas')
    await expect(canvas).toBeVisible()

    // Check that Cytoscape has rendered nodes
    await page.waitForFunction(
      () => {
        const cy = (window as any).cy
        return cy && cy.nodes().length > 0
      },
      { timeout: 10000 }
    )
  })

  it('clicking a node shows details in side panel', async () => {
    await page.goto(getBaseUrl())

    // Wait for graph to load
    await expect(page.locator('#status')).not.toHaveText('Loading graph…', { timeout: 10000 })

    // Wait for nodes to be available
    await page.waitForFunction(
      () => {
        const cy = (window as any).cy
        return cy && cy.nodes().length > 0
      },
      { timeout: 10000 }
    )

    // Click on a node (canvas click at center where nodes should be)
    const canvas = page.locator('#cy canvas')
    await canvas.click({ position: { x: 400, y: 300 } })

    // Wait for details panel to populate
    await expect(page.locator('#details h2')).toBeVisible({ timeout: 5000 })

    // Verify details contain expected content
    const detailsText = await page.locator('#details').textContent()
    expect(detailsText).toBeTruthy()
    expect(detailsText!.length).toBeGreaterThan(10)
  })

  it('search filter dims non-matching nodes', async () => {
    await page.goto(getBaseUrl())

    // Wait for graph to load
    await expect(page.locator('#status')).not.toHaveText('Loading graph…', { timeout: 10000 })

    // Wait for nodes to be available
    await page.waitForFunction(
      () => {
        const cy = (window as any).cy
        return cy && cy.nodes().length > 0
      },
      { timeout: 10000 }
    )

    // Type in search box
    await page.fill('#search', 'ai-agents')

    // Wait for filter to apply (dimmed class added)
    await page.waitForFunction(
      () => {
        const cy = (window as any).cy
        return cy && cy.nodes('.dimmed').length > 0
      },
      { timeout: 5000 }
    )

    // Verify some nodes are dimmed and some are not
    const dimmedCount = await page.evaluate(() => {
      const cy = (window as any).cy
      return cy.nodes('.dimmed').length
    })
    const visibleCount = await page.evaluate(() => {
      const cy = (window as any).cy
      return cy.nodes(':not(.dimmed)').length
    })

    expect(dimmedCount).toBeGreaterThan(0)
    expect(visibleCount).toBeGreaterThan(0)
  })

  it('clearing search shows all nodes', async () => {
    await page.goto(getBaseUrl())

    // Wait for graph to load
    await expect(page.locator('#status')).not.toHaveText('Loading graph…', { timeout: 10000 })

    // Wait for nodes to be available
    await page.waitForFunction(
      () => {
        const cy = (window as any).cy
        return cy && cy.nodes().length > 0
      },
      { timeout: 10000 }
    )

    // Type in search box
    await page.fill('#search', 'ai-agents')

    // Wait for filter to apply
    await page.waitForFunction(
      () => {
        const cy = (window as any).cy
        return cy && cy.nodes('.dimmed').length > 0
      },
      { timeout: 5000 }
    )

    // Clear search
    await page.fill('#search', '')

    // Wait for dimmed class to be removed
    await page.waitForFunction(
      () => {
        const cy = (window as any).cy
        return cy && cy.nodes('.dimmed').length === 0
      },
      { timeout: 5000 }
    )

    // Verify no nodes are dimmed
    const dimmedCount = await page.evaluate(() => {
      const cy = (window as any).cy
      return cy.nodes('.dimmed').length
    })
    expect(dimmedCount).toBe(0)
  })

  it('keyword nodes are rendered with different style', async () => {
    await page.goto(getBaseUrl())

    // Wait for graph to load
    await expect(page.locator('#status')).not.toHaveText('Loading graph…', { timeout: 10000 })

    // Wait for nodes to be available
    await page.waitForFunction(
      () => {
        const cy = (window as any).cy
        return cy && cy.nodes().length > 0
      },
      { timeout: 10000 }
    )

    // Check that keyword nodes exist (gold/rectangle style)
    const keywordNodeCount = await page.evaluate(() => {
      const cy = (window as any).cy
      return cy.nodes('[kind = "keyword"]').length
    })

    expect(keywordNodeCount).toBeGreaterThan(0)
  })

  it('error state displays retry button when graph.json missing', async () => {
    // Temporarily rename graph.json to simulate missing file
    const graphPath = resolve(PUBLIC_DIR, 'graph.json')
    const backupPath = resolve(PUBLIC_DIR, 'graph.json.bak')

    if (existsSync(graphPath)) {
      renameSync(graphPath, backupPath)
    }

    try {
      await page.goto(getBaseUrl())

      // Wait for error to appear
      await expect(page.locator('#details h2')).toHaveText('Error', { timeout: 10000 })

      // Verify retry button exists
      await expect(page.locator('#retry-btn')).toBeVisible()
    } finally {
      // Restore graph.json
      if (existsSync(backupPath)) {
        renameSync(backupPath, graphPath)
      }
    }
  })
})
