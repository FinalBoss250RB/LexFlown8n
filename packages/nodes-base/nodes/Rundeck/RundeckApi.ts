import { OptionsWithUri } from 'request';
import { IExecuteFunctions } from 'n8n-core';
import { IDataObject } from 'n8n-workflow';

export interface RundeckCredentials {
	url: string;
	token: string;
}

export class RundeckApi {
	private credentials: RundeckCredentials;
	private executeFunctions: IExecuteFunctions;


	constructor(executeFunctions: IExecuteFunctions) {

		const credentials = executeFunctions.getCredentials('rundeckApi');

		if (credentials === undefined) {
			throw new NodeOperationError(this.getNode(), 'No credentials got returned!');
		}

		this.credentials = credentials as unknown as RundeckCredentials;
		this.executeFunctions = executeFunctions;
	}


	protected async request(method: string, endpoint: string, body: IDataObject, query: object) {

		const options: OptionsWithUri = {
			headers: {
				'user-agent': 'n8n',
				'X-Rundeck-Auth-Token': this.credentials.token,
			},
			rejectUnauthorized: false,
			method,
			qs: query,
			uri: this.credentials.url + endpoint,
			body,
			json: true,
		};

		try {
			return await this.executeFunctions.helpers.request!(options);
		} catch (error) {
			let errorMessage = error.message;
			if (error.response && error.response.body && error.response.body.message) {
				errorMessage = error.response.body.message.replace('\n', '');
			}

			throw new NodeOperationError(this.getNode(), `Rundeck Error [${error.statusCode}]: ${errorMessage}`);
		}
	}


	executeJob(jobId: string, args: IDataObject[]): Promise<IDataObject> {

		let params = '';

		if(args) {
			for(const arg of args) {
				params += '-' + arg.name + ' ' + arg.value + ' ';
			}
		}

		const body = {
			argString: params,
		};

		return this.request('POST', `/api/14/job/${jobId}/run`, body, {});
	}

	getJobMetadata(jobId: string): Promise<IDataObject> {
		return this.request('GET', `/api/18/job/${jobId}/info`, {}, {});
	}

}
