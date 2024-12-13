import { z } from 'zod';
import { Z } from 'zod-class';

// TODO: document what these flags do
export class CredentialsGetManyRequest extends Z.class({
	/**
	 * Adds the `scopes` field to each credential which includes all scopes the
	 * requesting user has in relation to the credential, e.g.
	 *     ['credential:read', 'credential:update']
	 */
	includeScopes: z.union([z.literal('true'), z.literal('false')]).optional(),

	/**
	 * Adds the decrypted `data` field to each credential.
	 *
	 * It only does this for credentials for which the user has the
	 * `credential:update` scope.
	 *
	 * This switches `includeScopes` to true to be able to check for the scopes
	 */
	includeData: z.union([z.literal('true'), z.literal('false')]).optional(),
}) {}
