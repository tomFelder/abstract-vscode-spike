/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';

// Desktop-only bridge for the living-document PDF export (issue #130, doc 22 §3). Print-to-PDF runs in the
// Electron main process (Chromium's own print engine), which the browser-layer LivingDocsService cannot reach
// directly - INativeHostService is not registered on the web dev harness. Registering the capability as a
// command HERE (electron-browser, desktop build only) keeps the browser service free of a desktop dependency:
// on desktop it calls this command and gets PDF bytes; on web the command is simply absent and the export
// reports honestly. The command is internal (leading underscore) and takes the self-contained HTML the
// renderer already produces for the HTML export.
CommandsRegistry.registerCommand('_livingDocs.printToPDF', async (accessor, html: string): Promise<VSBuffer | undefined> => {
	if (typeof html !== 'string' || html.length === 0) { return undefined; }
	const nativeHostService = accessor.get(INativeHostService);
	return nativeHostService.printToPDF(html);
});
