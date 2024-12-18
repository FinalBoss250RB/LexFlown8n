import { mock } from 'jest-mock-extended';
import type {
	IGetExecuteTriggerFunctions,
	INode,
	ITriggerResponse,
	IWorkflowExecuteAdditionalData,
	Workflow,
	WorkflowActivateMode,
	WorkflowExecuteMode,
	TriggerTime,
	CronExpression,
} from 'n8n-workflow';
import { LoggerProxy, TriggerCloseError, WorkflowActivationError } from 'n8n-workflow';

import { ActiveWorkflows } from '@/ActiveWorkflows';
import type { ErrorReporter } from '@/error-reporter';
import type { PollContext } from '@/node-execution-context';
import type { ScheduledTaskManager } from '@/ScheduledTaskManager';
import type { TriggersAndPollers } from '@/TriggersAndPollers';

describe('ActiveWorkflows', () => {
	const workflowId = 'test-workflow-id';
	const workflow = mock<Workflow>();
	const additionalData = mock<IWorkflowExecuteAdditionalData>();
	const mode: WorkflowExecuteMode = 'trigger';
	const activation: WorkflowActivateMode = 'init';

	const getTriggerFunctions = jest.fn() as IGetExecuteTriggerFunctions;
	const triggerResponse = mock<ITriggerResponse>();

	const pollFunctions = mock<PollContext>();
	const getPollFunctions = jest.fn<PollContext, unknown[]>();

	LoggerProxy.init(mock());
	const scheduledTaskManager = mock<ScheduledTaskManager>();
	const triggersAndPollers = mock<TriggersAndPollers>();
	const errorReporter = mock<ErrorReporter>();
	let activeWorkflows: ActiveWorkflows;

	const triggerNode = mock<INode>();
	const pollNode = mock<INode>();
	const pollTimes = { item: [{ mode: 'everyMinute' } as TriggerTime] };

	beforeEach(() => {
		jest.clearAllMocks();
		getPollFunctions.mockReturnValue(pollFunctions);
		pollFunctions.getNodeParameter.mockReturnValue(pollTimes);
		triggersAndPollers.runTrigger.mockResolvedValue(triggerResponse);

		activeWorkflows = new ActiveWorkflows(scheduledTaskManager, triggersAndPollers, errorReporter);
	});

	describe('add()', () => {
		describe('should activate workflow', () => {
			it('with trigger nodes', async () => {
				workflow.getTriggerNodes.mockReturnValue([triggerNode]);
				workflow.getPollNodes.mockReturnValue([]);

				await activeWorkflows.add(
					workflowId,
					workflow,
					additionalData,
					mode,
					activation,
					getTriggerFunctions,
					getPollFunctions,
				);

				expect(activeWorkflows.isActive(workflowId)).toBe(true);
				expect(workflow.getTriggerNodes).toHaveBeenCalled();
				expect(triggersAndPollers.runTrigger).toHaveBeenCalledWith(
					workflow,
					triggerNode,
					getTriggerFunctions,
					additionalData,
					mode,
					activation,
				);
			});

			it('with polling nodes', async () => {
				workflow.getTriggerNodes.mockReturnValue([]);
				workflow.getPollNodes.mockReturnValue([pollNode]);

				await activeWorkflows.add(
					workflowId,
					workflow,
					additionalData,
					mode,
					activation,
					getTriggerFunctions,
					getPollFunctions,
				);

				expect(activeWorkflows.isActive(workflowId)).toBe(true);
				expect(workflow.getPollNodes).toHaveBeenCalled();
				expect(scheduledTaskManager.registerCron).toHaveBeenCalled();
			});
		});

		describe('should throw error', () => {
			it('if trigger activation fails', async () => {
				workflow.getTriggerNodes.mockReturnValue([triggerNode]);
				workflow.getPollNodes.mockReturnValue([]);

				const error = new Error('Trigger activation failed');
				triggersAndPollers.runTrigger.mockRejectedValueOnce(error);

				await expect(
					activeWorkflows.add(
						workflowId,
						workflow,
						additionalData,
						mode,
						activation,
						getTriggerFunctions,
						getPollFunctions,
					),
				).rejects.toThrow(WorkflowActivationError);
				expect(activeWorkflows.isActive(workflowId)).toBe(false);
			});

			it('if polling activation fails', async () => {
				workflow.getTriggerNodes.mockReturnValue([]);
				workflow.getPollNodes.mockReturnValue([pollNode]);

				const error = new Error('Failed to activate polling');
				getPollFunctions.mockImplementation(() => {
					throw error;
				});

				await expect(
					activeWorkflows.add(
						workflowId,
						workflow,
						additionalData,
						mode,
						activation,
						getTriggerFunctions,
						getPollFunctions,
					),
				).rejects.toThrow(WorkflowActivationError);
				expect(activeWorkflows.isActive(workflowId)).toBe(false);
			});

			it('if the polling interval is too short (contains * in first position)', async () => {
				const pollTimes = {
					item: [
						{
							mode: 'custom',
							cronExpression: '* * * * *' as CronExpression,
						},
					],
				};
				pollFunctions.getNodeParameter.mockReturnValue(pollTimes);

				await expect(
					activeWorkflows.add(
						workflowId,
						workflow,
						additionalData,
						mode,
						activation,
						getTriggerFunctions,
						getPollFunctions,
					),
				).rejects.toThrow('The polling interval is too short. It has to be at least a minute.');

				expect(scheduledTaskManager.registerCron).not.toHaveBeenCalled();
			});
		});

		describe('should handle polling errors', () => {
			beforeEach(() => {
				workflow.getTriggerNodes.mockReturnValue([]);
				workflow.getPollNodes.mockReturnValue([pollNode]);
			});

			it('should throw error when poll fails during initial testing', async () => {
				const error = new Error('Poll function failed');
				triggersAndPollers.runPoll.mockRejectedValueOnce(error);

				await expect(
					activeWorkflows.add(
						workflowId,
						workflow,
						additionalData,
						mode,
						activation,
						getTriggerFunctions,
						getPollFunctions,
					),
				).rejects.toThrow(WorkflowActivationError);

				expect(triggersAndPollers.runPoll).toHaveBeenCalledWith(workflow, pollNode, pollFunctions);
				expect(pollFunctions.__emit).not.toHaveBeenCalled();
				expect(pollFunctions.__emitError).not.toHaveBeenCalled();
			});

			it('should emit error when poll fails during regular polling', async () => {
				const error = new Error('Poll function failed');
				triggersAndPollers.runPoll
					.mockResolvedValueOnce(null) // Succeed on first call (testing)
					.mockRejectedValueOnce(error); // Fail on second call (regular polling)

				await activeWorkflows.add(
					workflowId,
					workflow,
					additionalData,
					mode,
					activation,
					getTriggerFunctions,
					getPollFunctions,
				);

				// Get the executeTrigger function that was registered
				const registerCronCall = scheduledTaskManager.registerCron.mock.calls[0];
				const executeTrigger = registerCronCall[2] as () => Promise<void>;

				// Execute the trigger function to simulate a regular poll
				await executeTrigger();

				expect(triggersAndPollers.runPoll).toHaveBeenCalledTimes(2);
				expect(pollFunctions.__emit).not.toHaveBeenCalled();
				expect(pollFunctions.__emitError).toHaveBeenCalledWith(error);
			});
		});
	});

	describe('remove()', () => {
		beforeEach(() => {
			workflow.getTriggerNodes.mockReturnValue([triggerNode]);
			workflow.getPollNodes.mockReturnValue([]);
		});

		it('should remove an active workflow', async () => {
			await activeWorkflows.add(
				workflowId,
				workflow,
				additionalData,
				mode,
				activation,
				getTriggerFunctions,
				getPollFunctions,
			);

			const result = await activeWorkflows.remove(workflowId);

			expect(result).toBe(true);
			expect(activeWorkflows.isActive(workflowId)).toBe(false);
			expect(scheduledTaskManager.deregisterCrons).toHaveBeenCalledWith(workflowId);
			expect(triggerResponse.closeFunction).toHaveBeenCalled();
		});

		it('should return false when removing non-existent workflow', async () => {
			const result = await activeWorkflows.remove('non-existent');

			expect(result).toBe(false);
			expect(scheduledTaskManager.deregisterCrons).not.toHaveBeenCalled();
		});

		it('should handle TriggerCloseError when closing trigger', async () => {
			const triggerCloseError = new TriggerCloseError(triggerNode, { level: 'warning' });
			(triggerResponse.closeFunction as jest.Mock).mockRejectedValueOnce(triggerCloseError);

			await activeWorkflows.add(
				workflowId,
				workflow,
				additionalData,
				mode,
				activation,
				getTriggerFunctions,
				getPollFunctions,
			);

			const result = await activeWorkflows.remove(workflowId);

			expect(result).toBe(true);
			expect(activeWorkflows.isActive(workflowId)).toBe(false);
			expect(triggerResponse.closeFunction).toHaveBeenCalled();
			expect(errorReporter.error).toHaveBeenCalledWith(triggerCloseError, {
				extra: { workflowId },
			});
		});

		it('should throw WorkflowDeactivationError when closeFunction throws regular error', async () => {
			const error = new Error('Close function failed');
			(triggerResponse.closeFunction as jest.Mock).mockRejectedValueOnce(error);

			await activeWorkflows.add(
				workflowId,
				workflow,
				additionalData,
				mode,
				activation,
				getTriggerFunctions,
				getPollFunctions,
			);

			await expect(activeWorkflows.remove(workflowId)).rejects.toThrow(
				`Failed to deactivate trigger of workflow ID "${workflowId}": "Close function failed"`,
			);

			expect(triggerResponse.closeFunction).toHaveBeenCalled();
			expect(errorReporter.error).not.toHaveBeenCalled();
		});
	});

	describe('get() and isActive()', () => {
		it('should return workflow data for active workflow', async () => {
			workflow.getTriggerNodes.mockReturnValue([triggerNode]);
			workflow.getPollNodes.mockReturnValue([]);

			await activeWorkflows.add(
				workflowId,
				workflow,
				additionalData,
				mode,
				activation,
				getTriggerFunctions,
				getPollFunctions,
			);

			expect(activeWorkflows.isActive(workflowId)).toBe(true);
			expect(activeWorkflows.get(workflowId)).toBeDefined();
		});

		it('should return undefined for non-active workflow', () => {
			expect(activeWorkflows.isActive('non-existent')).toBe(false);
			expect(activeWorkflows.get('non-existent')).toBeUndefined();
		});
	});

	describe('allActiveWorkflows()', () => {
		it('should return all active workflow IDs', async () => {
			workflow.getTriggerNodes.mockReturnValue([triggerNode]);
			workflow.getPollNodes.mockReturnValue([]);

			await activeWorkflows.add(
				workflowId,
				workflow,
				additionalData,
				mode,
				activation,
				getTriggerFunctions,
				getPollFunctions,
			);

			const activeIds = activeWorkflows.allActiveWorkflows();

			expect(activeIds).toEqual([workflowId]);
		});
	});

	describe('removeAllTriggerAndPollerBasedWorkflows()', () => {
		it('should remove all active workflows', async () => {
			workflow.getTriggerNodes.mockReturnValue([triggerNode]);
			workflow.getPollNodes.mockReturnValue([]);

			await activeWorkflows.add(
				workflowId,
				workflow,
				additionalData,
				mode,
				activation,
				getTriggerFunctions,
				getPollFunctions,
			);

			await activeWorkflows.removeAllTriggerAndPollerBasedWorkflows();

			expect(activeWorkflows.allActiveWorkflows()).toEqual([]);
			expect(scheduledTaskManager.deregisterCrons).toHaveBeenCalledWith(workflowId);
		});
	});
});
