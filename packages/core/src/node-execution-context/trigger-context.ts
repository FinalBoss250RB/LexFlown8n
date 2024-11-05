import type {
	ICredentialDataDecryptedObject,
	IGetNodeParameterOptions,
	INode,
	INodeExecutionData,
	IRunExecutionData,
	ITriggerFunctions,
	IWorkflowExecuteAdditionalData,
	NodeParameterValueType,
	Workflow,
	WorkflowActivateMode,
	WorkflowExecuteMode,
} from 'n8n-workflow';
import { ApplicationError, createDeferredPromise } from 'n8n-workflow';

// eslint-disable-next-line import/no-cycle
import {
	getAdditionalKeys,
	getCredentials,
	getNodeParameter,
	returnJsonArray,
} from '@/NodeExecuteFunctions';

import { BinaryHelpers } from './helpers/binary-helpers';
import { RequestHelpers } from './helpers/request-helpers';
import { SchedulingHelpers } from './helpers/scheduling-helpers';
import { SSHTunnelHelpers } from './helpers/ssh-tunnel-helpers';
import { NodeExecutionContext } from './node-execution-context';

const throwOnEmit = () => {
	throw new ApplicationError('Overwrite TriggerContext.emit function');
};

const throwOnEmitError = () => {
	throw new ApplicationError('Overwrite TriggerContext.emitError function');
};

export class TriggerContext extends NodeExecutionContext implements ITriggerFunctions {
	readonly helpers: ITriggerFunctions['helpers'];

	constructor(
		workflow: Workflow,
		node: INode,
		additionalData: IWorkflowExecuteAdditionalData,
		mode: WorkflowExecuteMode,
		private readonly activation: WorkflowActivateMode,
		readonly emit: ITriggerFunctions['emit'] = throwOnEmit,
		readonly emitError: ITriggerFunctions['emitError'] = throwOnEmitError,
	) {
		super(workflow, node, additionalData, mode);

		this.helpers = {
			createDeferredPromise,
			returnJsonArray,
			...new BinaryHelpers(workflow, additionalData).exported,
			...new RequestHelpers(this, workflow, node, additionalData).exported,
			...new SchedulingHelpers(workflow).exported,
			...new SSHTunnelHelpers().exported,
		};
	}

	getActivationMode() {
		return this.activation;
	}

	async getCredentials<T extends object = ICredentialDataDecryptedObject>(type: string) {
		return await getCredentials<T>(this.workflow, this.node, type, this.additionalData, this.mode);
	}

	getNodeParameter(
		parameterName: string,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		fallbackValue?: any,
		options?: IGetNodeParameterOptions,
	): NodeParameterValueType | object {
		const runExecutionData: IRunExecutionData | null = null;
		const itemIndex = 0;
		const runIndex = 0;
		const connectionInputData: INodeExecutionData[] = [];

		return getNodeParameter(
			this.workflow,
			runExecutionData,
			runIndex,
			connectionInputData,
			this.node,
			parameterName,
			itemIndex,
			this.mode,
			getAdditionalKeys(this.additionalData, this.mode, runExecutionData),
			undefined,
			fallbackValue,
			options,
		);
	}
}
