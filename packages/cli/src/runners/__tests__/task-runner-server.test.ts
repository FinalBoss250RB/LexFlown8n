import type { GlobalConfig } from '@n8n/config';
import { mock } from 'jest-mock-extended';
import { ServerResponse } from 'node:http';
import type WebSocket from 'ws';

import { Time } from '@/constants';
import type { TaskRunnerAuthController } from '@/runners/auth/task-runner-auth.controller';
import { TaskRunnerServer } from '@/runners/task-runner-server';

import type { TaskRunnerServerInitRequest } from '../runner-types';

describe('TaskRunnerServer', () => {
	describe('handleUpgradeRequest', () => {
		it('should close WebSocket when response status code is > 200', () => {
			const ws = mock<WebSocket>();
			const request = mock<TaskRunnerServerInitRequest>({
				url: '/runners/_ws',
				ws,
			});

			const server = new TaskRunnerServer(
				mock(),
				mock<GlobalConfig>({ taskRunners: { path: '/runners' } }),
				mock<TaskRunnerAuthController>(),
				mock(),
				mock(),
			);

			// @ts-expect-error Private property
			server.handleUpgradeRequest(request, mock(), Buffer.from(''));

			const response = new ServerResponse(request);
			response.writeHead = (statusCode) => {
				if (statusCode > 200) ws.close();
				return response;
			};

			response.writeHead(401);
			expect(ws.close).toHaveBeenCalledWith(); // no args
		});

		it('should not close WebSocket when response status code is 200', () => {
			const ws = mock<WebSocket>();
			const request = mock<TaskRunnerServerInitRequest>({
				url: '/runners/_ws',
				ws,
			});

			const server = new TaskRunnerServer(
				mock(),
				mock<GlobalConfig>({ taskRunners: { path: '/runners' } }),
				mock<TaskRunnerAuthController>(),
				mock(),
				mock(),
			);

			// @ts-expect-error Private property
			server.handleUpgradeRequest(request, mock(), Buffer.from(''));

			const response = new ServerResponse(request);
			response.writeHead = (statusCode) => {
				if (statusCode > 200) ws.close();
				return response;
			};

			response.writeHead(200);
			expect(ws.close).not.toHaveBeenCalled();
		});
	});

	describe('heartbeat timer', () => {
		it('should set up heartbeat timer on server start', async () => {
			const setIntervalSpy = jest.spyOn(global, 'setInterval');

			const server = new TaskRunnerServer(
				mock(),
				mock<GlobalConfig>({ taskRunners: { path: '/runners', heartbeatInterval: 30 } }),
				mock<TaskRunnerAuthController>(),
				mock(),
				mock(),
			);

			await server.start();

			expect(setIntervalSpy).toHaveBeenCalledWith(
				expect.any(Function),
				30 * Time.seconds.toMilliseconds,
			);

			await server.stop();
		});

		it('should clear heartbeat timer on server stop', async () => {
			jest.spyOn(global, 'setInterval');
			const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

			const server = new TaskRunnerServer(
				mock(),
				mock<GlobalConfig>({ taskRunners: { path: '/runners', heartbeatInterval: 30 } }),
				mock<TaskRunnerAuthController>(),
				mock(),
				mock(),
			);

			await server.start();
			await server.stop();

			expect(clearIntervalSpy).toHaveBeenCalled();
		});
	});
});
