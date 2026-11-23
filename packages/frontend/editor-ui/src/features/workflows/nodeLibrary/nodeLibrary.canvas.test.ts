// SPLA WHITE-LABEL: tests of the central node library. This file has no upstream counterpart.
import type { WorkflowDataUpdate } from '@n8n/rest-api-client/api/workflows';

import { createTestNode } from '@/__tests__/mocks';
import { nodeViewEventBus } from '@/app/event-bus';
import { canvasEventBus } from '@/features/workflows/canvas/canvas.eventBus';

import { addLibraryNodesToCanvas } from './nodeLibrary.canvas';

describe('addLibraryNodesToCanvas', () => {
	const onImport = vi.fn();
	const onFitView = vi.fn();
	let frames: FrameRequestCallback[] = [];

	const runNextFrame = () => {
		const callbacks = frames;
		frames = [];
		callbacks.forEach((callback) => callback(0));
	};

	const createData = (): WorkflowDataUpdate => ({
		nodes: [
			createTestNode({ id: 'source-1', name: 'Fetch' }),
			createTestNode({ id: 'source-2', name: 'Normalize' }),
		],
		connections: {},
	});

	// The canvas import gives each copy a new id. It writes the id to the node of the payload.
	const completeImport = (data: WorkflowDataUpdate) => {
		const ids = (data.nodes ?? []).map((node, index) => {
			node.id = `copy-${index + 1}`;
			return node.id;
		});
		canvasEventBus.emit('nodes:select', { ids });
	};

	beforeEach(() => {
		frames = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
			frames.push(callback),
		);
		nodeViewEventBus.on('importWorkflowData', onImport);
		canvasEventBus.on('fitView', onFitView);
	});

	afterEach(() => {
		// A selection removes a listener that a test left on the bus.
		canvasEventBus.emit('nodes:select', { ids: [] });
		nodeViewEventBus.off('importWorkflowData', onImport);
		canvasEventBus.off('fitView', onFitView);
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it('should send the nodes to the canvas import', () => {
		const data = createData();

		addLibraryNodesToCanvas(data);

		expect(onImport).toHaveBeenCalledTimes(1);
		expect(onImport).toHaveBeenCalledWith({ data, trackEvents: false });
	});

	it('should not fit the view before the import selects the new nodes', () => {
		addLibraryNodesToCanvas(createData());
		runNextFrame();
		runNextFrame();

		expect(onFitView).not.toHaveBeenCalled();
	});

	it('should fit the view two frames after the import selects the new nodes', () => {
		const data = createData();
		addLibraryNodesToCanvas(data);

		completeImport(data);
		expect(onFitView).not.toHaveBeenCalled();

		// The canvas measures the new nodes during the first frame.
		runNextFrame();
		expect(onFitView).not.toHaveBeenCalled();

		runNextFrame();
		expect(onFitView).toHaveBeenCalledTimes(1);
	});

	it('should not fit the view when the selection is not the selection of this import', () => {
		const data = createData();
		addLibraryNodesToCanvas(data);

		canvasEventBus.emit('nodes:select', { ids: ['another-node'] });
		runNextFrame();
		runNextFrame();

		expect(onFitView).not.toHaveBeenCalled();
	});

	it('should fit the view one time only for each import', () => {
		const data = createData();
		addLibraryNodesToCanvas(data);

		completeImport(data);
		completeImport(data);
		runNextFrame();
		runNextFrame();

		expect(onFitView).toHaveBeenCalledTimes(1);
	});
});
