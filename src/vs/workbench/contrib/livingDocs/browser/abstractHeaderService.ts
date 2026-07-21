/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { EMPTY_HEADER_CONTENT, IAbstractHeaderContent, IAbstractHeaderService } from '../common/abstractHeader.js';

/**
 * The default header content service (plan 43 section 3.3). Holds the header content the active surface has
 * published and notifies the header view on change. Pure state relay: no DOM, no layout - the
 * AbstractHeaderContribution owns the rendering and reads from here.
 */
export class AbstractHeaderService extends Disposable implements IAbstractHeaderService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _content: IAbstractHeaderContent = EMPTY_HEADER_CONTENT;
	get content(): IAbstractHeaderContent { return this._content; }

	setContent(content: IAbstractHeaderContent): void {
		this._content = content;
		this._onDidChange.fire();
	}
}
