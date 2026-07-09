/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IAgentDef, IAgentRun } from '../common/livingDocsModel.js';

// The persisted registry payload (D32-A, decision 150): the agent definitions plus the capped run log,
// stored together in `agents.json` (no new file). The on-disk shape is the object below; a legacy bare
// array (the pre-plan-32 format) still reads as `{ agents, runs: [] }` so existing workspaces upgrade
// silently.
export interface IAgentRegistry {
	readonly agents: IAgentDef[];
	readonly runs: IAgentRun[];
}

// The read/write seam for the agent registry. The spike persists it as a workspace `agents.json`;
// production will platform-store it. Same pattern as the lock store - nothing else knows where it
// lives, so the swap is trivial.
export interface IAgentStore {
	read(): Promise<IAgentRegistry | undefined>;
	write(registry: IAgentRegistry): Promise<void>;
}

export class WorkspaceAgentStore implements IAgentStore {
	constructor(private readonly _files: IFileService, private readonly _folder: URI) { }

	private get _uri(): URI { return joinPath(this._folder, 'agents.json'); }

	async read(): Promise<IAgentRegistry | undefined> {
		try {
			const text = (await this._files.readFile(this._uri)).value.toString();
			const parsed = JSON.parse(text);
			// Legacy bare array (pre-plan-32): the agent list with no run history yet.
			if (Array.isArray(parsed)) { return { agents: parsed as IAgentDef[], runs: [] }; }
			if (parsed && Array.isArray(parsed.agents)) {
				return { agents: parsed.agents as IAgentDef[], runs: Array.isArray(parsed.runs) ? parsed.runs as IAgentRun[] : [] };
			}
			return undefined;
		} catch {
			// No registry yet (or unreadable): the caller seeds the default automation set.
			return undefined;
		}
	}

	async write(registry: IAgentRegistry): Promise<void> {
		await this._files.writeFile(this._uri, VSBuffer.fromString(JSON.stringify({ agents: registry.agents, runs: registry.runs }, null, 2) + '\n'));
	}
}
