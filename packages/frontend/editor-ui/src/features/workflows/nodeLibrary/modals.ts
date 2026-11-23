// SPLA WHITE-LABEL: registers the node library dialog. This file has no upstream counterpart.
import type { ModalDefinition } from '@n8n/frontend-module-sdk';

import { NODE_LIBRARY_MODAL_KEY } from './nodeLibrary.constants';

export const NODE_LIBRARY_MODALS: ModalDefinition[] = [
	{
		key: NODE_LIBRARY_MODAL_KEY,
		component: async () => await import('./components/NodeLibraryModal.vue'),
		initialState: { open: false },
	},
];
