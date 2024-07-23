import { mock } from 'jest-mock-extended';
import { GcpSecretsManager } from '../gcp-secrets-manager/gcp-secrets-manager';
import type { GcpSecretsManagerContext } from '../gcp-secrets-manager/types';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { google } from '@google-cloud/secret-manager/build/protos/protos';

jest.mock('@google-cloud/secret-manager');

type GcpSecretVersionResponse = google.cloud.secretmanager.v1.IAccessSecretVersionResponse;

describe('GCP Secrets Manager', () => {
	const gcpSecretsManager = new GcpSecretsManager();

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('should update cached secrets', async () => {
		const PROJECT_ID = 'my-project-id';

		/**
		 * Arrange
		 */
		await gcpSecretsManager.init(
			mock<GcpSecretsManagerContext>({
				settings: { serviceAccountKey: `{ "project_id": "${PROJECT_ID}" }` },
			}),
		);

		const listSpy = jest
			.spyOn(SecretManagerServiceClient.prototype, 'listSecrets')
			// @ts-expect-error Partial mock
			.mockResolvedValue([
				[
					{ name: `projects/${PROJECT_ID}/secrets/secret1` },
					{ name: `projects/${PROJECT_ID}/secrets/secret2` },
					{ name: `projects/${PROJECT_ID}/secrets/secret3` }, // no value
					{ name: `projects/${PROJECT_ID}/secrets/secret4` }, // unsupported name
				],
			]);

		const getSpy = jest
			.spyOn(SecretManagerServiceClient.prototype, 'accessSecretVersion')
			.mockImplementation(async ({ name }: { name: string }) => {
				if (name === `projects/${PROJECT_ID}/secrets/secret1/versions/latest`) {
					return [{ payload: { data: Buffer.from('value1') } }] as GcpSecretVersionResponse[];
				} else if (name === `projects/${PROJECT_ID}/secrets/secret2/versions/latest`) {
					return [{ payload: { data: Buffer.from('value2') } }] as GcpSecretVersionResponse[];
				} else if (name === `projects/${PROJECT_ID}/secrets/secret3/versions/latest`) {
					return [{ payload: { data: Buffer.from('') } }] as GcpSecretVersionResponse[];
				} else if (name === `projects/${PROJECT_ID}/secrets/secret4/versions/latest`) {
					return [{ payload: { data: Buffer.from('#@&') } }] as GcpSecretVersionResponse[];
				}
				throw new Error('Unexpected secret name');
			});

		/**
		 * Act
		 */
		await gcpSecretsManager.connect();
		await gcpSecretsManager.update();

		/**
		 * Assert
		 */
		expect(listSpy).toHaveBeenCalled();
		expect(getSpy).toHaveBeenCalledWith({
			name: 'projects/my-project-id/secrets/secret1/versions/latest',
		});
		expect(getSpy).toHaveBeenCalledWith({
			name: 'projects/my-project-id/secrets/secret2/versions/latest',
		});

		expect(gcpSecretsManager.getSecret('secret1')).toBe('value1');
		expect(gcpSecretsManager.getSecret('secret2')).toBe('value2');
		expect(gcpSecretsManager.getSecret('secret3')).toBeUndefined(); // no value
		expect(gcpSecretsManager.getSecret('#@&')).toBeUndefined(); // unsupported name
	});
});
