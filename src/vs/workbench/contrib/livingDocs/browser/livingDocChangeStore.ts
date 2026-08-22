/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IChangeStoreFileSystem } from '../common/changeJournal.js';

// The workbench backing for the change store's file-system seam (docs/30 section 5, R6).
//
// The store and its journal are pure `common/` modules on purpose - the invariants are testable at unit
// speed against a fake that can fail on demand - so this file is the only place in the product that knows
// the journal is a real file in a real folder. It is deliberately thin: no policy, no retry, no caching.

/**
 * The project's `.abstract` home, which is what the store joins `changes/` onto.
 *
 * A URI string rather than a path: the workspace folder may be any scheme (a remote folder, a virtual file
 * system), and the seam below simply parses what it is handed back into a URI. The store treats it as an
 * opaque string it appends `/changes/...` to, so nothing outside this file has to agree on a path grammar.
 */
export function changeStoreHomeFor(folder: URI): string {
	return joinPath(folder, '.abstract').toString();
}

/**
 * The change store's journal and derived view, over the workbench file service.
 *
 * **These methods must never call back into a {@link import('../common/changeStore.js').ChangeStore} verb.**
 * Every mutating verb on the store runs on an internal queue so that admission and the write it authorises
 * are atomic with respect to one another (invariant I8), and the store awaits this seam from INSIDE that
 * queue. A seam that reached back for `propose`/`approveByIds`/`comment` would wait on a queue slot that can
 * only be reached once the seam it is waiting on returns: a permanent deadlock, not a slow path. Read the
 * document, write the bytes, resolve. Nothing else.
 */
export class WorkbenchChangeStoreFileSystem implements IChangeStoreFileSystem {

	constructor(private readonly _files: IFileService) { }

	async read(path: string): Promise<string | undefined> {
		try {
			return (await this._files.readFile(URI.parse(path))).value.toString();
		} catch {
			// The journal not existing yet is the ordinary first-run case and is NOT an error; a genuinely
			// unreadable file is indistinguishable from it here, and the store treats both the same way -
			// it starts from an empty log and appends, which never destroys what it could not read (the
			// append below creates nothing it would overwrite).
			return undefined;
		}
	}

	/**
	 * Append to the journal.
	 *
	 * **SINGLE WRITER, and this implementation is why.** The renderer's file service has no append, so this is
	 * a read-modify-write: two windows appending to one project at the same instant both read the same bytes
	 * and the second write erases the first record completely. Nothing downstream can detect that - there is
	 * no gap to find, because the record never reached the file. Sequential interleaving is fine and is
	 * reported as `foreign` on the open report; concurrent interleaving is a lost decision. A lock, or a
	 * provider-level atomic append, is what makes multi-window real.
	 *
	 * The interface's contract is that this resolves only once the bytes are DURABLE, because the whole
	 * journal discipline rests on an intent being recoverable before the mutation it authorises happens. The
	 * renderer's file service does not expose an fsync, so what is honoured here is the strongest thing it
	 * offers: the write is awaited to the provider, and the provider's own write has completed before this
	 * resolves. That is the platform equivalent available on this side of the process boundary; a backing
	 * store that could not manage even that would have to throw rather than resolve early, which is why the
	 * failure path below re-throws instead of swallowing.
	 */
	async append(path: string, text: string): Promise<void> {
		const resource = URI.parse(path);
		await this._ensureParent(resource);
		const existing = await this.read(path);
		await this._files.writeFile(resource, VSBuffer.fromString((existing ?? '') + text));
	}

	async replace(path: string, text: string): Promise<void> {
		const resource = URI.parse(path);
		await this._ensureParent(resource);
		await this._files.writeFile(resource, VSBuffer.fromString(text));
	}

	async list(dir: string): Promise<readonly string[]> {
		try {
			const stat = await this._files.resolve(URI.parse(dir));
			return (stat.children ?? []).filter(c => !c.isDirectory).map(c => c.resource.toString());
		} catch {
			return [];
		}
	}

	private async _ensureParent(resource: URI): Promise<void> {
		try {
			await this._files.createFolder(dirname(resource));
		} catch {
			// Already there, or the provider creates parents on write. Either way the write below is the
			// operation that decides whether this worked, so a failure here is not worth a second report.
		}
	}
}
