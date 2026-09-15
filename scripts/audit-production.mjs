#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Narrow, expiring exceptions for @huggingface/transformers 3.x.
 *
 * The plugin invokes only text feature-extraction and text-classification
 * pipelines, never sharp's image decoding APIs. Transformers 3.x constrains
 * sharp to ^0.34.x, while the patched libvips/libheif binaries require 0.35.x.
 * Keep these exceptions exact and short-lived so a new advisory, dependency
 * path, or version can never be accepted implicitly.
 */
const APPROVED_RISKS = Object.freeze([
  {
    id: 'GHSA-f88m-g3jw-g9cj',
    module: 'sharp',
    versionPrefix: '0.34.',
    pathFragment: '@huggingface/transformers>sharp',
    reviewDeadline: '2026-10-14T23:59:59.999Z',
  },
  {
    id: 'GHSA-rgj7-g3m4-5g8c',
    module: 'sharp',
    versionPrefix: '0.34.',
    pathFragment: '@huggingface/transformers>sharp',
    reviewDeadline: '2026-10-14T23:59:59.999Z',
  },
])

/** Evaluate pnpm's audit JSON while allowing only exact, time-bounded risks. */
export function evaluateAudit(report, now = new Date()) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    return { ok: false, approved: [], blocking: ['audit output is not a JSON object'] }
  }
  if (report.advisories === undefined || report.advisories === null || typeof report.advisories !== 'object') {
    return { ok: false, approved: [], blocking: ['audit output has no advisories map; pnpm output shape may have changed'] }
  }

  const approved = []
  const blocking = []
  for (const advisory of Object.values(report.advisories)) {
    if (advisory === null || typeof advisory !== 'object') {
      blocking.push('audit contains a malformed advisory entry')
      continue
    }
    const severity = String(advisory.severity ?? '').toLowerCase()
    if (severity !== 'high' && severity !== 'critical') continue
    const id = String(advisory.github_advisory_id ?? advisory.id ?? 'unknown')
    const findings = Array.isArray(advisory.findings) ? advisory.findings : []
    const policy = APPROVED_RISKS.find(candidate => candidate.id === id)
    const expectedFinding = policy !== undefined && findings.length > 0 && findings.every(finding => {
      const paths = Array.isArray(finding?.paths) ? finding.paths : []
      const version = String(finding?.version ?? '')
      return paths.length > 0
        && paths.every(path => typeof path === 'string' && path.includes(policy.pathFragment))
        && version.startsWith(policy.versionPrefix)
        && finding.dev === false
    })
    const isApproved = policy !== undefined
      && advisory.module_name === policy.module
      && severity === 'high'
      && expectedFinding
    if (!isApproved) {
      blocking.push(`${id}: ${severity} ${String(advisory.title ?? advisory.module_name ?? 'dependency advisory')}`)
      continue
    }
    if (now.getTime() > Date.parse(policy.reviewDeadline)) {
      blocking.push(`${id}: approved exception expired on ${policy.reviewDeadline.slice(0, 10)}`)
      continue
    }
    approved.push(`${id}: accepted until ${policy.reviewDeadline.slice(0, 10)} (${policy.pathFragment})`)
  }
  return { ok: blocking.length === 0, approved, blocking }
}

function selfTest() {
  const accepted = {
    advisories: {
      1: {
        id: 1,
        github_advisory_id: 'GHSA-f88m-g3jw-g9cj',
        module_name: 'sharp',
        severity: 'high',
        title: 'fixture',
        findings: [{ version: '0.34.1', paths: ['.>@huggingface/transformers>sharp'], dev: false }],
      },
      2: {
        id: 2,
        github_advisory_id: 'GHSA-rgj7-g3m4-5g8c',
        module_name: 'sharp',
        severity: 'high',
        title: 'fixture',
        findings: [{ version: '0.34.1', paths: ['.>@huggingface/transformers>sharp'], dev: false }],
      },
    },
  }
  assert.equal(evaluateAudit(accepted, new Date('2026-09-14T00:00:00Z')).ok, true)
  assert.equal(evaluateAudit(accepted, new Date('2026-10-15T00:00:00Z')).ok, false)
  assert.equal(evaluateAudit({
    advisories: { 3: { github_advisory_id: 'GHSA-rgj7-g3m4-5g8c', module_name: 'sharp', severity: 'high', findings: [{ version: '0.35.4', paths: ['.>@huggingface/transformers>sharp'], dev: false }] } },
  }).ok, false)
  assert.equal(evaluateAudit({
    advisories: { 4: { github_advisory_id: 'GHSA-rgj7-g3m4-5g8c', module_name: 'sharp', severity: 'high', findings: [{ version: '0.34.1', paths: ['.>another-package>sharp'], dev: false }] } },
  }).ok, false)
  assert.equal(evaluateAudit({ advisories: {} }).ok, true)
  assert.equal(evaluateAudit({
    advisories: { 2: { github_advisory_id: 'GHSA-unexpected', module_name: 'other', severity: 'critical', findings: [] } },
  }).ok, false)
  assert.equal(evaluateAudit({ vulnerabilities: {} }).ok, false)
  console.log('production audit policy self-test passed')
}

function pnpmInvocation(args) {
  if (process.platform !== 'win32') return ['pnpm', args, false]
  const lookup = spawnSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8' })
  for (const shim of lookup.stdout?.split(/\r?\n/).filter(Boolean) ?? []) {
    try {
      const content = readFileSync(shim, 'utf8')
      const candidates = [...content.matchAll(/"([^"]+\.(?:mjs|cjs|js))"/gi)].map(match => match[1])
      const raw = candidates.find(candidate => candidate.toLowerCase().includes('pnpm'))
      if (raw === undefined) continue
      const script = raw.replace(/%~dp0[\\/]?/gi, `${dirname(shim)}\\`)
      if (existsSync(script)) return [process.execPath, [script, ...args], false]
    } catch {
      // Try the next pnpm shim before falling back to cmd.exe.
    }
  }
  return ['pnpm.cmd', args, true]
}

function runAudit() {
  const [command, args, shell] = pnpmInvocation(['audit', '--prod', '--json'])
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell,
  })
  if (result.error !== undefined) throw result.error
  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    const detail = result.stderr.trim() || result.stdout.trim() || `pnpm exited ${result.status}`
    throw new Error(`unable to parse pnpm audit JSON: ${detail}`)
  }
  const decision = evaluateAudit(report)
  for (const line of decision.approved) console.warn(`[accepted production risk] ${line}`)
  if (!decision.ok) {
    for (const line of decision.blocking) console.error(`[blocking production risk] ${line}`)
    process.exitCode = 1
    return
  }
  const counts = report.metadata?.vulnerabilities ?? {}
  console.log(`production audit policy passed (critical=${counts.critical ?? 0}, high=${counts.high ?? 0}, accepted=${decision.approved.length})`)
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  try {
    if (process.argv.includes('--self-test')) selfTest()
    else runAudit()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
