/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { WorkflowsConfig } from '@n8n/config';
import { Service } from '@n8n/di';
import { chunk } from 'lodash';
import {
	ActiveWorkflows,
	ErrorReporter,
	InstanceSettings,
	Logger,
	PollContext,
	TriggerContext,
	type IGetExecutePollFunctions,
	type IGetExecuteTriggerFunctions,
} from 'n8n-core';
import type {
	ExecutionError,
	IDeferredPromise,
	IExecuteResponsePromiseData,
	INode,
	INodeExecutionData,
	IRun,
	IWorkflowBase,
	IWorkflowExecuteAdditionalData,
	WorkflowActivateMode,
	WorkflowExecuteMode,
	INodeType,
} from 'n8n-workflow';
import {
	Workflow,
	WorkflowActivationError,
	WebhookPathTakenError,
	ApplicationError,
} from 'n8n-workflow';

import { ActivationErrorsService } from '@/activation-errors.service';
import { ActiveExecutions } from '@/active-executions';
import {
	STARTING_NODES,
	WORKFLOW_REACTIVATE_INITIAL_TIMEOUT,
	WORKFLOW_REACTIVATE_MAX_TIMEOUT,
} from '@/constants';
import type { WorkflowEntity } from '@/databases/entities/workflow-entity';
import { WorkflowRepository } from '@/databases/repositories/workflow.repository';
import { OnShutdown } from '@/decorators/on-shutdown';
import { executeErrorWorkflow } from '@/execution-lifecycle/execute-error-workflow';
import { ExecutionService } from '@/executions/execution.service';
import { ExternalHooks } from '@/external-hooks';
import type { IWorkflowDb } from '@/interfaces';
import { NodeTypes } from '@/node-types';
import { Publisher } from '@/scaling/pubsub/publisher.service';
import { ActiveWorkflowsService } from '@/services/active-workflows.service';
import { OrchestrationService } from '@/services/orchestration.service';
import * as WebhookHelpers from '@/webhooks/webhook-helpers';
import { WebhookService } from '@/webhooks/webhook.service';
import * as WorkflowExecuteAdditionalData from '@/workflow-execute-additional-data';
import { WorkflowExecutionService } from '@/workflows/workflow-execution.service';
import { WorkflowStaticDataService } from '@/workflows/workflow-static-data.service';

interface QueuedActivation {
	activationMode: WorkflowActivateMode;
	lastTimeout: number;
	timeout: NodeJS.Timeout;
	workflowData: IWorkflowDb;
}

@Service()
export class ActiveWorkflowManager {
	private queuedActivations: { [workflowId: string]: QueuedActivation } = {};

	constructor(
		private readonly logger: Logger,
		private readonly errorReporter: ErrorReporter,
		private readonly activeWorkflows: ActiveWorkflows,
		private readonly activeExecutions: ActiveExecutions,
		private readonly externalHooks: ExternalHooks,
		private readonly nodeTypes: NodeTypes,
		private readonly webhookService: WebhookService,
		private readonly workflowRepository: WorkflowRepository,
		private readonly orchestrationService: OrchestrationService,
		private readonly activationErrorsService: ActivationErrorsService,
		private readonly executionService: ExecutionService,
		private readonly workflowStaticDataService: WorkflowStaticDataService,
		private readonly activeWorkflowsService: ActiveWorkflowsService,
		private readonly workflowExecutionService: WorkflowExecutionService,
		private readonly instanceSettings: InstanceSettings,
		private readonly publisher: Publisher,
		private readonly workflowsConfig: WorkflowsConfig,
	) {}

	async init() {
		await this.orchestrationService.init();

		await this.addActiveWorkflows('init');

		await this.externalHooks.run('activeWorkflows.initialized');
	}

	async getAllWorkflowActivationErrors() {
		return await this.activationErrorsService.getAll();
	}

	/**
	 * Removes all the currently active workflows from memory.
	 */
	async removeAll() {
		let activeWorkflowIds: string[] = [];
		this.logger.debug('Call to remove all active workflows received (removeAll)');

		activeWorkflowIds.push(...this.activeWorkflows.allActiveWorkflows());

		const activeWorkflows = await this.activeWorkflowsService.getAllActiveIdsInStorage();
		activeWorkflowIds = [...activeWorkflowIds, ...activeWorkflows];
		// Make sure IDs are unique
		activeWorkflowIds = Array.from(new Set(activeWorkflowIds));

		const removePromises = [];
		for (const workflowId of activeWorkflowIds) {
			removePromises.push(this.remove(workflowId));
		}

		await Promise.all(removePromises);
	}

	/**
	 * Returns the ids of the currently active workflows from memory.
	 */
	allActiveInMemory() {
		return this.activeWorkflows.allActiveWorkflows();
	}

	/**
	 * Returns if the workflow is stored as `active`.
	 *
	 * @important Do not confuse with `ActiveWorkflows.isActive()`,
	 * which checks if the workflow is active in memory.
	 */
	async isActive(workflowId: string) {
		const workflow = await this.workflowRepository.findOne({
			select: ['active'],
			where: { id: workflowId },
		});

		return !!workflow?.active;
	}

	/**
	 * Register workflow-defined webhooks in the `workflow_entity` table.
	 */
	async addWebhooks(
		workflow: Workflow,
		additionalData: IWorkflowExecuteAdditionalData,
		mode: WorkflowExecuteMode,
		activation: WorkflowActivateMode,
	) {
		const webhooks = WebhookHelpers.getWorkflowWebhooks(workflow, additionalData, undefined, true);
		let path = '';

		if (webhooks.length === 0) return;

		this.logger.debug(`Adding webhooks for workflow "${workflow.name}" (ID ${workflow.id})`);

		for (const webhookData of webhooks) {
			const node = workflow.getNode(webhookData.node) as INode;
			node.name = webhookData.node;

			path = webhookData.path;

			const webhook = this.webhookService.createWebhook({
				workflowId: webhookData.workflowId,
				webhookPath: path,
				node: node.name,
				method: webhookData.httpMethod,
			});

			if (webhook.webhookPath.startsWith('/')) {
				webhook.webhookPath = webhook.webhookPath.slice(1);
			}
			if (webhook.webhookPath.endsWith('/')) {
				webhook.webhookPath = webhook.webhookPath.slice(0, -1);
			}

			if ((path.startsWith(':') || path.includes('/:')) && node.webhookId) {
				webhook.webhookId = node.webhookId;
				webhook.pathLength = webhook.webhookPath.split('/').length;
			}

			try {
				// TODO: this should happen in a transaction, that way we don't need to manually remove this in `catch`
				await this.webhookService.storeWebhook(webhook);
				await this.webhookService.createWebhookIfNotExists(workflow, webhookData, mode, activation);
			} catch (error) {
				if (activation === 'init' && error.name === 'QueryFailedError') {
					// n8n does not remove the registered webhooks on exit.
					// This means that further initializations will always fail
					// when inserting to database. This is why we ignore this error
					// as it's expected to happen.

					continue;
				}

				try {
					await this.clearWebhooks(workflow.id);
				} catch (error1) {
					this.errorReporter.error(error1);
					this.logger.error(
						`Could not remove webhooks of workflow "${workflow.id}" because of error: "${error1.message}"`,
					);
				}

				// if it's a workflow from the insert
				// TODO check if there is standard error code for duplicate key violation that works
				// with all databases
				if (error instanceof Error && error.name === 'QueryFailedError') {
					error = new WebhookPathTakenError(webhook.node, error);
				} else if (error.detail) {
					// it's a error running the webhook methods (checkExists, create)
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					error.message = error.detail;
				}

				throw error;
			}
		}
		await this.webhookService.populateCache();

		await this.workflowStaticDataService.saveStaticData(workflow);
	}

	/**
	 * Remove all webhooks of a workflow from the database, and
	 * deregister those webhooks from external services.
	 */
	async clearWebhooks(workflowId: string) {
		const workflowData = await this.workflowRepository.findOne({
			where: { id: workflowId },
		});

		if (workflowData === null) {
			throw new ApplicationError('Could not find workflow', { extra: { workflowId } });
		}

		const workflow = new Workflow({
			id: workflowId,
			name: workflowData.name,
			nodes: workflowData.nodes,
			connections: workflowData.connections,
			active: workflowData.active,
			nodeTypes: this.nodeTypes,
			staticData: workflowData.staticData,
			settings: workflowData.settings,
		});

		const mode = 'internal';

		const additionalData = await WorkflowExecuteAdditionalData.getBase();

		const webhooks = WebhookHelpers.getWorkflowWebhooks(workflow, additionalData, undefined, true);

		for (const webhookData of webhooks) {
			await this.webhookService.deleteWebhook(workflow, webhookData, mode, 'update');
		}

		await this.workflowStaticDataService.saveStaticData(workflow);

		await this.webhookService.deleteWorkflowWebhooks(workflowId);
	}

	/**
	 * Return poll function which gets the global functions from n8n-core
	 * and overwrites the emit to be able to start it in subprocess
	 */
	getExecutePollFunctions(
		workflowData: IWorkflowDb,
		additionalData: IWorkflowExecuteAdditionalData,
		mode: WorkflowExecuteMode,
		activation: WorkflowActivateMode,
	): IGetExecutePollFunctions {
		return (workflow: Workflow, node: INode) => {
			const __emit = (
				data: INodeExecutionData[][],
				responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
				donePromise?: IDeferredPromise<IRun | undefined>,
			) => {
				this.logger.debug(`Received event to trigger execution for workflow "${workflow.name}"`);
				void this.workflowStaticDataService.saveStaticData(workflow);
				const executePromise = this.workflowExecutionService.runWorkflow(
					workflowData,
					node,
					data,
					additionalData,
					mode,
					responsePromise,
				);

				if (donePromise) {
					void executePromise.then((executionId) => {
						this.activeExecutions
							.getPostExecutePromise(executionId)
							.then(donePromise.resolve)
							.catch(donePromise.reject);
					});
				} else {
					void executePromise.catch((error: Error) => this.logger.error(error.message, { error }));
				}
			};

			const __emitError = (error: ExecutionError) => {
				void this.executionService
					.createErrorExecution(error, node, workflowData, workflow, mode)
					.then(() => {
						this.executeErrorWorkflow(error, workflowData, mode);
					});
			};

			return new PollContext(workflow, node, additionalData, mode, activation, __emit, __emitError);
		};
	}

	/**
	 * Return trigger function which gets the global functions from n8n-core
	 * and overwrites the emit to be able to start it in subprocess
	 */
	getExecuteTriggerFunctions(
		workflowData: IWorkflowDb,
		additionalData: IWorkflowExecuteAdditionalData,
		mode: WorkflowExecuteMode,
		activation: WorkflowActivateMode,
	): IGetExecuteTriggerFunctions {
		return (workflow: Workflow, node: INode) => {
			const emit = (
				data: INodeExecutionData[][],
				responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
				donePromise?: IDeferredPromise<IRun | undefined>,
			) => {
				this.logger.debug(`Received trigger for workflow "${workflow.name}"`);
				void this.workflowStaticDataService.saveStaticData(workflow);

				const executePromise = this.workflowExecutionService.runWorkflow(
					workflowData,
					node,
					data,
					additionalData,
					mode,
					responsePromise,
				);

				if (donePromise) {
					void executePromise.then((executionId) => {
						this.activeExecutions
							.getPostExecutePromise(executionId)
							.then(donePromise.resolve)
							.catch(donePromise.reject);
					});
				} else {
					executePromise.catch((error: Error) => this.logger.error(error.message, { error }));
				}
			};
			const emitError = (error: Error): void => {
				this.logger.info(
					`The trigger node "${node.name}" of workflow "${workflowData.name}" failed with the error: "${error.message}". Will try to reactivate.`,
					{
						nodeName: node.name,
						workflowId: workflowData.id,
						workflowName: workflowData.name,
					},
				);

				// Remove the workflow as "active"

				void this.activeWorkflows.remove(workflowData.id);

				void this.activationErrorsService.register(workflowData.id, error.message);

				// Run Error Workflow if defined
				const activationError = new WorkflowActivationError(
					`There was a problem with the trigger node "${node.name}", for that reason did the workflow had to be deactivated`,
					{ cause: error, node },
				);
				this.executeErrorWorkflow(activationError, workflowData, mode);

				this.addQueuedWorkflowActivation(activation, workflowData as WorkflowEntity);
			};
			return new TriggerContext(workflow, node, additionalData, mode, activation, emit, emitError);
		};
	}

	executeErrorWorkflow(
		error: ExecutionError,
		workflowData: IWorkflowBase,
		mode: WorkflowExecuteMode,
	) {
		const fullRunData: IRun = {
			data: {
				resultData: {
					error,
					runData: {},
				},
			},
			finished: false,
			mode,
			startedAt: new Date(),
			stoppedAt: new Date(),
			status: 'running',
		};

		executeErrorWorkflow(workflowData, fullRunData, mode);
	}

	/**
	 * Register as active in memory all workflows stored as `active`,
	 * only on instance init or (in multi-main setup) on leadership change.
	 */
	async addActiveWorkflows(activationMode: 'init' | 'leadershipChange') {
		const dbWorkflows = await this.workflowRepository.getAllActive();

		if (dbWorkflows.length === 0) return;

		if (this.instanceSettings.isLeader) {
			this.logger.info(' ================================');
			this.logger.info('   Start Active Workflows:');
			this.logger.info(' ================================');
		}

		const batches = chunk(dbWorkflows, this.workflowsConfig.activationBatchSize);

		for (const batch of batches) {
			const activationPromises = batch.map(async (dbWorkflow) => {
				await this.activateWorkflow(dbWorkflow, activationMode);
			});

			await Promise.all(activationPromises);
		}

		this.logger.debug('Finished activating workflows (startup)');
	}

	private async activateWorkflow(
		dbWorkflow: WorkflowEntity,
		activationMode: 'init' | 'leadershipChange',
	) {
		try {
			const wasActivated = await this.add(dbWorkflow.id, activationMode, dbWorkflow, {
				shouldPublish: false,
			});
			if (wasActivated) {
				this.logger.info(`   - ${dbWorkflow.display()})`);
				this.logger.info('     => Started');
				this.logger.debug(`Successfully started workflow ${dbWorkflow.display()}`, {
					workflowName: dbWorkflow.name,
					workflowId: dbWorkflow.id,
				});
			}
		} catch (error) {
			this.errorReporter.error(error);
			this.logger.info(
				`     => ERROR: Workflow ${dbWorkflow.display()} could not be activated on first try, keep on trying if not an auth issue`,
			);

			this.logger.info(`               ${error.message}`);
			this.logger.error(
				`Issue on initial workflow activation try of ${dbWorkflow.display()} (startup)`,
				{
					workflowName: dbWorkflow.name,
					workflowId: dbWorkflow.id,
				},
			);

			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
			this.executeErrorWorkflow(error, dbWorkflow, 'internal');

			// do not keep trying to activate on authorization error
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			if (error.message.includes('Authorization')) return;

			this.addQueuedWorkflowActivation('init', dbWorkflow);
		}
	}

	async clearAllActivationErrors() {
		this.logger.debug('Clearing all activation errors');

		await this.activationErrorsService.clearAll();
	}

	async addAllTriggerAndPollerBasedWorkflows() {
		this.logger.debug('Adding all trigger- and poller-based workflows');

		await this.addActiveWorkflows('leadershipChange');
	}

	@OnShutdown()
	async removeAllTriggerAndPollerBasedWorkflows() {
		this.logger.debug('Removing all trigger- and poller-based workflows');

		await this.activeWorkflows.removeAllTriggerAndPollerBasedWorkflows();
	}

	/**
	 * Register a workflow as active.
	 *
	 * An activatable workflow may be webhook-, trigger-, or poller-based:
	 *
	 * - A `webhook` is an HTTP-based node that can start a workflow when called
	 * by a third-party service.
	 * - A `poller` is an HTTP-based node that can start a workflow when detecting
	 * a change while regularly checking a third-party service.
	 * - A `trigger` is any non-HTTP-based node that can start a workflow, e.g. a
	 * time-based node like Schedule Trigger or a message-queue-based node.
	 *
	 * Note that despite the name, most "trigger" nodes are actually webhook-based
	 * and so qualify as `webhook`, e.g. Stripe Trigger.
	 *
	 * Triggers and pollers are registered as active in memory at `ActiveWorkflows`,
	 * but webhooks are registered by being entered in the `webhook_entity` table,
	 * since webhooks do not require continuous execution.
	 */
	async add(
		workflowId: string,
		activationMode: WorkflowActivateMode,
		existingWorkflow?: WorkflowEntity,
		{ shouldPublish } = { shouldPublish: true },
	) {
		if (this.instanceSettings.isMultiMain && shouldPublish) {
			void this.publisher.publishCommand({
				command: 'add-webhooks-triggers-and-pollers',
				payload: { workflowId },
			});

			return;
		}

		let workflow: Workflow;

		const shouldAddWebhooks = this.shouldAddWebhooks(activationMode);
		const shouldAddTriggersAndPollers = this.shouldAddTriggersAndPollers();

		const shouldDisplayActivationMessage =
			(shouldAddWebhooks || shouldAddTriggersAndPollers) &&
			['init', 'leadershipChange'].includes(activationMode);

		try {
			const dbWorkflow = existingWorkflow ?? (await this.workflowRepository.findById(workflowId));

			if (!dbWorkflow) {
				throw new WorkflowActivationError(`Failed to find workflow with ID "${workflowId}"`, {
					level: 'warning',
				});
			}

			if (['init', 'leadershipChange'].includes(activationMode) && !dbWorkflow.active) {
				this.logger.debug(`Skipping workflow ${dbWorkflow.display()} as it is no longer active`, {
					workflowId: dbWorkflow.id,
				});
				return false;
			}

			if (shouldDisplayActivationMessage) {
				this.logger.debug(`Initializing active workflow ${dbWorkflow.display()} (startup)`, {
					workflowName: dbWorkflow.name,
					workflowId: dbWorkflow.id,
				});
			}

			workflow = new Workflow({
				id: dbWorkflow.id,
				name: dbWorkflow.name,
				nodes: dbWorkflow.nodes,
				connections: dbWorkflow.connections,
				active: dbWorkflow.active,
				nodeTypes: this.nodeTypes,
				staticData: dbWorkflow.staticData,
				settings: dbWorkflow.settings,
			});

			const canBeActivated = this.checkIfWorkflowCanBeActivated(workflow, STARTING_NODES);

			if (!canBeActivated) {
				throw new WorkflowActivationError(
					`Workflow ${dbWorkflow.display()} has no node to start the workflow - at least one trigger, poller or webhook node is required`,
					{ level: 'warning' },
				);
			}

			const additionalData = await WorkflowExecuteAdditionalData.getBase();

			if (shouldAddWebhooks) {
				await this.addWebhooks(workflow, additionalData, 'trigger', activationMode);
			}

			if (shouldAddTriggersAndPollers) {
				await this.addTriggersAndPollers(dbWorkflow, workflow, {
					activationMode,
					executionMode: 'trigger',
					additionalData,
				});
			}

			// Workflow got now successfully activated so make sure nothing is left in the queue
			this.removeQueuedWorkflowActivation(workflowId);

			await this.activationErrorsService.deregister(workflowId);

			const triggerCount = this.countTriggers(workflow, additionalData);
			await this.workflowRepository.updateWorkflowTriggerCount(workflow.id, triggerCount);
		} catch (e) {
			const error = e instanceof Error ? e : new Error(`${e}`);
			await this.activationErrorsService.register(workflowId, error.message);

			throw e;
		}

		// If for example webhooks get created it sometimes has to save the
		// id of them in the static data. So make sure that data gets persisted.
		await this.workflowStaticDataService.saveStaticData(workflow);

		return shouldDisplayActivationMessage;
	}

	/**
	 * A workflow can only be activated if it has a node which has either triggers
	 * or webhooks defined.
	 *
	 * @param {string[]} [ignoreNodeTypes] Node-types to ignore in the check
	 */
	checkIfWorkflowCanBeActivated(workflow: Workflow, ignoreNodeTypes?: string[]): boolean {
		let node: INode;
		let nodeType: INodeType | undefined;

		for (const nodeName of Object.keys(workflow.nodes)) {
			node = workflow.nodes[nodeName];

			if (node.disabled === true) {
				// Deactivated nodes can not trigger a run so ignore
				continue;
			}

			if (ignoreNodeTypes !== undefined && ignoreNodeTypes.includes(node.type)) {
				continue;
			}

			nodeType = this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

			if (nodeType === undefined) {
				// Type is not known so check is not possible
				continue;
			}

			if (
				nodeType.poll !== undefined ||
				nodeType.trigger !== undefined ||
				nodeType.webhook !== undefined
			) {
				// Is a trigger node. So workflow can be activated.
				return true;
			}
		}

		return false;
	}

	/**
	 * Count all triggers in the workflow, excluding Manual Trigger.
	 */
	private countTriggers(workflow: Workflow, additionalData: IWorkflowExecuteAdditionalData) {
		const triggerFilter = (nodeType: INodeType) =>
			!!nodeType.trigger && !nodeType.description.name.includes('manualTrigger');

		return (
			workflow.queryNodes(triggerFilter).length +
			workflow.getPollNodes().length +
			WebhookHelpers.getWorkflowWebhooks(workflow, additionalData, undefined, true).length
		);
	}

	/**
	 * Add a workflow to the activation queue.
	 * Meaning it will keep on trying to activate it in regular
	 * amounts indefinitely.
	 */
	private addQueuedWorkflowActivation(
		activationMode: WorkflowActivateMode,
		workflowData: WorkflowEntity,
	) {
		const workflowId = workflowData.id;
		const workflowName = workflowData.name;

		const retryFunction = async () => {
			this.logger.info(`Try to activate workflow "${workflowName}" (${workflowId})`, {
				workflowId,
				workflowName,
			});
			try {
				await this.add(workflowId, activationMode, workflowData);
			} catch (error) {
				this.errorReporter.error(error);
				let lastTimeout = this.queuedActivations[workflowId].lastTimeout;
				if (lastTimeout < WORKFLOW_REACTIVATE_MAX_TIMEOUT) {
					lastTimeout = Math.min(lastTimeout * 2, WORKFLOW_REACTIVATE_MAX_TIMEOUT);
				}

				this.logger.info(
					` -> Activation of workflow "${workflowName}" (${workflowId}) did fail with error: "${
						error.message as string
					}" | retry in ${Math.floor(lastTimeout / 1000)} seconds`,
					{
						workflowId,
						workflowName,
					},
				);

				this.queuedActivations[workflowId].lastTimeout = lastTimeout;
				this.queuedActivations[workflowId].timeout = setTimeout(retryFunction, lastTimeout);
				return;
			}
			this.logger.info(
				` -> Activation of workflow "${workflowName}" (${workflowId}) was successful!`,
				{
					workflowId,
					workflowName,
				},
			);
		};

		// Just to be sure that there is not chance that for any reason
		// multiple run in parallel
		this.removeQueuedWorkflowActivation(workflowId);

		this.queuedActivations[workflowId] = {
			activationMode,
			lastTimeout: WORKFLOW_REACTIVATE_INITIAL_TIMEOUT,
			timeout: setTimeout(retryFunction, WORKFLOW_REACTIVATE_INITIAL_TIMEOUT),
			workflowData,
		};
	}

	/**
	 * Remove a workflow from the activation queue
	 */
	private removeQueuedWorkflowActivation(workflowId: string) {
		if (this.queuedActivations[workflowId]) {
			clearTimeout(this.queuedActivations[workflowId].timeout);
			delete this.queuedActivations[workflowId];
		}
	}

	/**
	 * Remove all workflows from the activation queue
	 */
	removeAllQueuedWorkflowActivations() {
		for (const workflowId in this.queuedActivations) {
			this.removeQueuedWorkflowActivation(workflowId);
		}
	}

	/**
	 * Makes a workflow inactive
	 *
	 * @param {string} workflowId The id of the workflow to deactivate
	 */
	// TODO: this should happen in a transaction
	// maybe, see: https://github.com/n8n-io/n8n/pull/8904#discussion_r1530150510
	async remove(workflowId: string) {
		if (this.instanceSettings.isMultiMain) {
			try {
				await this.clearWebhooks(workflowId);
			} catch (error) {
				this.errorReporter.error(error);
				this.logger.error(
					`Could not remove webhooks of workflow "${workflowId}" because of error: "${error.message}"`,
				);
			}

			void this.publisher.publishCommand({
				command: 'remove-triggers-and-pollers',
				payload: { workflowId },
			});

			return;
		}

		try {
			await this.clearWebhooks(workflowId);
		} catch (error) {
			this.errorReporter.error(error);
			this.logger.error(
				`Could not remove webhooks of workflow "${workflowId}" because of error: "${error.message}"`,
			);
		}

		await this.activationErrorsService.deregister(workflowId);

		if (this.queuedActivations[workflowId] !== undefined) {
			this.removeQueuedWorkflowActivation(workflowId);
		}

		// if it's active in memory then it's a trigger
		// so remove from list of actives workflows
		await this.removeWorkflowTriggersAndPollers(workflowId);
	}

	/**
	 * Stop running active triggers and pollers for a workflow.
	 */
	async removeWorkflowTriggersAndPollers(workflowId: string) {
		if (!this.activeWorkflows.isActive(workflowId)) return;

		const wasRemoved = await this.activeWorkflows.remove(workflowId);

		if (wasRemoved) {
			this.logger.debug(`Removed triggers and pollers for workflow "${workflowId}"`, {
				workflowId,
			});
		}
	}

	/**
	 * Register as active in memory a trigger- or poller-based workflow.
	 */
	async addTriggersAndPollers(
		dbWorkflow: WorkflowEntity,
		workflow: Workflow,
		{
			activationMode,
			executionMode,
			additionalData,
		}: {
			activationMode: WorkflowActivateMode;
			executionMode: WorkflowExecuteMode;
			additionalData: IWorkflowExecuteAdditionalData;
		},
	) {
		const getTriggerFunctions = this.getExecuteTriggerFunctions(
			dbWorkflow,
			additionalData,
			executionMode,
			activationMode,
		);

		const getPollFunctions = this.getExecutePollFunctions(
			dbWorkflow,
			additionalData,
			executionMode,
			activationMode,
		);

		if (workflow.getTriggerNodes().length !== 0 || workflow.getPollNodes().length !== 0) {
			this.logger.debug(`Adding triggers and pollers for workflow ${dbWorkflow.display()}`);

			await this.activeWorkflows.add(
				workflow.id,
				workflow,
				additionalData,
				executionMode,
				activationMode,
				getTriggerFunctions,
				getPollFunctions,
			);

			this.logger.debug(`Workflow ${dbWorkflow.display()} activated`, {
				workflowId: dbWorkflow.id,
				workflowName: dbWorkflow.name,
			});
		}
	}

	async removeActivationError(workflowId: string) {
		await this.activationErrorsService.deregister(workflowId);
	}

	/**
	 * Whether this instance may add webhooks to the `webhook_entity` table.
	 */
	shouldAddWebhooks(activationMode: WorkflowActivateMode) {
		// Always try to populate the webhook entity table as well as register the webhooks
		// to prevent issues with users upgrading from a version < 1.15, where the webhook entity
		// was cleared on shutdown to anything past 1.28.0, where we stopped populating it on init,
		// causing all webhooks to break
		if (activationMode === 'init') return true;

		if (activationMode === 'leadershipChange') return false;

		return this.instanceSettings.isLeader; // 'update' or 'activate'
	}

	/**
	 * Whether this instance may add triggers and pollers to memory.
	 *
	 * In both single- and multi-main setup, only the leader is allowed to manage
	 * triggers and pollers in memory, to ensure they are not duplicated.
	 */
	shouldAddTriggersAndPollers() {
		return this.instanceSettings.isLeader;
	}
}
