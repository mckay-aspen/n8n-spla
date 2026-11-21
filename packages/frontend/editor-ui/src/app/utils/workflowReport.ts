// SPLA WHITE-LABEL: turns a workflow into a readable document for review and audit.
// Upstream has JSON export only. This file has no upstream counterpart.
import type { IConnections, INode, IPinData, IWorkflowSettings } from 'n8n-workflow';
import { mapConnectionsByDestination, STICKY_NODE_TYPE } from 'n8n-workflow';

import { isObject } from '@/app/utils/objectUtils';
import { sortNodesByExecutionOrder } from '@/app/utils/workflowUtils';

export interface WorkflowReportNodeType {
	displayName?: string;
	isTrigger?: boolean;
}

export interface WorkflowReportInput {
	workflow: {
		id?: string;
		name?: string;
		description?: string | null;
		active?: boolean;
		versionId?: string;
		nodes: INode[];
		connections: IConnections;
		settings?: IWorkflowSettings;
		pinData?: IPinData;
	};
	tagNames?: string[];
	/** Where a reader can open the workflow. */
	sourceUrl?: string;
	generatedAt: Date;
	/** Supplies the display name and the trigger flag of a node type. */
	describeNodeType?: (type: string, typeVersion: number) => WorkflowReportNodeType | undefined;
}

interface TreeItem {
	label: string;
	value?: string;
	/** A value that needs its own block, such as code or a long text. */
	block?: boolean;
	children?: TreeItem[];
}

export type WorkflowReportBlock =
	| { kind: 'heading'; level: 1 | 2 | 3; text: string }
	| { kind: 'paragraph'; text: string }
	| { kind: 'table'; headers: string[]; rows: string[][] }
	| { kind: 'tree'; items: TreeItem[] };

const MAIN = 'main';
const INLINE_VALUE_MAX_LENGTH = 100;
const NONE = '—';

function toTreeItem(label: string, value: unknown): TreeItem {
	if (Array.isArray(value)) {
		if (value.length === 0) return { label, value: '[]' };
		return {
			label,
			children: value.map((entry, index) => toTreeItem(`[${index + 1}]`, entry)),
		};
	}
	if (isObject(value)) {
		const entries = Object.entries(value);
		if (entries.length === 0) return { label, value: '{}' };
		return { label, children: entries.map(([key, entry]) => toTreeItem(key, entry)) };
	}
	if (typeof value === 'string') {
		if (value === '') return { label, value: '""' };
		const block = value.includes('\n') || value.length > INLINE_VALUE_MAX_LENGTH;
		return { label, value, block };
	}
	return { label, value: String(value) };
}

function describeOutgoing(connections: IConnections, nodeName: string): string[] {
	const result: string[] = [];
	for (const [type, outputs] of Object.entries(connections[nodeName] ?? {})) {
		outputs.forEach((targets, outputIndex) => {
			for (const target of targets ?? []) {
				const qualifiers = [];
				if (outputs.length > 1) qualifiers.push(`output ${outputIndex}`);
				if (type !== MAIN) qualifiers.push(type);
				result.push(target.node + (qualifiers.length ? ` (${qualifiers.join(', ')})` : ''));
			}
		});
	}
	return result;
}

function describeIncoming(connectionsByDestination: IConnections, nodeName: string): string[] {
	const result: string[] = [];
	for (const [type, inputs] of Object.entries(connectionsByDestination[nodeName] ?? {})) {
		inputs.forEach((sources, inputIndex) => {
			for (const source of sources ?? []) {
				const qualifiers = [];
				if (inputs.length > 1) qualifiers.push(`input ${inputIndex}`);
				if (type !== MAIN) qualifiers.push(type);
				result.push(source.node + (qualifiers.length ? ` (${qualifiers.join(', ')})` : ''));
			}
		});
	}
	return result;
}

function byPosition(a: INode, b: INode): number {
	return a.position[0] - b.position[0] || a.position[1] - b.position[1];
}

/**
 * Puts the nodes in the order that a reader follows on the canvas.
 * Nodes that no trigger reaches come last, because an audit must list every node.
 */
function orderNodes(
	nodes: INode[],
	connections: IConnections,
	connectionsByDestination: IConnections,
	isTrigger: (node: INode) => boolean,
): INode[] {
	const sorted = sortNodesByExecutionOrder(
		nodes.map((node) => ({ node, isTrigger: isTrigger(node) })),
		connections,
		connectionsByDestination,
		Object.fromEntries(nodes.map((node) => [node.name, node.type])),
	).map((item) => item.node);

	const reached = new Set(sorted.map((node) => node.name));
	const unreached = nodes.filter((node) => !reached.has(node.name)).sort(byPosition);
	return [...sorted, ...unreached];
}

function joinOrNone(values: string[]): string {
	return values.length ? values.join('; ') : NONE;
}

function nodeFields(
	node: INode,
	typeLabel: string,
	incoming: string[],
	outgoing: string[],
	pinnedItemCount: number | undefined,
): string[][] {
	const rows: string[][] = [
		['Type', typeLabel],
		['Status', node.disabled ? 'Disabled' : 'Enabled'],
		['Receives from', joinOrNone(incoming)],
		['Sends to', joinOrNone(outgoing)],
	];

	const credentials = Object.entries(node.credentials ?? {}).map(
		([type, credential]) => `${credential.name} (${type})`,
	);
	if (credentials.length) rows.push(['Credentials', credentials.join('; ')]);

	const onError = node.onError ?? (node.continueOnFail ? 'continueRegularOutput' : undefined);
	if (onError) rows.push(['On error', onError]);
	if (node.retryOnFail) {
		const tries = node.maxTries ? `, ${node.maxTries} tries` : '';
		const wait = node.waitBetweenTries ? `, ${node.waitBetweenTries} ms between tries` : '';
		rows.push(['Retry on fail', `Yes${tries}${wait}`]);
	}
	if (node.executeOnce) rows.push(['Execute once', 'Yes']);
	if (node.alwaysOutputData) rows.push(['Always output data', 'Yes']);
	if (node.webhookId) rows.push(['Webhook ID', node.webhookId]);
	if (pinnedItemCount !== undefined) {
		rows.push(['Pinned data', `Yes, ${pinnedItemCount} item(s). Manual runs use it.`]);
	}
	if (node.notes) rows.push(['Notes', node.notes]);

	return rows;
}

export function buildWorkflowReport(input: WorkflowReportInput): WorkflowReportBlock[] {
	const { workflow, describeNodeType } = input;
	const connectionsByDestination = mapConnectionsByDestination(workflow.connections);

	const stickyNotes = workflow.nodes.filter((node) => node.type === STICKY_NODE_TYPE);
	const stepNodes = workflow.nodes.filter((node) => node.type !== STICKY_NODE_TYPE);

	const typeInfo = (node: INode) => describeNodeType?.(node.type, node.typeVersion);
	// Without node type data, a node that starts a chain counts as a trigger.
	const isTrigger = (node: INode) =>
		typeInfo(node)?.isTrigger ??
		(connectionsByDestination[node.name] === undefined &&
			workflow.connections[node.name]?.[MAIN] !== undefined);
	const typeLabel = (node: INode) => {
		const displayName = typeInfo(node)?.displayName;
		const technical = `${node.type} v${node.typeVersion}`;
		return displayName ? `${displayName} (${technical})` : technical;
	};

	const ordered = orderNodes(stepNodes, workflow.connections, connectionsByDestination, isTrigger);
	const disabledCount = ordered.filter((node) => node.disabled).length;

	const blocks: WorkflowReportBlock[] = [
		{ kind: 'heading', level: 1, text: workflow.name ?? 'Unnamed workflow' },
	];

	if (workflow.description) blocks.push({ kind: 'paragraph', text: workflow.description });

	const summary: string[][] = [
		['Workflow ID', workflow.id ?? 'Not saved'],
		['Status', workflow.active ? 'Active' : 'Inactive'],
		['Version ID', workflow.versionId ?? NONE],
		['Tags', joinOrNone(input.tagNames ?? [])],
		['Nodes', `${ordered.length}${disabledCount ? ` (${disabledCount} disabled)` : ''}`],
		['Generated', input.generatedAt.toISOString()],
	];
	if (input.sourceUrl) summary.push(['Source', input.sourceUrl]);
	blocks.push({ kind: 'table', headers: ['Field', 'Value'], rows: summary });
	blocks.push({
		kind: 'paragraph',
		text: 'Credentials appear by name only. A workflow does not contain the secret values. Parameters appear as they are saved, and a value that starts with "=" is an expression.',
	});

	blocks.push({ kind: 'heading', level: 2, text: 'Overview' });
	blocks.push({
		kind: 'table',
		headers: ['#', 'Node', 'Type', 'Status', 'Credentials', 'Sends to'],
		rows: ordered.map((node, index) => [
			String(index + 1),
			node.name,
			typeInfo(node)?.displayName ?? node.type,
			node.disabled ? 'Disabled' : isTrigger(node) ? 'Trigger' : 'Enabled',
			joinOrNone(Object.values(node.credentials ?? {}).map((credential) => credential.name)),
			joinOrNone(describeOutgoing(workflow.connections, node.name)),
		]),
	});

	blocks.push({ kind: 'heading', level: 2, text: 'Nodes' });
	ordered.forEach((node, index) => {
		blocks.push({ kind: 'heading', level: 3, text: `${index + 1}. ${node.name}` });
		blocks.push({
			kind: 'table',
			headers: ['Field', 'Value'],
			rows: nodeFields(
				node,
				typeLabel(node),
				describeIncoming(connectionsByDestination, node.name),
				describeOutgoing(workflow.connections, node.name),
				workflow.pinData?.[node.name]?.length,
			),
		});
		const parameters = Object.entries(node.parameters ?? {});
		blocks.push(
			parameters.length
				? { kind: 'tree', items: parameters.map(([key, value]) => toTreeItem(key, value)) }
				: { kind: 'paragraph', text: 'No parameters are set.' },
		);
	});

	if (stickyNotes.length) {
		blocks.push({ kind: 'heading', level: 2, text: 'Sticky notes' });
		blocks.push({
			kind: 'tree',
			items: [...stickyNotes]
				.sort(byPosition)
				.map((note) => toTreeItem(note.name, note.parameters?.content ?? '')),
		});
	}

	const settings = Object.entries(workflow.settings ?? {});
	if (settings.length) {
		blocks.push({ kind: 'heading', level: 2, text: 'Workflow settings' });
		blocks.push({
			kind: 'table',
			headers: ['Setting', 'Value'],
			rows: settings.map(([key, value]) => [
				key,
				isObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value),
			]),
		});
	}

	return blocks;
}

// --- Markdown ---------------------------------------------------------------

function escapeMarkdown(text: string): string {
	return text.replace(/([\\`*_[\]<>|#])/g, '\\$1').replace(/\r?\n/g, '<br>');
}

/** A fence that is longer than each run of backticks in the text. */
function fenceFor(text: string, minimum: number): string {
	const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	return '`'.repeat(Math.max(minimum, longestRun + 1));
}

function inlineCode(text: string): string {
	const fence = fenceFor(text, 1);
	const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
	return `${fence}${pad}${text}${pad}${fence}`;
}

function treeToMarkdown(items: TreeItem[], depth: number): string[] {
	const indent = '  '.repeat(depth);
	const lines: string[] = [];
	for (const item of items) {
		const label = `${indent}- **${escapeMarkdown(item.label)}:**`;
		if (item.children) {
			lines.push(label, ...treeToMarkdown(item.children, depth + 1));
		} else if (item.block) {
			const value = item.value ?? '';
			const fence = fenceFor(value, 3);
			lines.push(label, '', `${indent}  ${fence}`);
			lines.push(...value.split(/\r?\n/).map((line) => `${indent}  ${line}`));
			lines.push(`${indent}  ${fence}`, '');
		} else {
			lines.push(`${label} ${inlineCode(item.value ?? '')}`);
		}
	}
	return lines;
}

export function workflowReportToMarkdown(blocks: WorkflowReportBlock[]): string {
	const parts = blocks.map((block) => {
		switch (block.kind) {
			case 'heading':
				return `${'#'.repeat(block.level)} ${escapeMarkdown(block.text)}`;
			case 'paragraph':
				return escapeMarkdown(block.text);
			case 'table': {
				const row = (cells: string[]) => `| ${cells.map(escapeMarkdown).join(' | ')} |`;
				return [
					row(block.headers),
					`| ${block.headers.map(() => '---').join(' | ')} |`,
					...block.rows.map(row),
				].join('\n');
			}
			case 'tree':
				return treeToMarkdown(block.items, 0).join('\n');
		}
	});
	return parts.join('\n\n') + '\n';
}

// --- HTML -------------------------------------------------------------------

// The shared `escapeHtml` leaves "&" as it is. A saved value such as "&lt;" would
// then print as "<", and an audit document must show the saved text exactly.
function escapeHtmlText(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function treeToHtml(items: TreeItem[]): string {
	const rows = items.map((item) => {
		const label = `<span class="label">${escapeHtmlText(item.label)}:</span>`;
		if (item.children) return `<li>${label}${treeToHtml(item.children)}</li>`;
		const value = escapeHtmlText(item.value ?? '');
		return item.block
			? `<li>${label}<pre>${value}</pre></li>`
			: `<li>${label} <code>${value}</code></li>`;
	});
	return `<ul>${rows.join('')}</ul>`;
}

const REPORT_STYLES = `
	body { font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 32px auto; max-width: 900px; padding: 0 24px; }
	h1 { font-size: 24px; margin: 0 0 8px; }
	h2 { font-size: 18px; margin: 32px 0 8px; border-bottom: 1px solid #999; padding-bottom: 4px; }
	h3 { font-size: 15px; margin: 24px 0 8px; }
	h2, h3 { break-after: avoid; }
	p { margin: 8px 0; white-space: pre-wrap; }
	table { border-collapse: collapse; width: 100%; margin: 8px 0; }
	th, td { border: 1px solid #bbb; padding: 4px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; }
	th { background: #eee; }
	tr { break-inside: avoid; }
	ul { margin: 4px 0; padding-left: 20px; list-style: none; }
	body > ul { padding-left: 0; }
	li { margin: 2px 0; }
	.label { font-weight: 600; }
	code, pre { font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
	code { overflow-wrap: anywhere; }
	pre { margin: 4px 0 8px; padding: 8px; border: 1px solid #bbb; background: #f6f6f6; white-space: pre-wrap; overflow-wrap: anywhere; }
	@media print { body { margin: 0; max-width: none; padding: 0; } th, pre { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

export function workflowReportToHtml(blocks: WorkflowReportBlock[]): string {
	const body = blocks.map((block) => {
		switch (block.kind) {
			case 'heading':
				return `<h${block.level}>${escapeHtmlText(block.text)}</h${block.level}>`;
			case 'paragraph':
				return `<p>${escapeHtmlText(block.text)}</p>`;
			case 'table': {
				const cells = (tag: string, values: string[]) =>
					`<tr>${values.map((value) => `<${tag}>${escapeHtmlText(value)}</${tag}>`).join('')}</tr>`;
				return `<table><thead>${cells('th', block.headers)}</thead><tbody>${block.rows
					.map((row) => cells('td', row))
					.join('')}</tbody></table>`;
			}
			case 'tree':
				return treeToHtml(block.items);
		}
	});
	const heading = blocks.find((block) => block.kind === 'heading');
	const title = escapeHtmlText(heading?.kind === 'heading' ? heading.text : 'Workflow');
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${REPORT_STYLES}</style></head><body>${body.join('')}</body></html>`;
}

/**
 * Prints an HTML document through a hidden frame, so the editor page stays as it is.
 * The frame cannot run scripts.
 */
export function printHtmlDocument(html: string): void {
	const frame = document.createElement('iframe');
	frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
	frame.setAttribute('aria-hidden', 'true');
	frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
	frame.addEventListener('load', () => {
		const frameWindow = frame.contentWindow;
		if (!frameWindow) return;
		frameWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
		frameWindow.focus();
		frameWindow.print();
	});
	frame.srcdoc = html;
	document.body.appendChild(frame);
}
