import type {
	EnvProviderState,
	IExecuteData,
	INodeExecutionData,
	IPinData,
	IRunData,
	IRunExecutionData,
	ITaskDataConnections,
	IWorkflowExecuteAdditionalData,
	Workflow,
	WorkflowParameters,
} from 'n8n-workflow';

import type { DataRequestResponse, PartialAdditionalData, TaskData } from './task-manager';
import type { N8nMessage } from '../runner-types';

/**
 * Builds the response to a data request coming from a Task Runner. Tries to minimize
 * the amount of data that is sent to the runner by only providing what is requested.
 */
export class DataRequestResponseBuilder {
	private requestedNodeNames = new Set<string>();

	constructor(
		private readonly taskData: TaskData,
		private readonly requestParams: N8nMessage.ToRequester.TaskDataRequest['requestParams'],
	) {
		this.requestedNodeNames = new Set(requestParams.dataOfNodes);

		if (this.requestParams.prevNode && this.requestParams.dataOfNodes !== 'all') {
			this.requestedNodeNames.add(this.determinePrevNodeName());
		}
	}

	/**
	 * Builds a response to the data request
	 */
	build(): DataRequestResponse {
		const taskData = this.taskData;

		return {
			workflow: this.buildWorkflow(taskData.workflow),
			connectionInputData: this.buildConnectionInputData(taskData.connectionInputData),
			inputData: this.buildInputData(taskData.inputData),
			itemIndex: taskData.itemIndex,
			activeNodeName: taskData.activeNodeName,
			contextNodeName: taskData.contextNodeName,
			defaultReturnRunIndex: taskData.defaultReturnRunIndex,
			mode: taskData.mode,
			envProviderState: this.buildEnvProviderState(taskData.envProviderState),
			node: taskData.node, // The current node being executed
			runExecutionData: this.buildRunExecutionData(taskData.runExecutionData),
			runIndex: taskData.runIndex,
			selfData: taskData.selfData,
			siblingParameters: taskData.siblingParameters,
			executeData: this.buildExecuteData(taskData.executeData),
			additionalData: this.buildAdditionalData(taskData.additionalData),
		};
	}

	buildAdditionalData(additionalData: IWorkflowExecuteAdditionalData): PartialAdditionalData {
		return {
			formWaitingBaseUrl: additionalData.formWaitingBaseUrl,
			instanceBaseUrl: additionalData.instanceBaseUrl,
			restApiUrl: additionalData.restApiUrl,
			variables: additionalData.variables,
			webhookBaseUrl: additionalData.webhookBaseUrl,
			webhookTestBaseUrl: additionalData.webhookTestBaseUrl,
			webhookWaitingBaseUrl: additionalData.webhookWaitingBaseUrl,
			currentNodeParameters: additionalData.currentNodeParameters,
			executionId: additionalData.executionId,
			executionTimeoutTimestamp: additionalData.executionTimeoutTimestamp,
			restartExecutionId: additionalData.restartExecutionId,
			userId: additionalData.userId,
		};
	}

	buildExecuteData(executeData: IExecuteData | undefined): IExecuteData | undefined {
		if (executeData === undefined) {
			return undefined;
		}

		return {
			node: executeData.node, // The current node being executed
			data: this.requestParams.input ? executeData.data : {},
			source: executeData.source,
		};
	}

	buildRunExecutionData(runExecutionData: IRunExecutionData): IRunExecutionData {
		if (this.requestParams.dataOfNodes === 'all') {
			return runExecutionData;
		}

		return {
			startData: runExecutionData.startData,
			resultData: {
				error: runExecutionData.resultData.error,
				lastNodeExecuted: runExecutionData.resultData.lastNodeExecuted,
				metadata: runExecutionData.resultData.metadata,
				runData: this.buildRunData(runExecutionData.resultData.runData),
				pinData: this.buildPinData(runExecutionData.resultData.pinData),
			},
			executionData: runExecutionData.executionData
				? {
						// TODO: Figure out what these two are and can they be filtered
						contextData: runExecutionData.executionData?.contextData,
						nodeExecutionStack: runExecutionData.executionData.nodeExecutionStack,

						metadata: runExecutionData.executionData.metadata,
						waitingExecution: runExecutionData.executionData.waitingExecution,
						waitingExecutionSource: runExecutionData.executionData.waitingExecutionSource,
					}
				: undefined,
		};
	}

	buildRunData(runData: IRunData): IRunData {
		return this.filterObjectByNodeNames(runData);
	}

	buildPinData(pinData: IPinData | undefined): IPinData | undefined {
		return pinData ? this.filterObjectByNodeNames(pinData) : undefined;
	}

	buildEnvProviderState(envProviderState: EnvProviderState): EnvProviderState {
		if (this.requestParams.env) {
			return envProviderState;
		}

		return {
			env: {},
			isEnvAccessBlocked: envProviderState.isEnvAccessBlocked,
			isProcessAvailable: envProviderState.isProcessAvailable,
		};
	}

	buildInputData(inputData: ITaskDataConnections): ITaskDataConnections {
		if (this.requestParams.input) {
			return inputData;
		}

		return {};
	}

	buildConnectionInputData(connectionInputData: INodeExecutionData[]): INodeExecutionData[] {
		if (this.requestParams.input) {
			return connectionInputData;
		}

		return [];
	}

	private buildWorkflow(workflow: Workflow): Omit<WorkflowParameters, 'nodeTypes'> {
		return {
			id: workflow.id,
			name: workflow.name,
			active: workflow.active,
			connections: workflow.connectionsBySourceNode,
			nodes: Object.values(workflow.nodes),
			pinData: workflow.pinData,
			settings: workflow.settings,
			staticData: workflow.staticData,
		};
	}

	/**
	 * Assuming the given `obj` is an object where the keys are node names,
	 * filters the object to only include the node names that are requested.
	 */
	private filterObjectByNodeNames<T extends Record<string, unknown>>(obj: T): T {
		if (this.requestParams.dataOfNodes === 'all') {
			return obj;
		}

		const filteredObj: T = {} as T;

		for (const nodeName in obj) {
			if (!Object.prototype.hasOwnProperty.call(obj, nodeName)) {
				continue;
			}

			if (this.requestedNodeNames.has(nodeName)) {
				filteredObj[nodeName] = obj[nodeName];
			}
		}

		return filteredObj;
	}

	private determinePrevNodeName(): string {
		const sourceData = this.taskData.executeData?.source?.main?.[0];
		if (!sourceData) {
			return '';
		}

		return sourceData.previousNode;
	}
}
