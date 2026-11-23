<script setup lang="ts">
// SPLA WHITE-LABEL: the dialog of the central node library.
// It lists the nodes of all other workflows and copies the selected nodes into the open workflow.
// This file has no upstream counterpart.
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { INode } from 'n8n-workflow';
import { useI18n } from '@n8n/i18n';
import { useToast } from '@n8n/composables/useToast';
import { useRootStore } from '@n8n/stores/useRootStore';
import { useSettingsStore } from '@n8n/stores/settings.store';
import {
	N8nBadge,
	N8nButton,
	N8nCheckbox,
	N8nIcon,
	N8nInput,
	N8nLink,
	N8nText,
} from '@n8n/design-system';

import * as workflowsApi from '@/app/api/workflows';
import Modal from '@/app/components/Modal.vue';
import NodeIcon from '@/app/components/NodeIcon.vue';
import { useWorkflowId } from '@/app/composables/useWorkflowId';
import { VIEWS } from '@/app/constants';
import { useNodeTypesStore } from '@/app/stores/nodeTypes.store';
import { useUIStore } from '@/app/stores/ui.store';

import { addLibraryNodesToCanvas } from '../nodeLibrary.canvas';
import {
	NODE_LIBRARY_MODAL_KEY,
	NODE_LIBRARY_PAGE_SIZE,
	NODE_LIBRARY_STANDARD_TAG,
} from '../nodeLibrary.constants';
import {
	buildNodeLibrary,
	buildNodeLibraryPull,
	filterNodeLibrary,
	getLibraryNodeCredentialNames,
	summarizeLibraryNode,
	type NodeLibrarySource,
	type NodeLibraryWorkflow,
} from '../nodeLibrary.utils';

// DynamicModalLoader's modal-state props must not reach the dialog root.
defineOptions({ inheritAttrs: false });

const i18n = useI18n();
const router = useRouter();
const toast = useToast();
const rootStore = useRootStore();
const settingsStore = useSettingsStore();
const nodeTypesStore = useNodeTypesStore();
const uiStore = useUIStore();
const openWorkflowId = useWorkflowId();

const loading = ref(true);
const loadFailed = ref(false);
const pulling = ref(false);

// A shallow ref keeps the node objects unwrapped, so a node can be a map key.
const sources = shallowRef<NodeLibrarySource[]>([]);
const query = ref('');
const standardOnly = ref(false);
const activeWorkflowId = ref('');
const selectedNames = ref(new Set<string>());

interface NodeDetails {
	typeName: string;
	summary: string;
	credentials: string[];
}

function getTypeName(node: INode): string {
	const displayName = nodeTypesStore.getNodeType(node.type, node.typeVersion)?.displayName;
	return displayName ?? node.type.split('.').pop() ?? node.type;
}

const detailsByNode = computed(() => {
	const details = new Map<INode, NodeDetails>();
	for (const source of sources.value) {
		for (const node of source.nodes) {
			details.set(node, {
				typeName: getTypeName(node),
				summary: summarizeLibraryNode(node),
				credentials: getLibraryNodeCredentialNames(node),
			});
		}
	}
	return details;
});

function describeNode(node: INode): string {
	const details = detailsByNode.value.get(node);
	if (!details) return '';
	return [details.typeName, details.summary, ...details.credentials].join(' ');
}

function getDetailsLine(node: INode): string {
	const details = detailsByNode.value.get(node);
	if (!details) return '';
	// The summary can be long. It is the last part, so that an ellipsis does not hide the other parts.
	return [
		details.typeName,
		...details.credentials,
		node.disabled ? i18n.baseText('nodeLibrary.node.deactivated') : '',
		details.summary,
	]
		.filter(Boolean)
		.join(' · ');
}

const hasStandardSources = computed(() => sources.value.some((source) => source.isStandard));

const filteredSources = computed(() =>
	filterNodeLibrary(sources.value, {
		query: query.value,
		standardOnly: standardOnly.value,
		describeNode,
	}),
);

// The first match becomes active when the search removes the active workflow from the list.
const activeSource = computed(
	() =>
		filteredSources.value.find((source) => source.workflowId === activeWorkflowId.value) ??
		filteredSources.value[0],
);

// A link that opens a new window needs a URL, not a route object.
const activeSourceHref = computed(() =>
	activeSource.value
		? router.resolve({
				name: VIEWS.WORKFLOW,
				params: { workflowId: activeSource.value.workflowId },
			}).href
		: undefined,
);

const visibleNodeNames = computed(() => activeSource.value?.nodes.map((node) => node.name) ?? []);

const areAllVisibleSelected = computed(
	() =>
		visibleNodeNames.value.length > 0 &&
		visibleNodeNames.value.every((name) => selectedNames.value.has(name)),
);

const areSomeVisibleSelected = computed(
	() =>
		!areAllVisibleSelected.value &&
		visibleNodeNames.value.some((name) => selectedNames.value.has(name)),
);

// Connections use node names, and two workflows can use the same name.
// Thus the selection belongs to one workflow at a time.
watch(
	() => activeSource.value?.workflowId,
	() => {
		selectedNames.value = new Set();
	},
);

function setNodeSelected(name: string, isSelected: boolean) {
	const next = new Set(selectedNames.value);
	if (isSelected) next.add(name);
	else next.delete(name);
	selectedNames.value = next;
}

function setAllVisibleSelected(isSelected: boolean) {
	const next = new Set(selectedNames.value);
	for (const name of visibleNodeNames.value) {
		if (isSelected) next.add(name);
		else next.delete(name);
	}
	selectedNames.value = next;
}

function getNodeCountLabel(count: number): string {
	return i18n.baseText('nodeLibrary.nodeCount', {
		adjustToNumber: count,
		interpolate: { count: String(count) },
	});
}

async function loadLibrary() {
	loading.value = true;
	loadFailed.value = false;

	try {
		// Sort ties can move a workflow between two pages. The map removes the duplicates.
		const workflowsById = new Map<string, NodeLibraryWorkflow>();
		let fetched = 0;
		let total = Number.POSITIVE_INFINITY;

		while (fetched < total) {
			const { count, data } = await workflowsApi.getWorkflows(
				rootStore.restApiContext,
				{ isArchived: false },
				{ skip: fetched, take: NODE_LIBRARY_PAGE_SIZE, sortBy: 'name:asc' },
				['id', 'name', 'nodes', 'tags'],
			);
			if (data.length === 0) break;

			for (const workflow of data) workflowsById.set(workflow.id, workflow);
			fetched += data.length;
			total = count;
		}

		sources.value = buildNodeLibrary([...workflowsById.values()], {
			excludeWorkflowId: openWorkflowId.value,
		});
	} catch (error) {
		loadFailed.value = true;
		toast.showError(error, i18n.baseText('nodeLibrary.loadError.title'));
	} finally {
		loading.value = false;
	}
}

function closeModal() {
	uiStore.closeModal(NODE_LIBRARY_MODAL_KEY);
}

async function pullSelectedNodes() {
	const source = activeSource.value;
	if (!source || selectedNames.value.size === 0 || pulling.value) return;

	pulling.value = true;
	try {
		// The list request returns no connections. Read the source workflow again to get them.
		// This also gets the latest saved version of each node.
		const workflow = await workflowsApi.getWorkflow(rootStore.restApiContext, source.workflowId);
		const data = buildNodeLibraryPull(workflow, selectedNames.value);

		if (!data.nodes?.length) {
			toast.showMessage({
				type: 'error',
				title: i18n.baseText('nodeLibrary.pullError.title'),
				message: i18n.baseText('nodeLibrary.pullError.nodesGone'),
			});
			return;
		}

		addLibraryNodesToCanvas(data);
		closeModal();
	} catch (error) {
		toast.showError(error, i18n.baseText('nodeLibrary.pullError.title'));
	} finally {
		pulling.value = false;
	}
}

onMounted(loadLibrary);
</script>

<template>
	<Modal
		:name="NODE_LIBRARY_MODAL_KEY"
		:title="i18n.baseText('nodeLibrary.title')"
		:subtitle="i18n.baseText('nodeLibrary.subtitle')"
		:loading="loading"
		:center="true"
		width="920px"
		max-width="92vw"
		height="80vh"
		max-height="720px"
	>
		<template #content>
			<div :class="$style.library" data-test-id="node-library">
				<div v-if="loadFailed" :class="$style.state" data-test-id="node-library-load-error">
					<N8nText color="text-base">{{ i18n.baseText('nodeLibrary.loadError.message') }}</N8nText>
					<N8nButton
						variant="subtle"
						:label="i18n.baseText('generic.retry')"
						data-test-id="node-library-retry"
						@click="loadLibrary"
					/>
				</div>

				<div
					v-else-if="sources.length === 0"
					:class="$style.state"
					data-test-id="node-library-empty"
				>
					<N8nIcon icon="blocks" size="xlarge" color="text-light" />
					<N8nText :bold="true" color="text-dark">
						{{ i18n.baseText('nodeLibrary.empty.title') }}
					</N8nText>
					<N8nText color="text-base" size="small">
						{{ i18n.baseText('nodeLibrary.empty.message') }}
					</N8nText>
				</div>

				<template v-else>
					<div :class="$style.toolbar">
						<N8nInput
							v-model="query"
							:class="$style.search"
							:placeholder="i18n.baseText('nodeLibrary.search.placeholder')"
							:aria-label="i18n.baseText('nodeLibrary.search.placeholder')"
							:clearable="true"
							:autofocus="true"
							data-test-id="node-library-search"
						>
							<template #prefix>
								<N8nIcon icon="search" />
							</template>
						</N8nInput>
						<N8nCheckbox
							v-if="settingsStore.areTagsEnabled"
							v-model="standardOnly"
							:class="$style.standardFilter"
							:label="i18n.baseText('nodeLibrary.standardOnly')"
							:disabled="!hasStandardSources"
							data-test-id="node-library-standard-only"
						/>
					</div>

					<div
						v-if="filteredSources.length === 0"
						:class="$style.state"
						data-test-id="node-library-no-match"
					>
						<N8nText :bold="true" color="text-dark">
							{{ i18n.baseText('nodeLibrary.noMatch.title') }}
						</N8nText>
						<N8nText color="text-base" size="small">
							{{ i18n.baseText('nodeLibrary.noMatch.message') }}
						</N8nText>
					</div>

					<div v-else :class="$style.panes">
						<ul
							:class="$style.workflows"
							:aria-label="i18n.baseText('nodeLibrary.workflows.label')"
							data-test-id="node-library-workflows"
						>
							<li v-for="source in filteredSources" :key="source.workflowId">
								<button
									type="button"
									:class="[
										$style.workflow,
										{ [$style.activeWorkflow]: source.workflowId === activeSource?.workflowId },
									]"
									:aria-current="source.workflowId === activeSource?.workflowId"
									data-test-id="node-library-workflow"
									@click="activeWorkflowId = source.workflowId"
								>
									<span :class="$style.workflowName" :title="source.workflowName">
										{{ source.workflowName }}
									</span>
									<span :class="$style.workflowMeta">
										<N8nBadge v-if="source.isStandard" theme="primary" size="xsmall" :bold="true">
											{{ i18n.baseText('nodeLibrary.standard') }}
										</N8nBadge>
										<N8nText size="xsmall" color="text-light" :compact="true">
											{{ getNodeCountLabel(source.nodes.length) }}
										</N8nText>
									</span>
								</button>
							</li>
						</ul>

						<section v-if="activeSource" :class="$style.nodes" data-test-id="node-library-nodes">
							<header :class="$style.nodesHeader">
								<div :class="$style.nodesTitle">
									<N8nText
										:class="$style.nodesTitleText"
										:bold="true"
										color="text-dark"
										:title="activeSource.workflowName"
									>
										{{ activeSource.workflowName }}
									</N8nText>
									<N8nLink
										:to="activeSourceHref"
										:new-window="true"
										size="small"
										data-test-id="node-library-open-workflow"
									>
										{{ i18n.baseText('nodeLibrary.openWorkflow') }}
										<N8nIcon icon="external-link" size="small" />
									</N8nLink>
								</div>
								<N8nCheckbox
									:model-value="areAllVisibleSelected"
									:indeterminate="areSomeVisibleSelected"
									:label="i18n.baseText('nodeLibrary.selectAll')"
									data-test-id="node-library-select-all"
									@update:model-value="setAllVisibleSelected($event === true)"
								/>
							</header>

							<ul :class="$style.nodeList">
								<li v-for="node in activeSource.nodes" :key="node.name" :class="$style.node">
									<N8nCheckbox
										:class="$style.nodeCheckbox"
										:model-value="selectedNames.has(node.name)"
										data-test-id="node-library-node"
										@update:model-value="setNodeSelected(node.name, $event === true)"
									>
										<template #label>
											<span :class="$style.nodeLabel">
												<NodeIcon
													:node-type="nodeTypesStore.getNodeType(node.type, node.typeVersion)"
													:size="20"
												/>
												<span :class="$style.nodeText">
													<span :class="$style.nodeName" :title="node.name">{{ node.name }}</span>
													<span :class="$style.nodeDetails" :title="getDetailsLine(node)">
														{{ getDetailsLine(node) }}
													</span>
												</span>
											</span>
										</template>
									</N8nCheckbox>
								</li>
							</ul>
						</section>
					</div>

					<N8nText
						v-if="settingsStore.areTagsEnabled"
						:class="$style.hint"
						size="small"
						color="text-light"
					>
						{{
							i18n.baseText('nodeLibrary.standardHint', {
								interpolate: { tag: NODE_LIBRARY_STANDARD_TAG },
							})
						}}
					</N8nText>
				</template>
			</div>
		</template>

		<template #footer>
			<div :class="$style.footer">
				<N8nText size="small" color="text-base" data-test-id="node-library-selected-count">
					{{
						i18n.baseText('nodeLibrary.selectedCount', {
							adjustToNumber: selectedNames.size,
							interpolate: { count: String(selectedNames.size) },
						})
					}}
				</N8nText>
				<div :class="$style.footerActions">
					<N8nButton
						variant="subtle"
						:label="i18n.baseText('generic.cancel')"
						data-test-id="node-library-cancel"
						@click="closeModal"
					/>
					<N8nButton
						variant="solid"
						:label="i18n.baseText('nodeLibrary.add')"
						:disabled="selectedNames.size === 0"
						:loading="pulling"
						data-test-id="node-library-add"
						@click="pullSelectedNodes"
					/>
				</div>
			</div>
		</template>
	</Modal>
</template>

<style lang="scss" module>
.library {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--sm);
	height: 100%;
	min-height: 0;
}

.toolbar {
	display: flex;
	align-items: center;
	gap: var(--spacing--md);
}

.search {
	flex: 1;
}

.standardFilter {
	flex-shrink: 0;
	align-items: center;
}

.state {
	display: flex;
	flex: 1;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--spacing--2xs);
	text-align: center;
}

.panes {
	display: grid;
	grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
	flex: 1;
	min-height: 0;
	border: var(--border);
	border-radius: var(--radius--xs);
	overflow: hidden;
}

.workflows {
	margin: 0;
	padding: var(--spacing--4xs);
	list-style: none;
	overflow-y: auto;
	border-right: var(--border);
	background-color: var(--background--subtle);
}

.workflow {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--4xs);
	width: 100%;
	padding: var(--spacing--2xs) var(--spacing--xs);
	border: 0;
	border-radius: var(--radius--3xs);
	background: transparent;
	color: var(--text-color);
	font: inherit;
	text-align: left;
	cursor: pointer;

	&:hover {
		background-color: var(--background--hover);
	}

	&:focus-visible {
		outline: var(--focus--border-width) solid var(--color--secondary);
		outline-offset: calc(var(--focus--border-width) * -1);
	}
}

.activeWorkflow,
.activeWorkflow:hover {
	background-color: var(--background--active);
}

.workflowName {
	overflow: hidden;
	font-size: var(--font-size--sm);
	font-weight: var(--font-weight--medium);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.workflowMeta {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);
}

.nodes {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	background-color: var(--background--surface);
}

.nodesHeader {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--xs);
	padding: var(--spacing--sm);
	border-bottom: var(--border);
}

.nodesTitle {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--spacing--sm);

	a {
		flex-shrink: 0;
		white-space: nowrap;
	}
}

.nodesTitleText {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.nodeList {
	flex: 1;
	margin: 0;
	padding: var(--spacing--4xs) 0;
	list-style: none;
	overflow-y: auto;
}

.node {
	padding: 0 var(--spacing--sm);

	&:hover {
		background-color: var(--background--hover);
	}
}

.nodeCheckbox {
	display: flex;
	align-items: center;
	width: 100%;
	padding: var(--spacing--2xs) 0;

	// The label must be able to shrink. If not, a long details line gets no ellipsis.
	> label {
		min-width: 0;
	}
}

.nodeLabel {
	display: flex;
	align-items: center;
	gap: var(--spacing--xs);
	min-width: 0;
	cursor: pointer;
}

.nodeText {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--4xs);
	min-width: 0;
}

.nodeName {
	overflow: hidden;
	color: var(--text-color);
	font-size: var(--font-size--sm);
	line-height: var(--line-height--md);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.nodeDetails {
	overflow: hidden;
	color: var(--text-color--subtle);
	font-size: var(--font-size--2xs);
	line-height: var(--line-height--md);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.hint {
	flex-shrink: 0;
}

.footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--spacing--sm);
}

.footerActions {
	display: flex;
	gap: var(--spacing--2xs);
}
</style>
