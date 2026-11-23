// SPLA WHITE-LABEL: the central node library. This file has no upstream counterpart.
import type { FrontendModuleDescription } from '@n8n/frontend-module-sdk';

import { NODE_LIBRARY_MODALS } from './modals';

/**
 * The library has no route and no backend module. It reads the workflow list endpoint.
 * The descriptor exists so that the shell registers the dialog.
 */
export const NodeLibraryModule: FrontendModuleDescription = {
	id: 'node-library',
	name: 'Node library',
	description: 'Pull configured nodes from other workflows into the open workflow',
	icon: 'blocks',
	modals: NODE_LIBRARY_MODALS,
};
