// SPLA WHITE-LABEL: tests of the central node library. This file has no upstream counterpart.
import { createTestingPinia } from '@pinia/testing';
import userEvent from '@testing-library/user-event';
import { waitFor, within } from '@testing-library/vue';
import { NodeConnectionTypes, STICKY_NODE_TYPE } from 'n8n-workflow';
import { computed } from 'vue';

import { createTestNode, createTestWorkflow } from '@/__tests__/mocks';
import { createComponentRenderer } from '@/__tests__/render';
import { mockedStore } from '@/__tests__/utils';
import * as workflowsApi from '@/app/api/workflows';
import { WorkflowIdKey } from '@/app/constants/injectionKeys';
import { useUIStore } from '@/app/stores/ui.store';

import { addLibraryNodesToCanvas } from '../nodeLibrary.canvas';
import { NODE_LIBRARY_MODAL_KEY } from '../nodeLibrary.constants';
import NodeLibraryModal from './NodeLibraryModal.vue';

const { showError, showMessage } = vi.hoisted(() => ({
	showError: vi.fn(),
	showMessage: vi.fn(),
}));

vi.mock('@/app/api/workflows');
vi.mock('../nodeLibrary.canvas', () => ({ addLibraryNodesToCanvas: vi.fn() }));
vi.mock('@n8n/composables/useToast', () => ({
	useToast: () => ({ showError, showMessage }),
}));
vi.mock('vue-router', async (importOriginal) => ({
	...(await importOriginal()),
	useRouter: () => ({
		resolve: ({ params }: { params: { workflowId: string } }) => ({
			href: `/workflow/${params.workflowId}`,
		}),
	}),
}));

const OPEN_WORKFLOW_ID = 'open';
const LIST_FIELDS = ['id', 'name', 'nodes', 'tags'];

const openWorkflow = createTestWorkflow({
	id: OPEN_WORKFLOW_ID,
	name: 'Open workflow',
	nodes: [createTestNode({ name: 'Node of the open workflow' })],
});

const orderIntake = createTestWorkflow({
	id: 'orders',
	name: 'Order intake',
	nodes: [
		createTestNode({ name: 'Order webhook', type: 'n8n-nodes-base.webhook', position: [0, 0] }),
		createTestNode({
			name: 'Create order',
			type: 'n8n-nodes-base.httpRequest',
			position: [200, 0],
		}),
	],
});

// The name puts this workflow last in the response. The tag must put it first in the library.
const sharedBlocks = createTestWorkflow({
	id: 'blocks',
	name: 'Shared blocks',
	tags: [{ id: 'tag-1', name: 'Library' }],
	nodes: [
		createTestNode({
			name: 'Fetch customer',
			type: 'n8n-nodes-base.httpRequest',
			position: [0, 0],
			credentials: { httpHeaderAuth: { id: 'credential-1', name: 'Partner API key' } },
		}),
		createTestNode({ name: 'Is active?', type: 'n8n-nodes-base.if', position: [200, 0] }),
		createTestNode({ name: 'Normalize', position: [400, 0] }),
		createTestNode({ name: 'Note', type: STICKY_NODE_TYPE, position: [0, -200] }),
	],
	connections: {
		'Fetch customer': {
			main: [[{ node: 'Is active?', type: NodeConnectionTypes.Main, index: 0 }]],
		},
		'Is active?': {
			main: [[{ node: 'Normalize', type: NodeConnectionTypes.Main, index: 0 }]],
		},
	},
});

const allWorkflows = [openWorkflow, orderIntake, sharedBlocks];

const getWorkflows = vi.mocked(workflowsApi.getWorkflows);
const getWorkflow = vi.mocked(workflowsApi.getWorkflow);

const renderComponent = createComponentRenderer(NodeLibraryModal, {
	global: {
		stubs: {
			Modal: {
				template: '<div role="dialog"><slot name="content" /><slot name="footer" /></div>',
			},
			NodeIcon: true,
		},
		provide: {
			[WorkflowIdKey as symbol]: computed(() => OPEN_WORKFLOW_ID),
		},
	},
});

/** Renders the dialog and waits for the list of workflows. */
async function renderLoadedLibrary() {
	const rendered = renderComponent({ pinia: createTestingPinia() });
	await rendered.findAllByTestId('node-library-workflow');
	return rendered;
}

describe('NodeLibraryModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getWorkflows.mockResolvedValue({ count: allWorkflows.length, data: allWorkflows });
		getWorkflow.mockResolvedValue(sharedBlocks);
	});

	describe('library list', () => {
		it('should request the workflows that are not archived, with their nodes and tags', async () => {
			await renderLoadedLibrary();

			expect(getWorkflows).toHaveBeenCalledTimes(1);
			expect(getWorkflows).toHaveBeenCalledWith(
				expect.anything(),
				{ isArchived: false },
				{ skip: 0, take: 100, sortBy: 'name:asc' },
				LIST_FIELDS,
			);
		});

		it('should list the other workflows with the standard workflow first', async () => {
			const { getAllByTestId, queryByText } = await renderLoadedLibrary();

			const workflows = getAllByTestId('node-library-workflow');
			expect(workflows).toHaveLength(2);
			expect(workflows[0]).toHaveTextContent('Shared blocks');
			expect(within(workflows[0]).getByText('Standard')).toBeInTheDocument();
			expect(workflows[1]).toHaveTextContent('Order intake');
			expect(within(workflows[1]).queryByText('Standard')).not.toBeInTheDocument();
			expect(queryByText('Open workflow', { selector: 'button *' })).not.toBeInTheDocument();
		});

		it('should show the nodes of the first workflow without the sticky note', async () => {
			const { getAllByTestId, getByText, queryByText } = await renderLoadedLibrary();

			expect(getAllByTestId('node-library-node')).toHaveLength(3);
			expect(getByText('Fetch customer')).toBeInTheDocument();
			expect(getByText('Is active?')).toBeInTheDocument();
			expect(getByText('Normalize')).toBeInTheDocument();
			expect(queryByText('Note')).not.toBeInTheDocument();
		});

		it('should link to the active workflow with an address', async () => {
			const { getByTestId } = await renderLoadedLibrary();

			expect(getByTestId('node-library-open-workflow')).toHaveAttribute('href', '/workflow/blocks');
		});

		it('should read all pages of the workflow list', async () => {
			getWorkflows
				.mockResolvedValueOnce({ count: 3, data: [openWorkflow, orderIntake] })
				.mockResolvedValueOnce({ count: 3, data: [sharedBlocks] });

			const { getAllByTestId } = await renderLoadedLibrary();

			expect(getWorkflows).toHaveBeenCalledTimes(2);
			expect(getWorkflows).toHaveBeenLastCalledWith(
				expect.anything(),
				{ isArchived: false },
				{ skip: 2, take: 100, sortBy: 'name:asc' },
				LIST_FIELDS,
			);
			expect(getAllByTestId('node-library-workflow')).toHaveLength(2);
		});

		it('should stop the requests when a page is empty', async () => {
			getWorkflows
				.mockResolvedValueOnce({ count: 5, data: [orderIntake] })
				.mockResolvedValueOnce({ count: 5, data: [] });

			const { getAllByTestId } = await renderLoadedLibrary();

			expect(getWorkflows).toHaveBeenCalledTimes(2);
			expect(getAllByTestId('node-library-workflow')).toHaveLength(1);
		});

		it('should show the empty state when no other workflow has nodes', async () => {
			getWorkflows.mockResolvedValue({ count: 1, data: [openWorkflow] });

			const { findByTestId, queryByTestId } = renderComponent({ pinia: createTestingPinia() });

			await waitFor(() => expect(getWorkflows).toHaveBeenCalled());
			expect(await findByTestId('node-library-empty')).toBeInTheDocument();
			expect(queryByTestId('node-library-workflow')).not.toBeInTheDocument();
		});

		it('should show an error and load the library again on retry', async () => {
			const error = new Error('The request failed');
			getWorkflows.mockRejectedValueOnce(error);

			const { findByTestId, findAllByTestId } = renderComponent({
				pinia: createTestingPinia(),
			});

			expect(await findByTestId('node-library-load-error')).toBeInTheDocument();
			expect(showError).toHaveBeenCalledWith(error, 'Could not load the node library');

			await userEvent.click(await findByTestId('node-library-retry'));

			expect(await findAllByTestId('node-library-workflow')).toHaveLength(2);
		});
	});

	describe('search', () => {
		it('should keep the nodes that match the credential name', async () => {
			const { getAllByTestId, getByPlaceholderText, getByText } = await renderLoadedLibrary();

			await userEvent.type(
				getByPlaceholderText('Search workflows, nodes or node types'),
				'partner',
			);

			await waitFor(() => expect(getAllByTestId('node-library-node')).toHaveLength(1));
			expect(getByText('Fetch customer')).toBeInTheDocument();
			expect(getAllByTestId('node-library-workflow')).toHaveLength(1);
		});

		it('should show the workflow that matches when the active workflow does not', async () => {
			const { getAllByTestId, getByPlaceholderText, getByText } = await renderLoadedLibrary();

			await userEvent.type(
				getByPlaceholderText('Search workflows, nodes or node types'),
				'webhook',
			);

			await waitFor(() => expect(getAllByTestId('node-library-node')).toHaveLength(1));
			expect(getByText('Order webhook')).toBeInTheDocument();
			expect(getAllByTestId('node-library-workflow')[0]).toHaveTextContent('Order intake');
		});

		it('should show the no-match state when no node matches', async () => {
			const { findByTestId, getByPlaceholderText, queryByTestId } = await renderLoadedLibrary();

			await userEvent.type(
				getByPlaceholderText('Search workflows, nodes or node types'),
				'no such node',
			);

			expect(await findByTestId('node-library-no-match')).toBeInTheDocument();
			expect(queryByTestId('node-library-workflow')).not.toBeInTheDocument();
		});

		it('should list standard workflows only when the standard filter is on', async () => {
			const { getAllByTestId, getByTestId } = await renderLoadedLibrary();

			await userEvent.click(getByTestId('node-library-standard-only'));

			await waitFor(() => expect(getAllByTestId('node-library-workflow')).toHaveLength(1));
			expect(getAllByTestId('node-library-workflow')[0]).toHaveTextContent('Shared blocks');
		});
	});

	describe('selection', () => {
		it('should disable the add button when no node is selected', async () => {
			const { getByTestId } = await renderLoadedLibrary();

			expect(getByTestId('node-library-selected-count')).toHaveTextContent('0 nodes selected');
			expect(getByTestId('node-library-add')).toBeDisabled();
		});

		it('should count the selected nodes and enable the add button', async () => {
			const { getAllByTestId, getByTestId } = await renderLoadedLibrary();

			await userEvent.click(getAllByTestId('node-library-node')[0]);

			await waitFor(() =>
				expect(getByTestId('node-library-selected-count')).toHaveTextContent('1 node selected'),
			);
			expect(getAllByTestId('node-library-node')[0]).toBeChecked();
			expect(getByTestId('node-library-add')).toBeEnabled();
		});

		it('should select and clear all nodes of the active workflow', async () => {
			const { getAllByTestId, getByTestId } = await renderLoadedLibrary();

			await userEvent.click(getByTestId('node-library-select-all'));
			await waitFor(() =>
				expect(getByTestId('node-library-selected-count')).toHaveTextContent('3 nodes selected'),
			);
			getAllByTestId('node-library-node').forEach((checkbox) => expect(checkbox).toBeChecked());

			await userEvent.click(getByTestId('node-library-select-all'));
			await waitFor(() =>
				expect(getByTestId('node-library-selected-count')).toHaveTextContent('0 nodes selected'),
			);
		});

		it('should clear the selection when another workflow becomes active', async () => {
			const { getAllByTestId, getByTestId, getByText } = await renderLoadedLibrary();

			await userEvent.click(getAllByTestId('node-library-node')[0]);
			await userEvent.click(getAllByTestId('node-library-node')[1]);
			await waitFor(() =>
				expect(getByTestId('node-library-selected-count')).toHaveTextContent('2 nodes selected'),
			);

			await userEvent.click(getAllByTestId('node-library-workflow')[1]);

			await waitFor(() =>
				expect(getByTestId('node-library-selected-count')).toHaveTextContent('0 nodes selected'),
			);
			expect(getByText('Order webhook')).toBeInTheDocument();
			getAllByTestId('node-library-node').forEach((checkbox) => expect(checkbox).not.toBeChecked());
			expect(getByTestId('node-library-add')).toBeDisabled();
		});
	});

	describe('pull', () => {
		it('should read the source workflow again and send the selected nodes to the canvas', async () => {
			const { getAllByTestId, getByTestId } = await renderLoadedLibrary();
			const uiStore = mockedStore(useUIStore);

			await userEvent.click(getAllByTestId('node-library-node')[0]);
			await userEvent.click(getAllByTestId('node-library-node')[1]);
			await userEvent.click(getByTestId('node-library-add'));

			await waitFor(() => expect(addLibraryNodesToCanvas).toHaveBeenCalledTimes(1));
			expect(getWorkflow).toHaveBeenCalledWith(expect.anything(), 'blocks');
			expect(addLibraryNodesToCanvas).toHaveBeenCalledWith({
				nodes: [
					expect.objectContaining({ name: 'Fetch customer' }),
					expect.objectContaining({ name: 'Is active?' }),
				],
				// The connection to "Normalize" is not in the list, because that node is not selected.
				connections: {
					'Fetch customer': {
						main: [[{ node: 'Is active?', type: NodeConnectionTypes.Main, index: 0 }]],
					},
				},
			});
			expect(uiStore.closeModal).toHaveBeenCalledWith(NODE_LIBRARY_MODAL_KEY);
		});

		it('should show an error and stay open when the selected nodes are gone', async () => {
			getWorkflow.mockResolvedValue({ ...sharedBlocks, nodes: [], connections: {} });
			const { getAllByTestId, getByTestId } = await renderLoadedLibrary();
			const uiStore = mockedStore(useUIStore);

			await userEvent.click(getAllByTestId('node-library-node')[0]);
			await userEvent.click(getByTestId('node-library-add'));

			await waitFor(() =>
				expect(showMessage).toHaveBeenCalledWith(
					expect.objectContaining({ type: 'error', title: 'Could not add the nodes' }),
				),
			);
			expect(addLibraryNodesToCanvas).not.toHaveBeenCalled();
			expect(uiStore.closeModal).not.toHaveBeenCalled();
		});

		it('should show an error and stay open when the request fails', async () => {
			const error = new Error('The request failed');
			getWorkflow.mockRejectedValue(error);
			const { getAllByTestId, getByTestId } = await renderLoadedLibrary();
			const uiStore = mockedStore(useUIStore);

			await userEvent.click(getAllByTestId('node-library-node')[0]);
			await userEvent.click(getByTestId('node-library-add'));

			await waitFor(() => expect(showError).toHaveBeenCalledWith(error, 'Could not add the nodes'));
			expect(addLibraryNodesToCanvas).not.toHaveBeenCalled();
			expect(uiStore.closeModal).not.toHaveBeenCalled();
		});
	});
});
