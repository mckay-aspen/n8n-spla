// SPLA WHITE-LABEL: builds the central node library from the nodes of all workflows.
// Upstream can only copy nodes between two open editors. This file has no upstream counterpart.
import type { WorkflowDataUpdate } from '@n8n/rest-api-client/api/workflows';
import type { IConnections, INode, INodeConnections } from 'n8n-workflow';
import { deepCopy, STICKY_NODE_TYPE } from 'n8n-workflow';

import { NODE_LIBRARY_STANDARD_TAG } from './nodeLibrary.constants';

/** The fields of a workflow that the library reads. */
export interface NodeLibraryWorkflow {
	id: string;
	name: string;
	nodes?: INode[];
	/** The API returns tag objects. A plain string is a tag id, which has no name to compare. */
	tags?: Array<string | { name: string }>;
}

/** One workflow in the library, with the nodes that a user can pull from it. */
export interface NodeLibrarySource {
	workflowId: string;
	workflowName: string;
	/** The workflow carries the standard tag. The library lists it first. */
	isStandard: boolean;
	nodes: INode[];
}

export interface NodeLibraryFilter {
	query?: string;
	standardOnly?: boolean;
	/** Supplies more text to search for a node, such as the display name of its type. */
	describeNode?: (node: INode) => string;
}

function isLibraryNode(node: INode): boolean {
	return Boolean(node.name) && Boolean(node.type) && node.type !== STICKY_NODE_TYPE;
}

function hasStandardTag(tags: NodeLibraryWorkflow['tags']): boolean {
	return (tags ?? []).some(
		(tag) => typeof tag !== 'string' && tag.name.trim().toLowerCase() === NODE_LIBRARY_STANDARD_TAG,
	);
}

// The list request does not return connections, so the canvas position gives the reading order.
function byCanvasPosition(a: INode, b: INode): number {
	return (
		(a.position?.[0] ?? 0) - (b.position?.[0] ?? 0) ||
		(a.position?.[1] ?? 0) - (b.position?.[1] ?? 0)
	);
}

/**
 * Turns the workflows of the instance into library sources.
 * Standard workflows come first. The open workflow is not a source for itself.
 */
export function buildNodeLibrary(
	workflows: NodeLibraryWorkflow[],
	{ excludeWorkflowId }: { excludeWorkflowId?: string } = {},
): NodeLibrarySource[] {
	return workflows
		.filter((workflow) => workflow.id !== excludeWorkflowId)
		.map((workflow) => ({
			workflowId: workflow.id,
			workflowName: workflow.name,
			isStandard: hasStandardTag(workflow.tags),
			nodes: (workflow.nodes ?? []).filter(isLibraryNode).sort(byCanvasPosition),
		}))
		.filter((source) => source.nodes.length > 0)
		.sort(
			(a, b) =>
				Number(b.isStandard) - Number(a.isStandard) || a.workflowName.localeCompare(b.workflowName),
		);
}

/**
 * Keeps the nodes that match every search term.
 * A term that the workflow name contains matches every node of that workflow.
 */
export function filterNodeLibrary(
	sources: NodeLibrarySource[],
	{ query = '', standardOnly = false, describeNode }: NodeLibraryFilter = {},
): NodeLibrarySource[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	const matches: NodeLibrarySource[] = [];

	for (const source of sources) {
		if (standardOnly && !source.isStandard) continue;

		const workflowText = source.workflowName.toLowerCase();
		const openTerms = terms.filter((term) => !workflowText.includes(term));
		const nodes =
			openTerms.length === 0
				? source.nodes
				: source.nodes.filter((node) => {
						const nodeText = [node.name, node.type, describeNode?.(node) ?? '']
							.join(' ')
							.toLowerCase();
						return openTerms.every((term) => nodeText.includes(term));
					});

		if (nodes.length > 0) matches.push({ ...source, nodes });
	}

	return matches;
}

function isLiteralText(value: unknown): value is string {
	return typeof value === 'string' && value !== '' && !value.startsWith('=');
}

/** A short description of what a node is set to do, for the library list. */
export function summarizeLibraryNode(node: INode): string {
	const { resource, operation, method, url } = node.parameters ?? {};

	const action = [resource, operation].filter(isLiteralText);
	if (action.length > 0) return action.join(': ');

	if (typeof url === 'string' && url !== '') {
		return [isLiteralText(method) ? method : '', url.replace(/^=/, '')].filter(Boolean).join(' ');
	}

	return '';
}

/** The names of the credentials that a node uses. */
export function getLibraryNodeCredentialNames(node: INode): string[] {
	return Object.values(node.credentials ?? {})
		.map((credential) => (typeof credential === 'string' ? credential : credential?.name))
		.filter((name): name is string => Boolean(name));
}

/**
 * Makes the import payload for the selected nodes of one workflow.
 * The payload keeps the connections between the selected nodes only.
 * It carries no name, tags or pinned data, so an import changes the nodes of the target only.
 */
export function buildNodeLibraryPull(
	workflow: { nodes?: INode[]; connections?: IConnections },
	nodeNames: Iterable<string>,
): WorkflowDataUpdate {
	const wanted = new Set(nodeNames);
	const nodes = (workflow.nodes ?? [])
		.filter((node) => wanted.has(node.name) && isLibraryNode(node))
		.map((node) => deepCopy(node));
	const pulled = new Set(nodes.map((node) => node.name));

	const connections: IConnections = {};
	for (const [sourceName, connectionsByType] of Object.entries(workflow.connections ?? {})) {
		if (!pulled.has(sourceName)) continue;

		const kept: INodeConnections = {};
		for (const [type, outputs] of Object.entries(connectionsByType)) {
			// Keep every output index. If one is dropped, a later output moves to an earlier port.
			const keptOutputs = outputs.map((targets) =>
				(targets ?? [])
					.filter((target) => pulled.has(target.node))
					.map((target) => ({ ...target })),
			);
			if (keptOutputs.some((targets) => targets.length > 0)) kept[type] = keptOutputs;
		}

		if (Object.keys(kept).length > 0) connections[sourceName] = kept;
	}

	return { nodes, connections };
}
