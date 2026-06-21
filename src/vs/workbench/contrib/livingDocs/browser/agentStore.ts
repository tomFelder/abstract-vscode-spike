/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IAgentDef } from '../common/livingDocsModel.js';

// The read/write seam for the agent registry. The spike persists it as a workspace `agents.json`;
// production will platform-store it. Same pattern as the lock store - nothing else knows where it
// lives, so the swap is trivial.
export interface IAgentStore {
	read(): Promise<IAgentDef[] | undefined>;
	write(agents: readonly IAgentDef[]): Promise<void>;
}

export class WorkspaceAgentStore implements IAgentStore {
	constructor(private readonly _files: IFileService, private readonly _folder: URI) { }

	private get _uri(): URI { return joinPath(this._folder, 'agents.json'); }

	async read(): Promise<IAgentDef[] | undefined> {
		try {
			const text = (await this._files.readFile(this._uri)).value.toString();
			const parsed = JSON.parse(text);
			return Array.isArray(parsed) ? parsed as IAgentDef[] : undefined;
		} catch {
			// No registry yet (or unreadable): the caller seeds the default automation set.
			return undefined;
		}
	}

	async write(agents: readonly IAgentDef[]): Promise<void> {
		await this._files.writeFile(this._uri, VSBuffer.fromString(JSON.stringify(agents, null, 2) + '\n'));
	}
}
