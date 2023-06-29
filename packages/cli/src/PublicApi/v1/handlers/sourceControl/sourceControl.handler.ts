import type express from 'express';
import type { StatusResult } from 'simple-git';
import type { PublicSourceControlRequest } from '../../../types';
import { authorize } from '../../shared/middlewares/global.middleware';
import type { ImportResult } from '@/environments/sourceControl/types/importResult';
import Container from 'typedi';
import { SourceControlService } from '@/environments/sourceControl/sourceControl.service.ee';
import { SourceControlPreferencesService } from '@/environments/sourceControl/sourceControlPreferences.service.ee';
import {
	getTrackingInformationFromSourceControlledFiles,
	isSourceControlLicensed,
} from '@/environments/sourceControl/sourceControlHelper.ee';
import { InternalHooks } from '@/InternalHooks';

export = {
	pull: [
		authorize(['owner', 'member']),
		async (
			req: PublicSourceControlRequest.Pull,
			res: express.Response,
		): Promise<ImportResult | StatusResult | Promise<express.Response>> => {
			const sourceControlPreferencesService = Container.get(SourceControlPreferencesService);
			if (!isSourceControlLicensed()) {
				return res
					.status(401)
					.json({ status: 'Error', message: 'Source Control feature is not licensed' });
			}
			if (!sourceControlPreferencesService.isSourceControlConnected()) {
				return res
					.status(400)
					.json({ status: 'Error', message: 'Source Control is not connected to a repository' });
			}
			try {
				const sourceControlService = Container.get(SourceControlService);
				const result = await sourceControlService.pullWorkfolder({
					force: req.body.force,
					variables: req.body.variables,
					userId: req.user.id,
					importAfterPull: true,
				});

				if (result.status === 200) {
					await Container.get(InternalHooks).onSourceControlUserPulledAPI({
						...getTrackingInformationFromSourceControlledFiles(result.diffResult),
						forced: req.body.force ?? false,
					});
					return res.status(200).send(result.diffResult);
				} else {
					return res.status(409).send(result.diffResult);
				}
			} catch (error) {
				return res.status(400).send((error as { message: string }).message);
			}
		},
	],
};
