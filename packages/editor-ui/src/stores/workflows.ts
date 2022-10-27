import { DEFAULT_NEW_WORKFLOW_NAME, DUPLICATE_POSTFFIX, MAX_WORKFLOW_NAME_LENGTH, PLACEHOLDER_EMPTY_WORKFLOW_ID, STORES } from "@/constants";
import { IExecutionResponse, IExecutionsCurrentSummaryExtended, IExecutionsSummary, INewWorkflowData, INodeUi, INodeUpdatePropertiesInformation, IPushDataExecutionFinished, IPushDataNodeExecuteAfter, IUpdateInformation, IWorkflowDb, IWorkflowsMap, workflowsState } from "@/Interface";
import { defineStore } from "pinia";
import { IConnection, IConnections, IDataObject, INode, INodeConnections, INodeCredentials, INodeCredentialsDetails, INodeExecutionData, INodeIssueData, IPinData, IRunData, ITaskData, IWorkflowSettings } from 'n8n-workflow';
import Vue from "vue";
import { useRootStore } from "./n8nRootStore";
import { getActiveWorkflows, getCurrentExecutions, getFinishedExecutions, getNewWorkflow, getWorkflows } from "@/api/workflows";
import { useUIStore } from "./ui";
import { getPairedItemsMapping } from "@/pairedItemUtils";
import { dataPinningEventBus } from "@/event-bus/data-pinning-event-bus";
import { isJsonKeyObject } from "@/utils";
import { stringSizeInBytes } from "@/components/helpers";

export const useWorkflowsStore = defineStore(STORES.WORKFLOWS, {
	state: (): workflowsState => ({
		workflow: {
			id: PLACEHOLDER_EMPTY_WORKFLOW_ID,
			name: '',
			active: false,
			createdAt: -1,
			updatedAt: -1,
			connections: {},
			nodes: [],
			settings: {},
			tags: [],
			pinData: {},
		},
		activeWorkflows: [],
		activeExecutions: [],
		currentWorkflowExecutions: [],
		activeWorkflowExecution: null,
		finishedExecutionsCount: 0,
		workflowExecutionData: null,
		workflowExecutionPairedItemMappings: {},
		workflowsById: {},
		subworkflowExecutionError: null,
		executionId: null,
		executingNode: null,
		executionWaitingForWebhook: false,
		nodeMetadata: {},
	}),
	getters: {
		// -------------------------------------------------------------------------
		// TODO: Rearrange this (adn actions) so order makes sense
		// -------------------------------------------------------------------------


		// currentWorkflowExecutions(): IExecutionsSummary[] {
		// 	return this.currentWorkflowExecutions;
		// },
		// getActiveWorkflowExecution(state: IWorkflowsState): IExecutionsSummary|null {
		// 	return this.activeWorkflowExecution;
		// },
		// getTotalFinishedExecutionsCount() : number {
		// 	return this.finishedExecutionsCount;
		// },
		// workflowExecutionPairedItemMappings() :  {[itemId: string]: Set<string>} {
		// 	return this.workflowExecutionPairedItemMappings;
		// },
		// subworkflowExecutionError() : Error | null {
		// 	return this.subworkflowExecutionError;
		// },
		// getActiveExecutions(): IExecutionsCurrentSummaryExtended[] {
		// 	return this.activeExecutions;
		// },
		// getActiveWorkflows(s) : string[] {
		// 	return this.activeWorkflows;
		// },
		// executingNode(): string | null {
		// 	return this.executingNode;
		// },
		// activeExecutionId() : string | null {
		// 	return this.executionId;
		// },
		// executionWaitingForWebhook(): boolean {
		// 	return this.executionWaitingForWebhook;
		// },
		// currentWorkflowExecutions(): IExecutionsSummary[] {
		// 	return this.currentWorkflowExecutions;
		// },
		// getActiveWorkflowExecution(): IExecutionsSummary|null {
		// 	return this.activeWorkflowExecution;
		// },
		// setCurrentWorkflowExecutions (, executions: IExecutionsSummary[]) {
		// 	this.currentWorkflowExecutions = executions;
		// },
		// setActiveWorkflowExecution (executionData: IExecutionsSummary): void {
		// 	this.activeWorkflowExecution = executionData;
		// },
		// setTotalFinishedExecutionsCount (count: number): void {
		// 	this.finishedExecutionsCount = count;
		// },
		allWorkflows() : IWorkflowDb[] {
			return Object.values(this.workflowsById)
				.sort((a, b) => a.name.localeCompare(b.name));
		},
		isNewWorkflow() : boolean {
			return this.workflow.id === PLACEHOLDER_EMPTY_WORKFLOW_ID;
		},
		isActive(): boolean {
			return this.workflow.active;
		},
		allConnections() : IConnections {
			return this.workflow.connections;
		},
		outgoingConnectionsByNodeName()  {
			return (nodeName: string): INodeConnections => {
				if (this.workflow.connections.hasOwnProperty(nodeName)) {
					return this.workflow.connections[nodeName];
				}
				return {};
			};
		},
		allNodes() : INodeUi[] {
			return this.workflow.nodes;
		},
		nodesByName() : { [name: string]: INodeUi } {
			return this.workflow.nodes.reduce((accu: { [name: string]: INodeUi }, node) => {
				accu[node.name] = node;
				return accu;
			}, {});
		},
		getNodeByName() {
			return (nodeName: string): INodeUi | null => this.nodesByName[nodeName] || null;
		},
		getNodeById() {
			return (nodeId: string): INodeUi | undefined => this.workflow.nodes.find((node: INodeUi) => node.id === nodeId);
		},
		nodesIssuesExist(): boolean {
			for (const node of this.workflow.nodes) {
				if (node.issues === undefined || Object.keys(node.issues).length === 0) {
					continue;
				}
				return true;
			}
			return false;
		},
		workflowTriggerNodes() : INodeUi[] {
			return this.workflow.nodes.filter((node: INodeUi) => {
				// TODO: Waiting for nodeType store migration...
				// const nodeType = getters['nodeTypes/getNodeType'](node.type, node.typeVersion);
				// return nodeType && nodeType.group.includes('trigger');
			});
		},
		currentWorkflowHasWebhookNode(): boolean {
			return !!this.workflow.nodes.find((node: INodeUi) => !!node.webhookId);
		},
		getExecutionDataById() {
			return (id: string) => this.currentWorkflowExecutions.find(execution => execution.id === id);
		},
		getAllLoadedFinishedExecutions() : IExecutionsSummary[] {
			return this.currentWorkflowExecutions.filter(ex => ex.finished === true || ex.stoppedAt !== undefined);
		},
		workflowName(): string {
			return this.workflow.name;
		},
		workflowId(): string {
			return this.workflow.id;
		},
		workflowSettings() : IWorkflowSettings {
			if (this.workflow.settings === undefined) {
				return {};
			}
			return this.workflow.settings;
		},
		workflowTags() : string[] {
			return this.workflow.tags as string[];
		},
		getWorkflowExecution() : IExecutionResponse | null {
			return this.workflowExecutionData;
		},
		getWorkflowRunData() : IRunData | null {
			if (!this.workflowExecutionData || !this.workflowExecutionData.data || !this.workflowExecutionData.data.resultData) {
				return null;
			}
			return this.workflowExecutionData.data.resultData.runData;
		},
		getWorkflowResultDataByNodeName() {
			return (nodeName: string): ITaskData[] | null => {
				const workflowRunData = this.getWorkflowRunData;;

				if (workflowRunData === null) {
					return null;
				}
				if (!workflowRunData.hasOwnProperty(nodeName)) {
					return null;
				}
				return workflowRunData[nodeName];
			};
		},
		getTotalFinishedExecutionsCount() : number {
			return this.finishedExecutionsCount;
		},
		getPinData(): IPinData | undefined {
			return this.workflow.pinData;
		},
		pinDataSize(): number {
			// TODO: Waiting for ndv store
			// const activeNode = {};//rootGetters['ndv/activeNodeName'];
			return this.workflow.nodes
				.reduce((acc, node) => {
					if (typeof node.pinData !== 'undefined' && node.name !== activeNode) {
						acc += stringSizeInBytes(node.pinData);
					}

					return acc;
				}, 0);
		},
	},
	actions: {
		// setSubworkflowExecutionError(subworkflowExecutionError: Error | null) {
		// 	this.subworkflowExecutionError = subworkflowExecutionError;
		// },
		// setActiveWorkflows(newActiveWorkflows: string[]) : void {
		// 	this.activeWorkflows = newActiveWorkflows;
		// },
		// setExecutingNode(executingNode: string) {
		// 	this.executingNode = executingNode;
		// },
		// setExecutionWaitingForWebhook(newWaiting: boolean) {
		// 	this.executionWaitingForWebhook = newWaiting;
		// },
		// setActiveExecutionId(executionId: string | null) {
		// 	this.executionId = executionId;
		// },
		addActiveExecution(newActiveExecution: IExecutionsCurrentSummaryExtended) : void {
			// Check if the execution exists already
			const activeExecution = this.activeExecutions.find(execution => {
				return execution.id === newActiveExecution.id;
			});

			if (activeExecution !== undefined) {
				// Exists already so no need to add it again
				if (activeExecution.workflowName === undefined) {
					activeExecution.workflowName = newActiveExecution.workflowName;
				}
				return;
			}
			this.activeExecutions.unshift(newActiveExecution);
		},
		finishActiveExecution(finishedActiveExecution: IPushDataExecutionFinished) : void {
			// Find the execution to set to finished
			const activeExecution = this.activeExecutions.find(execution => {
				return execution.id === finishedActiveExecution.executionId;
			});

			if (activeExecution === undefined) {
				// The execution could not be found
				return;
			}

			if (finishedActiveExecution.executionId !== undefined) {
				Vue.set(activeExecution, 'id', finishedActiveExecution.executionId);
			}

			Vue.set(activeExecution, 'finished', finishedActiveExecution.data.finished);
			Vue.set(activeExecution, 'stoppedAt', finishedActiveExecution.data.stoppedAt);
		},
		setActiveExecutions(newActiveExecutions: IExecutionsCurrentSummaryExtended[]) : void {
			Vue.set(this, 'activeExecutions', newActiveExecutions);
		},
		setWorkflows(workflows: IWorkflowDb[]) : void {
			this.workflowsById = workflows.reduce<IWorkflowsMap>((acc, workflow: IWorkflowDb) => {
				if (workflow.id) {
					acc[workflow.id] = workflow;
				}

				return acc;
			}, {});
		},
		deleteWorkflow(id: string) : void {
			const { [id]: deletedWorkflow, ...workflows } = this.workflowsById;
			this.workflowsById = workflows;
		},
		addWorkflow(workflow: IWorkflowDb) : void {
			Vue.set(this.workflowsById, workflow.id, workflow);
		},
		setWorkflowActive(workflowId: string): void {
			const uiStore = useUIStore();
			uiStore.stateIsDirty = false;
			const index = this.activeWorkflows.indexOf(workflowId);
			if (index !== -1) {
				this.activeWorkflows.push(workflowId);
			}
		},
		setWorkflowInactive(workflowId: string): void {
			const index = this.activeWorkflows.indexOf(workflowId);
			if (index !== -1) {
				this.activeWorkflows.splice(index, 1);
			}
		},
		async fetchActiveWorkflows (): Promise<string[]> {
			const rootStore = useRootStore();
			const activeWorkflows = await getActiveWorkflows(rootStore.getRestApiContext);
			this.activeWorkflows = activeWorkflows;
			return activeWorkflows;
		},
		setActive(newActive: boolean) : void {
			this.workflow.active = newActive;
		},
		addConnection(data: { connection: IConnection[], setStateDirty: boolean }): void {
			if (data.connection.length !== 2) {
				// All connections need two entries
				// TODO: Check if there is an error or whatever that is supposed to be returned
				return;
			}
			const uiStore = useUIStore();
			if (data.setStateDirty === true) {
				uiStore.stateIsDirty = true;
			}

			const sourceData: IConnection = data.connection[0];
			const destinationData: IConnection = data.connection[1];

			// Check if source node and type exist already and if not add them
			if (!this.workflow.connections.hasOwnProperty(sourceData.node)) {
				Vue.set(this.workflow.connections, sourceData.node, {});
			}
			if (!this.workflow.connections[sourceData.node].hasOwnProperty(sourceData.type)) {
				Vue.set(this.workflow.connections[sourceData.node], sourceData.type, []);
			}
			if (this.workflow.connections[sourceData.node][sourceData.type].length < (sourceData.index + 1)) {
				for (let i = this.workflow.connections[sourceData.node][sourceData.type].length; i <= sourceData.index; i++) {
					this.workflow.connections[sourceData.node][sourceData.type].push([]);
				}
			}

			// Check if the same connection exists already
			const checkProperties = ['index', 'node', 'type'];
			let propertyName: string;
			let connectionExists = false;
			connectionLoop:
			for (const existingConnection of this.workflow.connections[sourceData.node][sourceData.type][sourceData.index]) {
				for (propertyName of checkProperties) {
					if ((existingConnection as any)[propertyName] !== (destinationData as any)[propertyName]) { // tslint:disable-line:no-any
						continue connectionLoop;
					}
				}
				connectionExists = true;
				break;
			}
			// Add the new connection if it does not exist already
			if (connectionExists === false) {
				this.workflow.connections[sourceData.node][sourceData.type][sourceData.index].push(destinationData);
			}
		},
		removeConnection(data: { connection: IConnection[] }): void {
			const sourceData = data.connection[0];
			const destinationData = data.connection[1];

			if (!this.workflow.connections.hasOwnProperty(sourceData.node)) {
				return;
			}
			if (!this.workflow.connections[sourceData.node].hasOwnProperty(sourceData.type)) {
				return;
			}
			if (this.workflow.connections[sourceData.node][sourceData.type].length < (sourceData.index + 1)) {
				return;
			}
			const uiStore = useUIStore();
			uiStore.stateIsDirty = true;

			const connections = this.workflow.connections[sourceData.node][sourceData.type][sourceData.index];
			for (const index in connections) {
				if (connections[index].node === destinationData.node && connections[index].type === destinationData.type && connections[index].index === destinationData.index) {
					// Found the connection to remove
					connections.splice(parseInt(index, 10), 1);
				}
			}
		},
		removeAllConnections(data: { setStateDirty: boolean }): void {
			if (data && data.setStateDirty === true) {
				const uiStore = useUIStore();
				uiStore.stateIsDirty = true;
			}
			this.workflow.connections = {};
		},
		removeAllNodeConnection(node: INodeUi): void {
			const uiStore = useUIStore();
			uiStore.stateIsDirty = true;
			// Remove all source connections
			if (this.workflow.connections.hasOwnProperty(node.name)) {
				delete this.workflow.connections[node.name];
			}

			// Remove all destination connections
			const indexesToRemove = [];
			let sourceNode: string, type: string, sourceIndex: string, connectionIndex: string, connectionData: IConnection;
			for (sourceNode of Object.keys(this.workflow.connections)) {
				for (type of Object.keys(this.workflow.connections[sourceNode])) {
					for (sourceIndex of Object.keys(this.workflow.connections[sourceNode][type])) {
						indexesToRemove.length = 0;
						for (connectionIndex of Object.keys(this.workflow.connections[sourceNode][type][parseInt(sourceIndex, 10)])) {
							connectionData = this.workflow.connections[sourceNode][type][parseInt(sourceIndex, 10)][parseInt(connectionIndex, 10)];
							if (connectionData.node === node.name) {
								indexesToRemove.push(connectionIndex);
							}
						}

						indexesToRemove.forEach((index) => {
							this.workflow.connections[sourceNode][type][parseInt(sourceIndex, 10)].splice(parseInt(index, 10), 1);
						});
					}
				}
			}
		},
		renameNodeSelectedAndExecution(nameData: { old: any, new: any }): void {
			const uiStore = useUIStore();
			uiStore.stateIsDirty = true;
			// If node has any WorkflowResultData rename also that one that the data
			// does still get displayed also after node got renamed
			if (this.workflowExecutionData !== null && this.workflowExecutionData.data && this.workflowExecutionData.data.resultData.runData.hasOwnProperty(nameData.old)) {
				this.workflowExecutionData.data.resultData.runData[nameData.new] = this.workflowExecutionData.data.resultData.runData[nameData.old];
				delete this.workflowExecutionData.data.resultData.runData[nameData.old];
			}

			// In case the renamed node was last selected set it also there with the new name
			if (uiStore.lastSelectedNode === nameData.old) {
				uiStore.lastSelectedNode = nameData.new;
			}

			Vue.set(this.nodeMetadata, nameData.new, this.nodeMetadata[nameData.old]);
			Vue.delete(this.nodeMetadata, nameData.old);

			if (this.workflow.pinData && this.workflow.pinData.hasOwnProperty(nameData.old)) {
				Vue.set(this.workflow.pinData, nameData.new, this.workflow.pinData[nameData.old]);
				Vue.delete(this.workflow.pinData, nameData.old);
			}

			this.workflowExecutionPairedItemMappings = getPairedItemsMapping(this.workflowExecutionData);
		},
		resetAllNodesIssues(): boolean {
			this.workflow.nodes.forEach((node) => {
				node.issues = undefined;
			});
			return true;
		},
		setNodeIssue(nodeIssueData: INodeIssueData): boolean {
			const node = this.workflow.nodes.find(node => {
				return node.name === nodeIssueData.node;
			});
			if (!node) {
				return false;
			}
			if (nodeIssueData.value === null) {
				// Remove the value if one exists
				if (node.issues === undefined || node.issues[nodeIssueData.type] === undefined) {
					// No values for type exist so nothing has to get removed
					return true;
				}

				// @ts-ignore
				Vue.delete(node.issues, nodeIssueData.type);
			} else {
				if (node.issues === undefined) {
					Vue.set(node, 'issues', {});
				}
				// Set/Overwrite the value
				Vue.set(node.issues!, nodeIssueData.type, nodeIssueData.value);
			}
			return true;
		},
		setWorkflowId (id: string): void {
			this.workflow.id = id === 'new' ? PLACEHOLDER_EMPTY_WORKFLOW_ID : id;
		},
		setWorkflowName(data: { newName: string, setStateDirty: boolean }): void {
			if (data.setStateDirty === true) {
				const uiStore = useUIStore();
				uiStore.stateIsDirty = true;
			}
			this.workflow.name = data.newName;
		},
		// replace invalid credentials in workflow
		replaceInvalidWorkflowCredentials(data: {credentials: INodeCredentialsDetails, invalid: INodeCredentialsDetails, type: string}): void {
			this.workflow.nodes.forEach((node : INodeUi) => {
				const nodeCredentials: INodeCredentials | undefined = (node as unknown as INode).credentials;

				if (!nodeCredentials || !nodeCredentials[data.type]) {
					return;
				}

				const nodeCredentialDetails: INodeCredentialsDetails | string = nodeCredentials[data.type];

				if (typeof nodeCredentialDetails === 'string' && nodeCredentialDetails === data.invalid.name) {
					(node.credentials as INodeCredentials)[data.type] = data.credentials;
					return;
				}

				if (nodeCredentialDetails.id === null) {
					if (nodeCredentialDetails.name === data.invalid.name) {
						(node.credentials as INodeCredentials)[data.type] = data.credentials;
					}
					return;
				}

				if (nodeCredentialDetails.id === data.invalid.id) {
					(node.credentials as INodeCredentials)[data.type] = data.credentials;
				}
			});
		},
		addNode(nodeData: INodeUi): void {
			if (!nodeData.hasOwnProperty('name')) {
				// All nodes have to have a name
				// TODO: Check if there is an error or whatever that is supposed to be returned
				return;
			}
			this.workflow.nodes.push(nodeData);
		},
		removeNode(node: INodeUi): void {
			Vue.delete(this.nodeMetadata, node.name);

			if (this.workflow.pinData && this.workflow.pinData.hasOwnProperty(node.name)) {
				Vue.delete(this.workflow.pinData, node.name);
			}

			for (let i = 0; i < this.workflow.nodes.length; i++) {
				if (this.workflow.nodes[i].name === node.name) {
					this.workflow.nodes.splice(i, 1);
					const uiStore = useUIStore();
					uiStore.stateIsDirty = true;
					return;
				}
			}
		},
		removeAllNodes(data: { setStateDirty: boolean, removePinData: boolean }): void {
			if (data.setStateDirty === true) {
				const uiStore = useUIStore();
				uiStore.stateIsDirty = true;
			}

			if (data.removePinData) {
				Vue.set(this.workflow, 'pinData', {});
			}

			this.workflow.nodes.splice(0, this.workflow.nodes.length);
			this.nodeMetadata = {};
		},
		updateNodeProperties(updateInformation: INodeUpdatePropertiesInformation): void {
			// Find the node that should be updated
			const node = this.workflow.nodes.find(node => {
				return node.name === updateInformation.name;
			});

			if (node) {
				for (const key of Object.keys(updateInformation.properties)) {
					const uiStore = useUIStore();
					uiStore.stateIsDirty = true;
					Vue.set(node, key, updateInformation.properties[key]);
				}
			}
		},
		setNodeValue(updateInformation: IUpdateInformation): void {
			// Find the node that should be updated
			const node = this.workflow.nodes.find(node => {
				return node.name === updateInformation.name;
			});

			if (node === undefined || node === null) {
				throw new Error(`Node with the name "${updateInformation.name}" could not be found to set parameter.`);
			}

			const uiStore = useUIStore();
			uiStore.stateIsDirty = true;
			Vue.set(node, updateInformation.key, updateInformation.value);
		},
		setNodeParameters(updateInformation: IUpdateInformation): void {
			// Find the node that should be updated
			const node = this.workflow.nodes.find(node => {
				return node.name === updateInformation.name;
			});

			if (node === undefined || node === null) {
				throw new Error(`Node with the name "${updateInformation.name}" could not be found to set parameter.`);
			}

			const uiStore = useUIStore();
			uiStore.stateIsDirty = true;
			Vue.set(node, 'parameters', updateInformation.value);

			if (!this.nodeMetadata[node.name]) {
				Vue.set(this.nodeMetadata, node.name, {});
			}
			Vue.set(this.nodeMetadata[node.name], 'parametersLastUpdatedAt', Date.now());
		},
		setWorkflowExecutionData(workflowResultData: IExecutionResponse | null): void {
			this.workflowExecutionData = workflowResultData;
			this.workflowExecutionPairedItemMappings = getPairedItemsMapping(this.workflowExecutionData);
		},
		addNodeExecutionData(pushData: IPushDataNodeExecuteAfter): void {
			if (this.workflowExecutionData === null || !this.workflowExecutionData.data) {
				throw new Error('The "workflowExecutionData" is not initialized!');
			}
			if (this.workflowExecutionData.data.resultData.runData[pushData.nodeName] === undefined) {
				Vue.set(this.workflowExecutionData.data.resultData.runData, pushData.nodeName, []);
			}
			this.workflowExecutionData.data.resultData.runData[pushData.nodeName].push(pushData.data);
			this.workflowExecutionPairedItemMappings = getPairedItemsMapping(this.workflowExecutionData);
		},
		clearNodeExecutionData(nodeName: string): void {
			if (this.workflowExecutionData === null || !this.workflowExecutionData.data) {
				return;
			}
			Vue.delete(this.workflowExecutionData.data.resultData.runData, nodeName);
		},
		setWorkflowSettings(workflowSettings: IWorkflowSettings): void {
			Vue.set(this.workflow, 'settings', workflowSettings);
		},
		setWorkflowPinData(pinData: IPinData): void {
			Vue.set(this.workflow, 'pinData', pinData || {});
			dataPinningEventBus.$emit('pin-data', pinData || {});
		},
		setWorkflowTagIds(tags: string[]): void {
			Vue.set(this.workflow, 'tags', tags);
		},
		addWorkflowTagIds(tags: string[]): void {
			Vue.set(this.workflow, 'tags', [...new Set([...(this.workflow.tags || []), ...tags])]);
		},
		removeWorkflowTagId(tagId: string): void {
			const tags = this.workflow.tags as string[];
			const updated = tags.filter((id: string) => id !== tagId);
			Vue.set(this.workflow, 'tags', updated);
		},
		setWorkflow(workflow: IWorkflowDb): void {
			Vue.set(this, 'workflow', workflow);

			if (!this.workflow.hasOwnProperty('active')) {
				Vue.set(this.workflow, 'active', false);
			}
			if (!this.workflow.hasOwnProperty('connections')) {
				Vue.set(this.workflow, 'connections', {});
			}
			if (!this.workflow.hasOwnProperty('createdAt')) {
				Vue.set(this.workflow, 'createdAt', -1);
			}
			if (!this.workflow.hasOwnProperty('updatedAt')) {
				Vue.set(this.workflow, 'updatedAt', -1);
			}
			if (!this.workflow.hasOwnProperty('id')) {
				Vue.set(this.workflow, 'id', PLACEHOLDER_EMPTY_WORKFLOW_ID);
			}
			if (!this.workflow.hasOwnProperty('nodes')) {
				Vue.set(this.workflow, 'nodes', []);
			}
			if (!this.workflow.hasOwnProperty('settings')) {
				Vue.set(this.workflow, 'settings', {});
			}
		},
		pinData(payload: { node: INodeUi, data: INodeExecutionData[] }): void {
			if (!this.workflow.pinData) {
				Vue.set(this.workflow, 'pinData', {});
			}

			if (!Array.isArray(payload.data)) {
				payload.data = [payload.data];
			}

			const storedPinData = payload.data.map(item => isJsonKeyObject(item) ? item : { json: item });

			Vue.set(this.workflow.pinData!, payload.node.name, storedPinData);

			const uiStore = useUIStore();
			uiStore.stateIsDirty = true;

			dataPinningEventBus.$emit('pin-data', { [payload.node.name]: storedPinData });
		},
		unpinData(payload: { node: INodeUi }): void {
			if (!this.workflow.pinData) {
				Vue.set(this.workflow, 'pinData', {});
			}

			Vue.set(this.workflow.pinData!, payload.node.name, undefined);
			delete this.workflow.pinData![payload.node.name];

			const uiStore = useUIStore();
			uiStore.stateIsDirty = true;

			dataPinningEventBus.$emit('unpin-data', { [payload.node.name]: undefined });
		},
		pinDataByNodeName(nodeName: string): INodeExecutionData[] | undefined {
			if (!this.workflow.pinData || !this.workflow.pinData[nodeName]) return undefined;
			return this.workflow.pinData[nodeName].map((item: INodeExecutionData) => item.json);
		},
		activeNode(): INodeUi | null {
			// kept here for FE hooks
			// TODO: Update once hooks and NDV store are updated
			// const ndvStore = useNDVStore();
			// return ndvStore.activeNode;
			return null;
		},
		async fetchAllWorkflows(): Promise<IWorkflowDb[]> {
			const rootStore = useRootStore();
			const workflows = await getWorkflows(rootStore.getRestApiContext);
			this.setWorkflows(workflows);
			return workflows;
		},

		// ------------------------------------------------
		async getNewWorkflowData(name?: string): Promise<INewWorkflowData> {
			let workflowData = {
				name: '',
				onboardingFlowEnabled: false,
			};
			try {
				const rootStore = useRootStore();
				workflowData = await getNewWorkflow(rootStore.getRestApiContext, name);
			}
			catch (e) {
				// in case of error, default to original name
				workflowData.name = name || DEFAULT_NEW_WORKFLOW_NAME;
			}

			this.setWorkflowName({ newName: workflowData.name, setStateDirty: false });
			return workflowData;
		},

		async getDuplicateCurrentWorkflowName(currentWorkflowName: string): Promise<string> {
			if (currentWorkflowName && (currentWorkflowName.length + DUPLICATE_POSTFFIX.length) >= MAX_WORKFLOW_NAME_LENGTH) {
				return currentWorkflowName;
			}

			let newName = `${currentWorkflowName}${DUPLICATE_POSTFFIX}`;
			try {
				const rootStore = useRootStore();
				const newWorkflow = await getNewWorkflow(rootStore.getRestApiContext, newName );
				newName = newWorkflow.name;
			}
			catch (e) {
			}
			return newName;
		},
		async loadCurrentWorkflowExecutions (filter: { finished: boolean, status: string }): Promise<IExecutionsSummary[]> {
			let activeExecutions = [];
			let finishedExecutions = [];
			const requestFilter: IDataObject = { workflowId: this.workflowId };

			if (!this.workflowId) {
				return [];
			}
			try {
				const rootStore = useRootStore();
				if (filter.status === ''|| !filter.finished) {
					activeExecutions = await getCurrentExecutions(rootStore.getRestApiContext, requestFilter);
				}
				if (filter.status === '' || filter.finished) {
					if (filter.status === 'waiting') {
						requestFilter.waitTill = true;
					} else if (filter.status !== '')  {
						requestFilter.finished = filter.status === 'success';
					}
					finishedExecutions = await getFinishedExecutions(rootStore.getRestApiContext, requestFilter);
				}
				// context.commit('setTotalFinishedExecutionsCount', finishedExecutions.count);
				return [...activeExecutions, ...finishedExecutions.results || []];
			} catch (error) {
				throw(error);
			}
		},
		deleteExecution (execution: IExecutionsSummary): void {
			this.currentWorkflowExecutions.splice(this.currentWorkflowExecutions.indexOf(execution), 1);
		},
	},
});
