/* eslint-disable n8n-nodes-base/node-filename-against-convention */
import type {
	IWebhookFunctions,
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	INodeTypeBaseDescription,
} from 'n8n-workflow';
import { eventsDescription } from './descriptions/EventsDescription';

const versionDescription: INodeTypeDescription = {
	displayName: 'TheHive Trigger',
	name: 'theHiveTrigger',
	icon: 'file:thehive.svg',
	group: ['trigger'],
	version: [1, 2],
	description: 'Starts the workflow when TheHive events occur',
	defaults: {
		name: 'TheHive Trigger',
	},
	// eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
	inputs: [],
	outputs: ['main'],
	webhooks: [
		{
			name: 'default',
			httpMethod: 'POST',
			responseMode: 'onReceived',
			path: 'webhook',
		},
	],
	properties: [...eventsDescription],
};

export class TheHiveTriggerV1 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			...versionDescription,
		};
	}

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		// Get the request body
		const bodyData = this.getBodyData();
		const events = this.getNodeParameter('events', []) as string[];
		if (!bodyData.operation || !bodyData.objectType) {
			// Don't start the workflow if mandatory fields are not specified
			return {};
		}

		// Don't start the workflow if the event is not fired
		// Replace Creation with Create for TheHive 3 support
		const operation = (bodyData.operation as string).replace('Creation', 'Create');
		const event = `${(bodyData.objectType as string).toLowerCase()}_${operation.toLowerCase()}`;

		if (events.indexOf('*') === -1 && events.indexOf(event) === -1) {
			return {};
		}

		// The data to return and so start the workflow with
		const returnData: IDataObject[] = [];
		returnData.push({
			event,
			body: this.getBodyData(),
			headers: this.getHeaderData(),
			query: this.getQueryData(),
		});

		return {
			workflowData: [this.helpers.returnJsonArray(returnData)],
		};
	}
}
