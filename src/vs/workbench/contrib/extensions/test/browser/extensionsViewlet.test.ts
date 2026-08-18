/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as nls from '../../../../../nls.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../../common/views.js';
import { IExtensionManagementServerService } from '../../../../services/extensionManagement/common/extensionManagement.js';
import { ExtensionsViewletViewsContribution } from '../../browser/extensionsViewlet.js';
import { VIEWLET_ID } from '../../common/extensions.js';

const ViewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);
const ViewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);

suite('ExtensionsViewletViewsContribution', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());
		instantiationService.stub(IContextKeyService, new MockContextKeyService());
		instantiationService.stub(ILabelService, <ILabelService>{ onDidChangeFormatters: Event.None });
		instantiationService.stub(IExtensionManagementServerService, <IExtensionManagementServerService>{
			localExtensionManagementServer: null,
			remoteExtensionManagementServer: null,
			webExtensionManagementServer: null
		});
	});

	test('views are contributed only while the Extensions view container exists', () => {
		const viewIds = ['workbench.views.extensions.popular', 'extensions.recommendedList'];
		const contributedViewIds = () => viewIds.map(id => ViewsRegistry.getView(id)?.id ?? null);

		// eslint-disable-next-line local/code-no-any-casts
		const container = ViewContainersRegistry.registerViewContainer({ id: VIEWLET_ID, title: nls.localize2('extensions', 'Extensions'), ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		disposables.add(instantiationService.createInstance(ExtensionsViewletViewsContribution));
		const whileContainerExists = contributedViewIds();

		// Embedders deregister the container to remove the Extensions viewlet altogether. The views
		// then have nowhere to go, and contributing them anyway used to register them against an
		// undefined container - which threw out of the views registry on startup.
		ViewsRegistry.deregisterViews(ViewsRegistry.getViews(container), container);
		ViewContainersRegistry.deregisterViewContainer(container);
		disposables.add(instantiationService.createInstance(ExtensionsViewletViewsContribution));
		const whileContainerMissing = contributedViewIds();

		assert.deepStrictEqual({ whileContainerExists, whileContainerMissing }, { whileContainerExists: viewIds, whileContainerMissing: [null, null] });
	});
});
