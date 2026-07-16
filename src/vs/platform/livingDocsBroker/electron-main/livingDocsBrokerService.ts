/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from '../../../base/common/path.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { getResolvedShellEnv } from '../../shell/node/shellEnv.js';

/**
 * The host/port the Living Documents model broker (`scripts/lwd-model-broker.js`) binds. Kept in sync with
 * the script's own `HOST`/`PORT` defaults and the renderer's `livingDocs.modelProxyUrl` default. Localhost
 * only: the broker owns the model credential and must never be reachable off the machine.
 */
const BROKER_HOST = '127.0.0.1';
const BROKER_PORT = 8090;

/** How long a single `/healthz` probe may take before it counts as "not up". Localhost, so this is generous. */
const HEALTHZ_TIMEOUT_MS = 1500;

/** Backoff for restart-on-crash: first retry after 1s, doubling to a 30s cap so a broken broker never spins hot. */
const RESTART_BACKOFF_MIN_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 30_000;

/**
 * Supervises the Living Documents model broker child process from the Electron main process (issue #169).
 *
 * The broker (`scripts/lwd-model-broker.js`) is a localhost Node HTTP server that holds the model credential
 * and serves every model-backed feature (chat, the included model, "Sign in with ChatGPT", `/healthz`). Before
 * this, nothing started it, so every model feature died with ERR_CONNECTION_REFUSED unless the user ran a shell
 * script by hand - a hard blocker for the non-technical target user.
 *
 * The main process is the right owner: it outlives every window, already owns the app-shutdown signal, can spawn
 * a Node child without the renderer sandbox, and knows `appRoot` (the repo root in dev, where `scripts/` lives).
 *
 * Lifecycle:
 *  - On `start()`, first probe `/healthz`. If a broker is already healthy on the port (e.g. a developer ran the
 *    script by hand, or a second window's main process got there first) we ADOPT it and never spawn - so there
 *    is only ever one broker on 8090.
 *  - Otherwise spawn `node scripts/lwd-model-broker.js` with `cwd = appRoot`, inheriting the resolved login-shell
 *    environment so the broker sees the vars it reads (LWD_PROXY_PORT, LWD_BACKEND, OPENROUTER_API_KEY[_FILE],
 *    LWD_DAILY_BUDGET_USD, ...).
 *  - On the child exiting unexpectedly, restart with capped exponential backoff. A clean shutdown (we asked it to
 *    stop) does not restart.
 *  - On app shutdown, SIGTERM the child so it never orphans.
 *
 * The renderer already polls `/healthz` directly for status, so this service does not need an IPC surface: its
 * only job is to make sure a broker is actually listening. All state changes are logged, never silent.
 */
export class LivingDocsBrokerService extends Disposable {

	private _child: ChildProcess | undefined;
	private _restartTimer: ReturnType<typeof setTimeout> | undefined;
	private _restartDelayMs = RESTART_BACKOFF_MIN_MS;
	/** True once we deliberately tear the broker down, so an exit does not trigger a restart. */
	private _stopped = false;
	private _started = false;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEnvironmentMainService private readonly _environmentMainService: IEnvironmentMainService,
		@ILifecycleMainService private readonly _lifecycleMainService: ILifecycleMainService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Kill the child on the graceful app-shutdown signal so no broker is left orphaned after a normal quit.
		this._register(this._lifecycleMainService.onWillShutdown(() => this._stop()));
		this._register(toDisposable(() => this._stop()));

		// Safety net for a plain process exit where the lifecycle `onWillShutdown` did not run: synchronously
		// SIGTERM the child so it never orphans. `exit` handlers must be synchronous - `child.kill` is - and we
		// deliberately do NOT hijack SIGTERM/SIGINT here to avoid interfering with Electron's own quit handling.
		const onExit = () => { const c = this._child; this._child = undefined; if (c) { try { c.kill('SIGTERM'); } catch { /* already gone */ } } };
		process.once('exit', onExit);
		this._register(toDisposable(() => process.removeListener('exit', onExit)));
	}

	/**
	 * Ensure a broker is listening on the port: adopt an already-healthy one, or spawn a supervised child.
	 * Safe to call more than once (e.g. once per window's main-process init) - it is a no-op after the first.
	 */
	async start(): Promise<void> {
		if (this._started) {
			return;
		}
		this._started = true;

		const scriptPath = this._brokerScriptPath();
		if (!scriptPath) {
			this._logService.info('[livingDocsBroker] broker script not found under appRoot; skipping supervision (packaged build without scripts, or non-dev layout)');
			return;
		}

		if (await this._isHealthy()) {
			this._logService.info(`[livingDocsBroker] an existing broker is already healthy on ${BROKER_HOST}:${BROKER_PORT}; adopting it (not spawning)`);
			return;
		}

		await this._spawn(scriptPath);
	}

	/** Absolute path to the broker script, or undefined if it is not present (e.g. a packaged build). */
	private _brokerScriptPath(): string | undefined {
		const candidate = join(this._environmentMainService.appRoot, 'scripts', 'lwd-model-broker.js');
		try {
			return existsSync(candidate) ? candidate : undefined;
		} catch {
			return undefined;
		}
	}

	private async _spawn(scriptPath: string): Promise<void> {
		if (this._stopped) {
			return;
		}

		const env = await this._resolveEnv();
		this._logService.info(`[livingDocsBroker] spawning broker: node ${scriptPath} (cwd ${this._environmentMainService.appRoot})`);

		let child: ChildProcess;
		try {
			child = spawn(process.execPath, [scriptPath], {
				cwd: this._environmentMainService.appRoot,
				env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (err) {
			this._logService.error('[livingDocsBroker] failed to spawn broker', err);
			this._scheduleRestart(scriptPath);
			return;
		}

		this._child = child;

		// Surface the broker's own logging into the app log so a startup/config problem is never silent.
		child.stdout?.on('data', (chunk: Buffer) => this._logService.info(`[livingDocsBroker] ${String(chunk).trimEnd()}`));
		child.stderr?.on('data', (chunk: Buffer) => this._logService.warn(`[livingDocsBroker] ${String(chunk).trimEnd()}`));

		child.on('exit', (code, signal) => {
			if (this._child !== child) {
				return; // superseded by a newer child; ignore this stale exit
			}
			this._child = undefined;
			if (this._stopped) {
				this._logService.info('[livingDocsBroker] broker exited during shutdown');
				return;
			}
			this._logService.warn(`[livingDocsBroker] broker exited unexpectedly (code ${code}, signal ${signal}); scheduling restart`);
			this._scheduleRestart(scriptPath);
		});

		// A healthy startup resets the backoff so the NEXT crash again starts from the short delay.
		this._confirmHealthyThenResetBackoff();
	}

	private _scheduleRestart(scriptPath: string): void {
		if (this._stopped || this._restartTimer) {
			return;
		}
		const delay = this._restartDelayMs;
		this._logService.info(`[livingDocsBroker] restarting broker in ${delay}ms`);
		this._restartTimer = setTimeout(() => {
			this._restartTimer = undefined;
			void this._spawn(scriptPath);
		}, delay);
		this._restartDelayMs = Math.min(this._restartDelayMs * 2, RESTART_BACKOFF_MAX_MS);
	}

	/** Poll a few times for a fresh spawn to answer /healthz, then reset the backoff so a stable broker forgets past crashes. */
	private _confirmHealthyThenResetBackoff(): void {
		let attempts = 0;
		const tick = async () => {
			if (this._stopped || !this._child) {
				return;
			}
			if (await this._isHealthy()) {
				this._restartDelayMs = RESTART_BACKOFF_MIN_MS;
				this._logService.info(`[livingDocsBroker] broker healthy on ${BROKER_HOST}:${BROKER_PORT}`);
				return;
			}
			if (++attempts < 20) {
				setTimeout(() => void tick(), 500);
			}
		};
		setTimeout(() => void tick(), 500);
	}

	private _stop(): void {
		this._stopped = true;
		if (this._restartTimer) {
			clearTimeout(this._restartTimer);
			this._restartTimer = undefined;
		}
		const child = this._child;
		this._child = undefined;
		if (child) {
			this._logService.info('[livingDocsBroker] stopping broker');
			try {
				child.kill('SIGTERM');
			} catch (err) {
				this._logService.warn('[livingDocsBroker] failed to signal broker on stop', err);
			}
		}
	}

	private async _resolveEnv(): Promise<typeof process.env> {
		try {
			// Resolve the login-shell environment so the broker sees vars the user set in their profile
			// (OPENROUTER_API_KEY / OPENROUTER_API_KEY_FILE / LWD_BACKEND / LWD_DAILY_BUDGET_USD / ...).
			const shellEnv = await getResolvedShellEnv(this._configurationService, this._logService, this._environmentMainService.args, process.env);
			return { ...process.env, ...shellEnv };
		} catch (err) {
			this._logService.warn('[livingDocsBroker] could not resolve shell environment; spawning with the app environment only', err);
			return { ...process.env };
		}
	}

	/** GET /healthz with a short timeout. Resolves true only on a 2xx response, false on any error/timeout. */
	private async _isHealthy(): Promise<boolean> {
		// `http` is dynamically imported (repo rule: node builtins are slow to load, so they must not be a static
		// runtime import). This is off the hot path - it runs only when probing the broker.
		const http: typeof import('http') = await import('http');
		return new Promise<boolean>(resolve => {
			const req = http.get({ host: BROKER_HOST, port: BROKER_PORT, path: '/healthz', timeout: HEALTHZ_TIMEOUT_MS }, res => {
				const ok = !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
				res.resume(); // drain so the socket can close
				resolve(ok);
			});
			req.on('timeout', () => { req.destroy(); resolve(false); });
			req.on('error', () => resolve(false));
		});
	}
}
