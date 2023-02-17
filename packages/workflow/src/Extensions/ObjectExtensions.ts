import { ExpressionExtensionError } from '../ExpressionError';
import type { ExtensionMap } from './Extensions';

function isEmpty(value: object): boolean {
	return Object.keys(value).length === 0;
}

function isNotEmpty(value: object): boolean {
	return !isEmpty(value);
}

function hasField(value: object, extraArgs: string[]): boolean {
	const [name] = extraArgs;
	return name in value;
}

function removeField(value: object, extraArgs: string[]): object {
	const [name] = extraArgs;
	if (name in value) {
		const newObject = { ...value };
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
		delete (newObject as any)[name];
		return newObject;
	}
	return value;
}

function removeFieldsContaining(value: object, extraArgs: string[]): object {
	const [match] = extraArgs;
	if (typeof match !== 'string' || match === '') {
		throw new ExpressionExtensionError('removeFieldsContaining(): expected non-empty string arg');
	}
	const newObject = { ...value };
	for (const [key, val] of Object.entries(value)) {
		if (typeof val === 'string' && val.includes(match)) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
			delete (newObject as any)[key];
		}
	}
	return newObject;
}

function keepFieldsContaining(value: object, extraArgs: string[]): object {
	const [match] = extraArgs;
	if (typeof match !== 'string' || match === '') {
		throw new ExpressionExtensionError(
			'argument of keepFieldsContaining must be a non-empty string',
		);
	}
	const newObject = { ...value };
	for (const [key, val] of Object.entries(value)) {
		if (typeof val !== 'string' || (typeof val === 'string' && !val.includes(match))) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
			delete (newObject as any)[key];
		}
	}
	return newObject;
}

export function compact(value: object): object {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const newObj: any = {};
	for (const [key, val] of Object.entries(value)) {
		if (val !== null && val !== undefined && val !== 'nil' && val !== '') {
			if (typeof val === 'object') {
				if (Object.keys(val as object).length === 0) continue;
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
				newObj[key] = compact(val);
			} else {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
				newObj[key] = val;
			}
		}
	}
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return
	return newObj;
}

export function urlEncode(value: object) {
	return new URLSearchParams(value as Record<string, string>).toString();
}

isEmpty.doc = {
	name: 'isEmpty',
	description: 'Checks if the Object has no key-value pairs',
	returnType: 'boolean',
};

isNotEmpty.doc = {
	name: 'isNotEmpty',
	description: 'Checks if the Object has key-value pairs',
	returnType: 'boolean',
};

compact.doc = {
	name: 'compact',
	description: 'Removes empty values from an Object',
	returnType: 'boolean',
};

urlEncode.doc = {
	name: 'urlEncode',
	description: 'Transforms an Object into a URL parameter list. Only top-level keys are supported.',
	returnType: 'string',
};

hasField.doc = {
	name: 'hasField',
	description: 'Checks if the Object has a given field. Only top-level keys are supported.',
	returnType: 'boolean',
	args: [{ name: 'fieldName', type: 'string' }],
};

removeField.doc = {
	name: 'removeField',
	description: 'Removes a given field from the Object. Only top-level fields are supported.',
	returnType: 'object',
	args: [{ name: 'key', type: 'string' }],
};

removeFieldsContaining.doc = {
	name: 'removeFieldsContaining',
	description: 'Removes fields with a given value from the Object. Only top-level values are supported',
	returnType: 'object',
	args: [{ name: 'value', type: 'string' }],
};

keepFieldsContaining.doc = {
	name: 'keepFieldsContaining',
	description: 'Removes fields that do not match the given value from the Object.',
	returnType: 'object',
	args: [{ name: 'value', type: 'string' }],
};

export const objectExtensions: ExtensionMap = {
	typeName: 'Object',
	functions: {
		isEmpty,
		isNotEmpty,
		hasField,
		removeField,
		removeFieldsContaining,
		keepFieldsContaining,
		compact,
		urlEncode,
	},
};
