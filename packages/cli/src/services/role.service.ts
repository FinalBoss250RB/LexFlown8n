import { RoleRepository, SharedWorkflowRepository } from '@/databases/repositories';
import { Service } from 'typedi';
import { CacheService } from './cache.service';
import type { Role, RoleNames, RoleScopes } from '@/databases/entities/Role';

@Service()
export class RoleService {
	constructor(
		private roleRepository: RoleRepository,
		private sharedWorkflowRepository: SharedWorkflowRepository,
		private cacheService: CacheService,
	) {
		// @TODO: Prepopulate cache
	}

	/**
	 * role finders
	 */

	private async findCached(
		scope: RoleScopes,
		name: RoleNames,
		options: { orFail: true },
	): Promise<Role>;
	private async findCached(
		scope: RoleScopes,
		name: RoleNames,
		options: { orFail: false },
	): Promise<Role | null>;
	private async findCached(scope: RoleScopes, name: RoleNames, options: { orFail: boolean }) {
		const cacheKey = `cache:role:${scope}:${name}`;

		const cachedRole = await this.cacheService.get<Role>(cacheKey);

		if (cachedRole) return this.roleRepository.create(cachedRole);

		let dbRole: Role | null;

		if (options.orFail) {
			dbRole = await this.roleRepository.findRoleOrFail(scope, name);
		} else {
			dbRole = await this.roleRepository.findRole(scope, name);
		}

		if (dbRole !== null) {
			void this.cacheService.set(cacheKey, dbRole);
		}

		return dbRole;
	}

	private async findRoleOrFail(scope: RoleScopes, name: RoleNames): Promise<Role> {
		return this.roleRepository.findOneOrFail({ where: { scope, name } });
	}

	/**
	 * sharing state
	 */

	async getUserRoleForWorkflow(userId: string, workflowId: string) {
		const shared = await this.sharedWorkflowRepository.findOne({
			where: { workflowId, userId },
			relations: ['role'],
		});

		return shared?.role;
	}

	/**
	 * global owner
	 */

	async findGlobalOwnerRole() {
		return this.findCached('global', 'owner', { orFail: false });
	}

	async findGlobalOwnerRoleOrFail() {
		return this.findCached('global', 'owner', { orFail: true });
	}

	/**
	 * global member
	 */

	async findGlobalMemberRole() {
		return this.findCached('global', 'member', { orFail: false });
	}

	async findGlobalMemberRoleOrFail() {
		return this.findCached('global', 'member', { orFail: true });
	}

	/**
	 * workflow owner
	 */

	async findWorkflowOwnerRole() {
		return this.findCached('workflow', 'owner', { orFail: false });
	}

	async findWorkflowOwnerRoleOrFail() {
		return this.findCached('workflow', 'owner', { orFail: true });
	}

	/**
	 * workflow editor
	 */

	async findWorkflowEditorRole() {
		return this.findCached('workflow', 'editor', { orFail: false });
	}

	async findWorkflowEditorRoleOrFail() {
		return this.findCached('workflow', 'editor', { orFail: true });
	}

	/**
	 * credential owner
	 */

	async findCredentialOwnerRole() {
		return this.findCached('credential', 'owner', { orFail: false });
	}

	async findCredentialOwnerRoleOrFail() {
		return this.findCached('credential', 'owner', { orFail: true });
	}

	/**
	 * credential user
	 */

	async findCredentialUserRole() {
		return this.findCached('credential', 'user', { orFail: false });
	}

	async findCredentialUserRoleOrFail() {
		return this.findCached('credential', 'user', { orFail: true });
	}

	/**
	 * utils
	 */

	async getRoleId(scope: Role['scope'], name: Role['name']): Promise<Role['id']> {
		return this.findRoleOrFail(scope, name).then((role) => role.id);
	}
}
