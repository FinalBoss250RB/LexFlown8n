import { Service } from 'typedi';
import { DataSource, In, Repository } from '@n8n/typeorm';
import { ProjectRelation } from '../entities/ProjectRelation';

@Service()
export class ProjectRelationRepository extends Repository<ProjectRelation> {
	constructor(dataSource: DataSource) {
		super(ProjectRelation, dataSource.manager);
	}

	async getPersonalProjectOwners(projectIds: string[]) {
		return await this.find({
			where: {
				projectId: In(projectIds),
				role: 'project:personalOwner',
			},
			relations: ['user'],
		});
	}
}
