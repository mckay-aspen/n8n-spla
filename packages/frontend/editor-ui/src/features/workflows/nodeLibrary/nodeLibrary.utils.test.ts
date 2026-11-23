// SPLA WHITE-LABEL: tests of the central node library. This file has no upstream counterpart.
import cloneDeep from 'lodash/cloneDeep';
import type { IConnections, INode } from 'n8n-workflow';
import { NodeConnectionTypes, STICKY_NODE_TYPE } from 'n8n-workflow';

import { createTestNode } from '@/__tests__/mocks';

import {
	buildNodeLibrary,
	buildNodeLibraryPull,
	filterNodeLibrary,
	getLibraryNodeCredentialNames,
	summarizeLibraryNode,
	type NodeLibrarySource,
} from './nodeLibrary.utils';

const HTTP_TYPE = 'n8n-nodes-base.httpRequest';
const IF_TYPE = 'n8n-nodes-base.if';
const SLACK_TYPE = 'n8n-nodes-base.slack';

const node = (name: string, overrides: Partial<INode> = {}): INode =>
	createTestNode({ name, ...overrides });

const source = (overrides: Partial<NodeLibrarySource> = {}): NodeLibrarySource => ({
	workflowId: 'w1',
	workflowName: 'Workflow',
	isStandard: false,
	nodes: [],
	...overrides,
});

const getWorkflowNames = (sources: NodeLibrarySource[]) =>
	sources.map(({ workflowName }) => workflowName);
const getNodeNames = (sources: NodeLibrarySource[]) =>
	sources.map(({ nodes }) => nodes.map(({ name }) => name));

describe('buildNodeLibrary', () => {
	it('should list standard workflows first and then sort by name', () => {
		const sources = buildNodeLibrary([
			{ id: '1', name: 'Zeta', nodes: [node('A')] },
			{ id: '2', name: 'Alpha', nodes: [node('A')] },
			{ id: '3', name: 'Shared steps', nodes: [node('A')], tags: [{ name: 'library' }] },
			{ id: '4', name: 'Base blocks', nodes: [node('A')], tags: [{ name: 'library' }] },
		]);

		expect(getWorkflowNames(sources)).toEqual(['Base blocks', 'Shared steps', 'Alpha', 'Zeta']);
		expect(sources.map(({ isStandard }) => isStandard)).toEqual([true, true, false, false]);
	});

	it('should ignore letter case and outer spaces in the standard tag', () => {
		const [first] = buildNodeLibrary([
			{ id: '1', name: 'Blocks', nodes: [node('A')], tags: [{ name: ' Library ' }] },
		]);

		expect(first.isStandard).toBe(true);
	});

	it('should not read a tag id or another tag name as the standard tag', () => {
		const sources = buildNodeLibrary([
			{ id: '1', name: 'Tag id only', nodes: [node('A')], tags: ['library'] },
			{ id: '2', name: 'Other tag', nodes: [node('A')], tags: [{ name: 'library-draft' }] },
		]);

		expect(sources.map(({ isStandard }) => isStandard)).toEqual([false, false]);
	});

	it('should not list the open workflow', () => {
		const sources = buildNodeLibrary(
			[
				{ id: 'open', name: 'Open workflow', nodes: [node('A')] },
				{ id: 'other', name: 'Other workflow', nodes: [node('A')] },
			],
			{ excludeWorkflowId: 'open' },
		);

		expect(getWorkflowNames(sources)).toEqual(['Other workflow']);
	});

	it('should not list sticky notes', () => {
		const sources = buildNodeLibrary([
			{
				id: '1',
				name: 'Workflow',
				nodes: [node('Note', { type: STICKY_NODE_TYPE }), node('Fetch')],
			},
		]);

		expect(getNodeNames(sources)).toEqual([['Fetch']]);
	});

	it('should not list a workflow that has no nodes to pull', () => {
		const sources = buildNodeLibrary([
			{ id: '1', name: 'No node field' },
			{ id: '2', name: 'Empty', nodes: [] },
			{ id: '3', name: 'Notes only', nodes: [node('Note', { type: STICKY_NODE_TYPE })] },
		]);

		expect(sources).toEqual([]);
	});

	it('should sort the nodes of a workflow by canvas position', () => {
		const nodes = [
			node('Right', { position: [400, 0] }),
			node('Left bottom', { position: [0, 200] }),
			node('Left top', { position: [0, -100] }),
		];

		const sources = buildNodeLibrary([{ id: '1', name: 'Workflow', nodes }]);

		expect(getNodeNames(sources)).toEqual([['Left top', 'Left bottom', 'Right']]);
		// The sort must not change the order of the input.
		expect(nodes.map(({ name }) => name)).toEqual(['Right', 'Left bottom', 'Left top']);
	});
});

describe('filterNodeLibrary', () => {
	const sources = [
		source({
			workflowId: 'std',
			workflowName: 'Standard building blocks',
			isStandard: true,
			nodes: [
				node('Fetch customer', { type: HTTP_TYPE }),
				node('Is active customer?', { type: IF_TYPE }),
			],
		}),
		source({
			workflowId: 'orders',
			workflowName: 'Order intake',
			nodes: [
				node('Create order', { type: HTTP_TYPE }),
				node('Post to #ops', { type: SLACK_TYPE }),
			],
		}),
	];

	it('should keep all sources when there is no search text', () => {
		expect(filterNodeLibrary(sources)).toEqual(sources);
		expect(filterNodeLibrary(sources, { query: '   ' })).toEqual(sources);
	});

	it('should match the node name without regard to letter case', () => {
		expect(getNodeNames(filterNodeLibrary(sources, { query: 'ACTIVE' }))).toEqual([
			['Is active customer?'],
		]);
	});

	it('should match the node type', () => {
		expect(getNodeNames(filterNodeLibrary(sources, { query: 'httprequest' }))).toEqual([
			['Fetch customer'],
			['Create order'],
		]);
	});

	it('should match the text that the caller supplies for a node', () => {
		const matches = filterNodeLibrary(sources, {
			query: 'partner api key',
			describeNode: ({ name }) => (name === 'Fetch customer' ? 'Partner API key' : ''),
		});

		expect(getNodeNames(matches)).toEqual([['Fetch customer']]);
	});

	it('should keep only the nodes that match every term', () => {
		expect(getNodeNames(filterNodeLibrary(sources, { query: 'customer fetch' }))).toEqual([
			['Fetch customer'],
		]);
		expect(filterNodeLibrary(sources, { query: 'customer slack' })).toEqual([]);
	});

	it('should match all nodes of a workflow when its name contains the term', () => {
		expect(getNodeNames(filterNodeLibrary(sources, { query: 'intake' }))).toEqual([
			['Create order', 'Post to #ops'],
		]);
	});

	it('should match one term in the workflow name and another term in the node', () => {
		expect(getNodeNames(filterNodeLibrary(sources, { query: 'intake slack' }))).toEqual([
			['Post to #ops'],
		]);
	});

	it('should keep only standard sources when the standard filter is on', () => {
		expect(getWorkflowNames(filterNodeLibrary(sources, { standardOnly: true }))).toEqual([
			'Standard building blocks',
		]);
		expect(filterNodeLibrary(sources, { query: 'order', standardOnly: true })).toEqual([]);
	});

	it('should not change the sources', () => {
		const matches = filterNodeLibrary(sources, { query: 'fetch' });

		expect(matches[0]).not.toBe(sources[0]);
		expect(sources[0].nodes).toHaveLength(2);
	});
});

describe('summarizeLibraryNode', () => {
	it('should show the resource and the operation', () => {
		const summary = summarizeLibraryNode(
			node('Post', { parameters: { resource: 'message', operation: 'post' } }),
		);

		expect(summary).toBe('message: post');
	});

	it('should show the method and the address of a request', () => {
		const summary = summarizeLibraryNode(
			node('Send', { parameters: { method: 'POST', url: 'https://example.com/events' } }),
		);

		expect(summary).toBe('POST https://example.com/events');
	});

	it('should show an address expression without the expression mark', () => {
		const summary = summarizeLibraryNode(
			node('Fetch', { parameters: { url: '=https://example.com/{{ $json.id }}' } }),
		);

		expect(summary).toBe('https://example.com/{{ $json.id }}');
	});

	it('should not show a resource or an operation that is an expression', () => {
		const summary = summarizeLibraryNode(
			node('Dynamic', { parameters: { resource: '={{ $json.kind }}', operation: 'get' } }),
		);

		expect(summary).toBe('get');
	});

	it('should return an empty text when the node has no such parameters', () => {
		expect(summarizeLibraryNode(node('Plain'))).toBe('');
	});
});

describe('getLibraryNodeCredentialNames', () => {
	it('should return the names of the credentials', () => {
		const names = getLibraryNodeCredentialNames(
			node('Fetch', {
				credentials: {
					httpHeaderAuth: { id: 'c1', name: 'Partner API key' },
					httpBasicAuth: { id: null, name: 'Old login' },
				},
			}),
		);

		expect(names).toEqual(['Partner API key', 'Old login']);
	});

	it('should return an empty list when the node uses no credential', () => {
		expect(getLibraryNodeCredentialNames(node('Plain'))).toEqual([]);
	});
});

describe('buildNodeLibraryPull', () => {
	const main = (...outputs: string[][]): IConnections[string] => ({
		main: outputs.map((targets) =>
			targets.map((name) => ({ node: name, type: NodeConnectionTypes.Main, index: 0 })),
		),
	});

	const createWorkflow = () => ({
		name: 'Standard building blocks',
		tags: [{ id: 't1', name: 'library' }],
		pinData: { Fetch: [{ json: { id: 1 } }] },
		nodes: [
			node('Trigger'),
			node('Fetch', { type: HTTP_TYPE, parameters: { options: { timeout: 10 } } }),
			node('Is active?', { type: IF_TYPE }),
			node('Normalize'),
			node('Flag inactive'),
			node('Note', { type: STICKY_NODE_TYPE }),
		],
		connections: {
			Trigger: main(['Fetch']),
			Fetch: main(['Is active?']),
			'Is active?': main(['Normalize'], ['Flag inactive']),
		},
	});

	it('should copy the selected nodes only', () => {
		const pull = buildNodeLibraryPull(createWorkflow(), ['Fetch', 'Normalize']);

		expect(pull.nodes?.map(({ name }) => name)).toEqual(['Fetch', 'Normalize']);
	});

	it('should keep the connections between the selected nodes', () => {
		const pull = buildNodeLibraryPull(createWorkflow(), ['Fetch', 'Is active?', 'Normalize']);

		expect(pull.connections).toEqual({
			Fetch: main(['Is active?']),
			// The second output stays in the list, so that the first output keeps its port.
			'Is active?': main(['Normalize'], []),
		});
	});

	it('should keep the port of an output when an earlier output has no selected target', () => {
		const pull = buildNodeLibraryPull(createWorkflow(), ['Is active?', 'Flag inactive']);

		expect(pull.connections).toEqual({ 'Is active?': main([], ['Flag inactive']) });
	});

	it('should drop the connections from and to nodes that are not selected', () => {
		const pull = buildNodeLibraryPull(createWorkflow(), ['Fetch', 'Normalize']);

		expect(pull.connections).toEqual({});
	});

	it('should not copy a sticky note', () => {
		const pull = buildNodeLibraryPull(createWorkflow(), ['Note', 'Fetch']);

		expect(pull.nodes?.map(({ name }) => name)).toEqual(['Fetch']);
	});

	it('should return no nodes when the selected names are not in the workflow', () => {
		expect(buildNodeLibraryPull(createWorkflow(), ['Removed node'])).toEqual({
			nodes: [],
			connections: {},
		});
	});

	it('should carry nodes and connections only', () => {
		const pull = buildNodeLibraryPull(createWorkflow(), ['Fetch']);

		expect(Object.keys(pull).sort()).toEqual(['connections', 'nodes']);
	});

	it('should not change the source workflow when the copies change', () => {
		const workflow = createWorkflow();
		const before = cloneDeep(workflow);

		const pull = buildNodeLibraryPull(workflow, ['Fetch', 'Is active?']);
		const [fetchCopy] = pull.nodes ?? [];
		fetchCopy.id = 'new-id';
		fetchCopy.parameters.options = { timeout: 99 };
		pull.connections?.Fetch.main[0]?.push({
			node: 'Other',
			type: NodeConnectionTypes.Main,
			index: 0,
		});

		expect(workflow).toEqual(before);
	});
});
