import type { INodeProperties } from 'n8n-workflow';
import * as create from './create';
import * as deactivate from './deactivate';
import * as getAll from './getAll';
import * as getByEmail from './getByEmail';
import * as getById from './getById';
import * as invite from './invite';

export { create, deactivate, getAll, getByEmail, getById, invite };

export const descriptions: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['user'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new user',
				action: 'Create a user',
			},
			{
				name: 'Deactivate',
				value: 'deactivate',
				description:
					'Deactivates the user and revokes all its sessions by archiving its user object',
				action: 'Deactivate a user',
			},
			{
				name: 'Get By Email',
				value: 'getByEmail',
				description: 'Get a user by email',
				action: 'Get a user by email',
			},
			{
				name: 'Get By ID',
				value: 'getById',
				description: 'Get a user by ID',
				action: 'Get a user by ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve many users',
				action: 'Get many users',
			},
			{
				name: 'Invite',
				value: 'invite',
				description: 'Invite user to team',
				action: 'Invite a user',
			},
		],
		default: '',
	},
	...create.description,
	...deactivate.description,
	...getAll.description,
	...getByEmail.description,
	...getById.description,
	...invite.description,
];
