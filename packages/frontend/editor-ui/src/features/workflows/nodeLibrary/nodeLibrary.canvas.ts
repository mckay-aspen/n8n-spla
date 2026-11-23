// SPLA WHITE-LABEL: sends the nodes of the central node library to the canvas.
// This file has no upstream counterpart.
import type { WorkflowDataUpdate } from '@n8n/rest-api-client/api/workflows';

import { nodeViewEventBus } from '@/app/event-bus';
import { canvasEventBus } from '@/features/workflows/canvas/canvas.eventBus';

/**
 * Adds the nodes to the open workflow and then shows the full workflow.
 *
 * The canvas import gives the copies new ids. It also gives a copy a new name
 * where a name is in use. The import fits the view before the canvas has
 * measured the new nodes, thus a copy can be out of view. This function fits
 * the view again after the measurement.
 */
export function addLibraryNodesToCanvas(data: WorkflowDataUpdate): void {
	// The import selects the new nodes when it is complete. It changes the ids in `data`,
	// thus the ids of the selection identify this import.
	canvasEventBus.once('nodes:select', ({ ids }) => {
		const selected = new Set(ids);
		const isThisImport = (data.nodes ?? []).every((node) => selected.has(node.id));
		if (!isThisImport) return;

		// The canvas measures new nodes during the next frame. The fit must come after that frame.
		requestAnimationFrame(() => requestAnimationFrame(() => canvasEventBus.emit('fitView')));
	});

	nodeViewEventBus.emit('importWorkflowData', { data, trackEvents: false });
}
