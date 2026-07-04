import { fileURLToPath } from 'node:url'
import {
  discoverExtensions,
  fakeDriver,
  formatFrameworkEvent,
  readProjectSignals,
  runFramework,
  FAKE_INTENT,
  type Driver,
  type FrameworkEvent,
} from '@gemstack/framework'

/**
 * The end-to-end proof for The Framework's extension SPI (#190).
 *
 * This package is a *real project* that depends on the third-party
 * `framework-hello` capability package. Nothing about `framework-hello` is
 * hardcoded in the framework core; installing it is the only thing that turns it
 * on. The demo runs the two halves of the seam for real:
 *
 *  1. **Discovery** - it reads this project's `package.json` signals and
 *     resolves + imports the installed `framework-*` packages *from disk* (the
 *     real dynamic-import path, not a fake loader), yielding a live
 *     `FrameworkExtension`.
 *  2. **Composition** - it drives the whole bootstrap flow with the built-in
 *     fake driver (offline, no model), framed with the discovered extension, and
 *     captures the system prompt to prove the extension's persona and skill
 *     actually reached the agent.
 *
 * The only thing faked is the coding agent's turns; discovery and composition are
 * the real product code a live run uses.
 */

/** The one prompt the demo builds from. */
export const DEMO_INTENT = FAKE_INTENT

/** This package's own directory - the real project that depends on `framework-hello`. */
export const projectDir = fileURLToPath(new URL('..', import.meta.url))

/** What {@link runDemo} reports after discovery + an offline run. */
export interface DiscoveryOutcome {
  /** The `framework-*` packages discovered and loaded from this project. */
  discovered: string[]
  /** Any `framework-*` package that matched the convention but failed to load. */
  failed: string[]
  /** The detected framework (undefined here -> the flagship Vike preset by fallback). */
  framework: string | undefined
  /** Proof the discovered persona reached the agent frame (its sentinel is present). */
  greeterComposed: boolean
  /** Proof the discovered extension's own skill (llms.txt pointer) reached the frame. */
  helloSkillComposed: boolean
  /** The framework's own narration line naming the active extension. */
  framingLog: string | undefined
  /** Whether the offline flow reached production-grade. */
  productionGrade: boolean
}

/** A fake driver that also records the system framing it is started with. */
function recordingFakeDriver(): { driver: Driver; system: () => string } {
  const fd = fakeDriver()
  let captured = ''
  const driver: Driver = {
    name: 'fake',
    start: opts => {
      captured = opts.system ?? ''
      return fd.start(opts)
    },
  }
  return { driver, system: () => captured }
}

/** Run the whole proof and stream one narration line per phase to `onLine`. */
export async function runDemo(onLine: (line: string) => void): Promise<DiscoveryOutcome> {
  // 1. Real discovery: resolve + import this project's installed framework-* packages.
  const signals = readProjectSignals(projectDir)
  const { extensions, failed } = await discoverExtensions(projectDir, signals)
  onLine(`discovered ${extensions.length} framework-* extension(s): ${extensions.map(e => e.name).join(', ') || '(none)'}`)
  for (const f of failed) onLine(`  skipped ${f.package}: ${f.error}`)

  // 2. Real composition: drive the offline flow framed with the discovered
  //    extension, capturing the system prompt to prove it composed.
  const { driver, system } = recordingFakeDriver()
  let framingLog: string | undefined
  const run = await runFramework({
    intent: DEMO_INTENT,
    driver,
    cwd: projectDir,
    signals,
    extensions,
    onEvent: (event: FrameworkEvent) => {
      if (event.kind === 'log' && /framing with/.test(event.message)) framingLog = event.message
      onLine(formatFrameworkEvent(event))
    },
  })

  const framed = system()
  return {
    discovered: extensions.map(e => e.name),
    failed: failed.map(f => f.package),
    framework: run.detection.framework,
    greeterComposed: /FRAMEWORK-HELLO-SENTINEL/.test(framed),
    helloSkillComposed: /framework-hello\/llms\.txt/.test(framed),
    framingLog,
    productionGrade: run.result.productionGrade,
  }
}
