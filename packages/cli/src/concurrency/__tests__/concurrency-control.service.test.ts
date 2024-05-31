import { mock } from 'jest-mock-extended';
import config from '@/config';
import { ConcurrencyControlService } from '@/concurrency/concurrency-control.service';
import type { Logger } from '@/Logger';
import { UnsupportedConcurrencyCapError } from '@/errors/unsupported-concurrency-cap.error';
import { ConcurrencyQueue } from '../concurrency-queue';
import type { WorkflowExecuteMode as ExecutionMode } from 'n8n-workflow';
import type { ExecutionRepository } from '@/databases/repositories/execution.repository';

describe('ConcurrencyControlService', () => {
	const logger = mock<Logger>();
	const executionRepository = mock<ExecutionRepository>();

	afterEach(() => {
		config.load(config.default);
		jest.clearAllMocks();
	});

	describe('constructor', () => {
		it('should throw if production cap is 0', () => {
			/**
			 * Arrange
			 */
			config.set('executions.concurrency.productionCap', 0);

			try {
				/**
				 * Act
				 */
				new ConcurrencyControlService(logger, executionRepository);
			} catch (error) {
				/**
				 * Assert
				 */
				expect(error).toBeInstanceOf(UnsupportedConcurrencyCapError);
			}
		});

		it('should be enabled if production cap is positive', () => {
			/**
			 * Arrange
			 */
			config.set('executions.concurrency.productionCap', 1);

			/**
			 * Act
			 */
			const service = new ConcurrencyControlService(logger, executionRepository);

			/**
			 * Assert
			 */
			expect(service.isEnabled).toBe(true);
			expect(service.productionQueue).toBeDefined();
		});

		it('should be disabled if production cap is -1', () => {
			/**
			 * Arrange
			 */
			config.set('executions.concurrency.productionCap', -1);

			/**
			 * Act
			 */
			const service = new ConcurrencyControlService(logger, executionRepository);

			/**
			 * Assert
			 */
			expect(service.isEnabled).toBe(false);
		});
	});

	// ----------------------------------
	//             enabled
	// ----------------------------------

	describe('if enabled', () => {
		describe('check', () => {
			it.each(['cli', 'error', 'integrated', 'internal', 'manual', 'retry'])(
				'should do nothing on %s mode',
				async (mode: ExecutionMode) => {
					/**
					 * Arrange
					 */
					config.set('executions.concurrency.productionCap', 1);

					const service = new ConcurrencyControlService(logger, executionRepository);
					const enqueueSpy = jest.spyOn(ConcurrencyQueue.prototype, 'enqueue');

					/**
					 * Act
					 */
					await service.check({ mode, executionId: '1' });

					/**
					 * Assert
					 */
					expect(enqueueSpy).not.toHaveBeenCalled();
				},
			);

			it.each(['webhook', 'trigger'])('should enqueue on %s mode', async (mode: ExecutionMode) => {
				/**
				 * Arrange
				 */
				config.set('executions.concurrency.productionCap', 1);

				const service = new ConcurrencyControlService(logger, executionRepository);
				const enqueueSpy = jest.spyOn(ConcurrencyQueue.prototype, 'enqueue');

				/**
				 * Act
				 */
				await service.check({ mode, executionId: '1' });

				/**
				 * Assert
				 */
				expect(enqueueSpy).toHaveBeenCalled();
			});
		});

		describe('release', () => {
			it.each(['cli', 'error', 'integrated', 'internal', 'manual', 'retry'])(
				'should do nothing on %s mode',
				async (mode: ExecutionMode) => {
					/**
					 * Arrange
					 */
					config.set('executions.concurrency.productionCap', 1);

					const service = new ConcurrencyControlService(logger, executionRepository);
					const dequeueSpy = jest.spyOn(ConcurrencyQueue.prototype, 'dequeue');

					/**
					 * Act
					 */
					await service.check({ mode, executionId: '1' });

					/**
					 * Assert
					 */
					expect(dequeueSpy).not.toHaveBeenCalled();
				},
			);

			it.each(['webhook', 'trigger'])('should dequeue on %s mode', (mode: ExecutionMode) => {
				/**
				 * Arrange
				 */
				config.set('executions.concurrency.productionCap', 1);

				const service = new ConcurrencyControlService(logger, executionRepository);
				const dequeueSpy = jest.spyOn(ConcurrencyQueue.prototype, 'dequeue');

				/**
				 * Act
				 */
				service.release({ mode });

				/**
				 * Assert
				 */
				expect(dequeueSpy).toHaveBeenCalled();
			});
		});

		describe('remove', () => {
			it.each(['cli', 'error', 'integrated', 'internal', 'manual', 'retry'])(
				'should do nothing on %s mode',
				async (mode: ExecutionMode) => {
					/**
					 * Arrange
					 */
					config.set('executions.concurrency.productionCap', 1);

					const service = new ConcurrencyControlService(logger, executionRepository);
					const removeSpy = jest.spyOn(ConcurrencyQueue.prototype, 'remove');

					/**
					 * Act
					 */
					await service.check({ mode, executionId: '1' });

					/**
					 * Assert
					 */
					expect(removeSpy).not.toHaveBeenCalled();
				},
			);

			it.each(['webhook', 'trigger'])(
				'should remove an execution on %s mode',
				(mode: ExecutionMode) => {
					/**
					 * Arrange
					 */
					config.set('executions.concurrency.productionCap', 1);

					const service = new ConcurrencyControlService(logger, executionRepository);
					const removeSpy = jest.spyOn(ConcurrencyQueue.prototype, 'remove');

					/**
					 * Act
					 */
					service.remove({ mode, executionId: '1' });

					/**
					 * Assert
					 */
					expect(removeSpy).toHaveBeenCalled();
				},
			);
		});

		describe('removeMany', () => {
			it('should remove many executions from the queue', () => {
				/**
				 * Arrange
				 */
				config.set('executions.concurrency.productionCap', 2);

				const service = new ConcurrencyControlService(logger, executionRepository);

				jest
					.spyOn(ConcurrencyQueue.prototype, 'getAll')
					.mockReturnValueOnce(new Set(['1', '2', '3']));

				const removeSpy = jest.spyOn(ConcurrencyQueue.prototype, 'remove');

				/**
				 * Act
				 */
				service.removeMany(['2', '3']);

				/**
				 * Assert
				 */
				expect(removeSpy).toHaveBeenNthCalledWith(1, '2');
				expect(removeSpy).toHaveBeenNthCalledWith(2, '3');
			});
		});

		describe('removeAll', () => {
			it('should remove all executions from the queue', () => {
				/**
				 * Arrange
				 */
				config.set('executions.concurrency.productionCap', 2);

				const service = new ConcurrencyControlService(logger, executionRepository);

				jest
					.spyOn(ConcurrencyQueue.prototype, 'getAll')
					.mockReturnValueOnce(new Set(['1', '2', '3']));

				const removeSpy = jest.spyOn(ConcurrencyQueue.prototype, 'remove');

				/**
				 * Act
				 */
				service.removeAll();

				/**
				 * Assert
				 */
				expect(removeSpy).toHaveBeenNthCalledWith(1, '1');
				expect(removeSpy).toHaveBeenNthCalledWith(2, '2');
				expect(removeSpy).toHaveBeenNthCalledWith(3, '3');
			});
		});
	});

	// ----------------------------------
	//            disabled
	// ----------------------------------

	describe('if disabled', () => {
		describe('check', () => {
			it('should do nothing', async () => {
				/**
				 * Arrange
				 */
				config.set('executions.concurrency.productionCap', -1);

				const service = new ConcurrencyControlService(logger, executionRepository);
				const enqueueSpy = jest.spyOn(ConcurrencyQueue.prototype, 'enqueue');

				/**
				 * Act
				 */
				await service.check({ mode: 'trigger', executionId: '1' });
				await service.check({ mode: 'webhook', executionId: '2' });

				/**
				 * Assert
				 */
				expect(enqueueSpy).not.toHaveBeenCalled();
			});
		});

		describe('release', () => {
			it('should do nothing', () => {
				/**
				 * Arrange
				 */
				config.set('executions.concurrency.productionCap', -1);

				const service = new ConcurrencyControlService(logger, executionRepository);
				const dequeueSpy = jest.spyOn(ConcurrencyQueue.prototype, 'dequeue');

				/**
				 * Act
				 */
				service.release({ mode: 'webhook' });

				/**
				 * Assert
				 */
				expect(dequeueSpy).not.toHaveBeenCalled();
			});
		});

		describe('remove', () => {
			it('should do nothing', () => {
				/**
				 * Arrange
				 */
				config.set('executions.concurrency.productionCap', -1);

				const service = new ConcurrencyControlService(logger, executionRepository);
				const removeSpy = jest.spyOn(ConcurrencyQueue.prototype, 'remove');

				/**
				 * Act
				 */
				service.remove({ mode: 'webhook', executionId: '1' });

				/**
				 * Assert
				 */
				expect(removeSpy).not.toHaveBeenCalled();
			});
		});

		describe('removeMany', () => {
			it('should do nothing', () => {
				/**
				 * Arrange
				 */
				config.set('executions.concurrency.productionCap', -1);

				const service = new ConcurrencyControlService(logger, executionRepository);
				const removeSpy = jest.spyOn(ConcurrencyQueue.prototype, 'remove');

				/**
				 * Act
				 */
				service.removeMany(['1', '2', '3']);

				/**
				 * Assert
				 */
				expect(removeSpy).not.toHaveBeenCalled();
			});
		});

		describe('removeAll', () => {
			it('should do nothing', () => {
				/**
				 * Arrange
				 */
				config.set('executions.concurrency.productionCap', -1);

				const service = new ConcurrencyControlService(logger, executionRepository);
				const removeSpy = jest.spyOn(ConcurrencyQueue.prototype, 'remove');

				/**
				 * Act
				 */
				service.removeMany(['1', '2', '3']);

				/**
				 * Assert
				 */
				expect(removeSpy).not.toHaveBeenCalled();
			});
		});
	});
});
