import { CONFIG_BINARY_DATA_MODES } from './utils';

export class InvalidModeError extends Error {
	message = `Invalid binary data mode. Valid modes: ${CONFIG_BINARY_DATA_MODES.join(', ')}`;
}

export class UnknownManagerError extends Error {
	constructor(mode: string) {
		super(`No binary data manager found for: ${mode}`);
	}
}
