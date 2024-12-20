import { rmSync } from 'fs';
import { Credentials, InstanceSettings } from 'n8n-core';
import { ApplicationError, type ICredentialDataDecryptedObject } from 'n8n-workflow';
import { writeFile as fsWriteFile, rm as fsRm } from 'node:fs/promises';
import path from 'path';
import Container, { Service } from 'typedi';

import type { WorkflowEntity } from '@/databases/entities/workflow-entity';
import { SharedCredentialsRepository } from '@/databases/repositories/shared-credentials.repository';
import { SharedWorkflowRepository } from '@/databases/repositories/shared-workflow.repository';
import { TagRepository } from '@/databases/repositories/tag.repository';
import { WorkflowTagMappingRepository } from '@/databases/repositories/workflow-tag-mapping.repository';
import { WorkflowRepository } from '@/databases/repositories/workflow.repository';
import { Logger } from '@/logging/logger.service';

import {
	SOURCE_CONTROL_CREDENTIAL_EXPORT_FOLDER,
	SOURCE_CONTROL_GIT_FOLDER,
	SOURCE_CONTROL_TAGS_EXPORT_FILE,
	SOURCE_CONTROL_WORKFLOW_EXPORT_FOLDER,
} from './constants';
import {
	getCredentialExportPath,
	getVariablesPath,
	getWorkflowExportPath,
	sourceControlFoldersExistCheck,
	stringContainsExpression,
} from './source-control-helper.ee';
import type { ExportResult } from './types/export-result';
import type { ExportableCredential } from './types/exportable-credential';
import type { ExportableWorkflow } from './types/exportable-workflow';
import type { ResourceOwner } from './types/resource-owner';
import type { SourceControlledFile } from './types/source-controlled-file';
import { VariablesService } from '../variables/variables.service.ee';

@Service()
export class SourceControlExportService {
	private gitFolder: string;

	private workflowExportFolder: string;

	private credentialExportFolder: string;

	constructor(
		private readonly logger: Logger,
		private readonly variablesService: VariablesService,
		private readonly tagRepository: TagRepository,
		instanceSettings: InstanceSettings,
	) {
		this.gitFolder = path.join(instanceSettings.n8nFolder, SOURCE_CONTROL_GIT_FOLDER);
		this.workflowExportFolder = path.join(this.gitFolder, SOURCE_CONTROL_WORKFLOW_EXPORT_FOLDER);
		this.credentialExportFolder = path.join(
			this.gitFolder,
			SOURCE_CONTROL_CREDENTIAL_EXPORT_FOLDER,
		);
	}

	getWorkflowPath(workflowId: string): string {
		return getWorkflowExportPath(workflowId, this.workflowExportFolder);
	}

	getCredentialsPath(credentialsId: string): string {
		return getCredentialExportPath(credentialsId, this.credentialExportFolder);
	}

	async deleteRepositoryFolder() {
		try {
			await fsRm(this.gitFolder, { recursive: true });
		} catch (error) {
			this.logger.error(`Failed to delete work folder: ${(error as Error).message}`);
		}
	}

	rmFilesFromExportFolder(filesToBeDeleted: Set<string>): Set<string> {
		try {
			filesToBeDeleted.forEach((e) => rmSync(e));
		} catch (error) {
			this.logger.error(`Failed to delete workflows from work folder: ${(error as Error).message}`);
		}
		return filesToBeDeleted;
	}

	private async writeExportableWorkflowsToExportFolder(
		workflowsToBeExported: WorkflowEntity[],
		owners: Record<string, ResourceOwner>,
	) {
		await Promise.all(
			workflowsToBeExported.map(async (e) => {
				const fileName = this.getWorkflowPath(e.id);
				const sanitizedWorkflow: ExportableWorkflow = {
					id: e.id,
					name: e.name,
					nodes: e.nodes,
					connections: e.connections,
					settings: e.settings,
					triggerCount: e.triggerCount,
					versionId: e.versionId,
					owner: owners[e.id],
				};
				this.logger.debug(`Writing workflow ${e.id} to ${fileName}`);
				return await fsWriteFile(fileName, JSON.stringify(sanitizedWorkflow, null, 2));
			}),
		);
	}

	async exportWorkflowsToWorkFolder(candidates: SourceControlledFile[]): Promise<ExportResult> {
		try {
			sourceControlFoldersExistCheck([this.workflowExportFolder]);
			const workflowIds = candidates.map((e) => e.id);
			const sharedWorkflows =
				await Container.get(SharedWorkflowRepository).findByWorkflowIds(workflowIds);
			const workflows = await Container.get(WorkflowRepository).findByIds(workflowIds);

			// determine owner of each workflow to be exported
			const owners: Record<string, ResourceOwner> = {};
			sharedWorkflows.forEach((e) => {
				const project = e.project;

				if (!project) {
					throw new ApplicationError(`Workflow ${e.workflow.display()} has no owner`);
				}

				if (project.type === 'personal') {
					const ownerRelation = project.projectRelations.find(
						(pr) => pr.role === 'project:personalOwner',
					);
					if (!ownerRelation) {
						throw new ApplicationError(`Workflow ${e.workflow.display()} has no owner`);
					}
					owners[e.workflowId] = {
						type: 'personal',
						personalEmail: ownerRelation.user.email,
					};
				} else if (project.type === 'team') {
					owners[e.workflowId] = {
						type: 'team',
						teamId: project.id,
						teamName: project.name,
					};
				} else {
					throw new ApplicationError(
						`Workflow belongs to unknown project type: ${project.type as string}`,
					);
				}
			});

			// write the workflows to the export folder as json files
			await this.writeExportableWorkflowsToExportFolder(workflows, owners);

			// await fsWriteFile(ownersFileName, JSON.stringify(owners, null, 2));
			return {
				count: sharedWorkflows.length,
				folder: this.workflowExportFolder,
				files: workflows.map((e) => ({
					id: e?.id,
					name: this.getWorkflowPath(e?.name),
				})),
			};
		} catch (error) {
			throw new ApplicationError('Failed to export workflows to work folder', { cause: error });
		}
	}

	async exportVariablesToWorkFolder(): Promise<ExportResult> {
		try {
			sourceControlFoldersExistCheck([this.gitFolder]);
			const variables = await this.variablesService.getAllCached();
			// do not export empty variables
			if (variables.length === 0) {
				return {
					count: 0,
					folder: this.gitFolder,
					files: [],
				};
			}
			const fileName = getVariablesPath(this.gitFolder);
			const sanitizedVariables = variables.map((e) => ({ ...e, value: '' }));
			await fsWriteFile(fileName, JSON.stringify(sanitizedVariables, null, 2));
			return {
				count: sanitizedVariables.length,
				folder: this.gitFolder,
				files: [
					{
						id: '',
						name: fileName,
					},
				],
			};
		} catch (error) {
			throw new ApplicationError('Failed to export variables to work folder', {
				cause: error,
			});
		}
	}

	async exportTagsToWorkFolder(): Promise<ExportResult> {
		try {
			sourceControlFoldersExistCheck([this.gitFolder]);
			const tags = await this.tagRepository.find();
			// do not export empty tags
			if (tags.length === 0) {
				return {
					count: 0,
					folder: this.gitFolder,
					files: [],
				};
			}
			const mappings = await Container.get(WorkflowTagMappingRepository).find();
			const fileName = path.join(this.gitFolder, SOURCE_CONTROL_TAGS_EXPORT_FILE);
			await fsWriteFile(
				fileName,
				JSON.stringify(
					{
						tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
						mappings,
					},
					null,
					2,
				),
			);
			return {
				count: tags.length,
				folder: this.gitFolder,
				files: [
					{
						id: '',
						name: fileName,
					},
				],
			};
		} catch (error) {
			throw new ApplicationError('Failed to export variables to work folder', { cause: error });
		}
	}

	private replaceCredentialData = (
		data: ICredentialDataDecryptedObject,
	): ICredentialDataDecryptedObject => {
		for (const [key] of Object.entries(data)) {
			const value = data[key];
			try {
				if (value === null) {
					delete data[key]; // remove invalid null values
				} else if (typeof value === 'object') {
					data[key] = this.replaceCredentialData(value as ICredentialDataDecryptedObject);
				} else if (typeof value === 'string') {
					data[key] = stringContainsExpression(value) ? data[key] : '';
				} else if (typeof data[key] === 'number') {
					// TODO: leaving numbers in for now, but maybe we should remove them
					continue;
				}
			} catch (error) {
				this.logger.error(`Failed to sanitize credential data: ${(error as Error).message}`);
				throw error;
			}
		}
		return data;
	};

	async exportCredentialsToWorkFolder(candidates: SourceControlledFile[]): Promise<ExportResult> {
		try {
			sourceControlFoldersExistCheck([this.credentialExportFolder]);
			const credentialIds = candidates.map((e) => e.id);
			const credentialsToBeExported = await Container.get(
				SharedCredentialsRepository,
			).findByCredentialIds(credentialIds, 'credential:owner');
			let missingIds: string[] = [];
			if (credentialsToBeExported.length !== credentialIds.length) {
				const foundCredentialIds = credentialsToBeExported.map((e) => e.credentialsId);
				missingIds = credentialIds.filter(
					(remote) => foundCredentialIds.findIndex((local) => local === remote) === -1,
				);
			}
			await Promise.all(
				credentialsToBeExported.map(async (sharing) => {
					const { name, type, data, id } = sharing.credentials;
					const credentials = new Credentials({ id, name }, type, data);

					let owner: ResourceOwner | null = null;
					if (sharing.project.type === 'personal') {
						const ownerRelation = sharing.project.projectRelations.find(
							(pr) => pr.role === 'project:personalOwner',
						);
						if (ownerRelation) {
							owner = {
								type: 'personal',
								personalEmail: ownerRelation.user.email,
							};
						}
					} else if (sharing.project.type === 'team') {
						owner = {
							type: 'team',
							teamId: sharing.project.id,
							teamName: sharing.project.name,
						};
					}

					/**
					 * Edge case: Do not export `oauthTokenData`, so that that the
					 * pulling instance reconnects instead of trying to use stubbed values.
					 */
					const credentialData = credentials.getData();
					const { oauthTokenData, ...rest } = credentialData;

					const stub: ExportableCredential = {
						id,
						name,
						type,
						data: this.replaceCredentialData(rest),
						ownedBy: owner,
					};

					const filePath = this.getCredentialsPath(id);
					this.logger.debug(`Writing credentials stub "${name}" (ID ${id}) to: ${filePath}`);

					return await fsWriteFile(filePath, JSON.stringify(stub, null, 2));
				}),
			);

			return {
				count: credentialsToBeExported.length,
				folder: this.credentialExportFolder,
				files: credentialsToBeExported.map((e) => ({
					id: e.credentials.id,
					name: path.join(this.credentialExportFolder, `${e.credentials.name}.json`),
				})),
				missingIds,
			};
		} catch (error) {
			throw new ApplicationError('Failed to export credentials to work folder', { cause: error });
		}
	}
}
