/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Barrel for the "main-area" Abstract screens. The implementation was split into per-screen modules so two
// parallel work lanes (Home + Templates vs Knowledge + Agents) never collide in one file: the shared surface
// (page/head/script scaffolding, the top bar, escape/format/sheet helpers, the `renderScreenHtml` dispatcher
// and every screen-state type) lives in `screenRenderShell.ts`; each screen lives in its own
// `screenRender<Name>.ts`. This file re-exports the public API so existing importers keep working unchanged.

export * from './screenRenderShell.js';
