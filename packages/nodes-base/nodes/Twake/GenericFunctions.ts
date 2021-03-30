import {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
} from 'n8n-core';
import { NodeApiError, NodeOperationError, } from 'n8n-workflow';

import {
	OptionsWithUri,
} from 'request';


/**
 * Make an API request to Twake
 *
 * @param {IHookFunctions} this
 * @param {string} method
 * @param {string} url
 * @param {object} body
 * @returns {Promise<any>}
 */
export async function twakeApiRequest(this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions, method: string, resource: string, body: object, query?: object, uri?: string): Promise<any> {  // tslint:disable-line:no-any

	const authenticationMethod = this.getNodeParameter('twakeVersion', 0, 'twakeCloudApi') as string;

	const options: OptionsWithUri = {
		headers: {},
		method,
		body,
		qs: query,
		uri: uri || `https://connectors.albatros.twakeapp.com/n8n${resource}`,
		json: true,
	};


	// if (authenticationMethod === 'cloud') {
		const credentials = this.getCredentials('twakeCloudApi');
		options.headers!.Authorization = `Bearer ${credentials!.workspaceKey}`;

	// } else {
	// 	const credentials = this.getCredentials('twakeServerApi');
	// 	options.auth = { user: credentials!.publicId as string, pass: credentials!.privateApiKey as string };
	// 	options.uri = `${credentials!.hostUrl}/api/v1${resource}`;
	// }

	try {
		return await this.helpers.request!(options);
	} catch (error) {
		if (error.error.code === 'ECONNREFUSED') {
			throw new NodeOperationError(this.getNode(), 'Twake host is not accessible!');
		}
		throw new NodeApiError(this.getNode(), error);
	}
}
