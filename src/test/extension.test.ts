import * as assert from 'assert';
import * as vscode from 'vscode';
import { dedupeReferenceLocations } from '../extension';

suite('Extension Test Suite', () => {
	test('dedupeReferenceLocations removes duplicate references', () => {
		const uri = vscode.Uri.file('sample.cpp');
		const firstLocation = new vscode.Location(uri, new vscode.Range(10, 4, 10, 11));
		const duplicateLocation = new vscode.Location(uri, new vscode.Range(10, 4, 10, 11));
		const secondLocation = new vscode.Location(uri, new vscode.Range(14, 2, 14, 9));

		const uniqueLocations = dedupeReferenceLocations([firstLocation, duplicateLocation, secondLocation]);

		assert.deepStrictEqual(uniqueLocations, [firstLocation, secondLocation]);
	});

	test('dedupeReferenceLocations keeps distinct references on the same line', () => {
		const uri = vscode.Uri.file('sample.cpp');
		const firstLocation = new vscode.Location(uri, new vscode.Range(10, 4, 10, 11));
		const secondLocation = new vscode.Location(uri, new vscode.Range(10, 18, 10, 25));

		const uniqueLocations = dedupeReferenceLocations([firstLocation, secondLocation]);

		assert.deepStrictEqual(uniqueLocations, [firstLocation, secondLocation]);
	});

	test('dedupeReferenceLocations preserves the first occurrence of each location', () => {
		const uri = vscode.Uri.file('sample.cpp');
		const firstLocation = new vscode.Location(uri, new vscode.Range(10, 4, 10, 11));
		const secondLocation = new vscode.Location(uri, new vscode.Range(14, 2, 14, 9));
		const duplicateFirstLocation = new vscode.Location(uri, new vscode.Range(10, 4, 10, 11));

		const uniqueLocations = dedupeReferenceLocations([firstLocation, secondLocation, duplicateFirstLocation]);

		assert.deepStrictEqual(uniqueLocations, [firstLocation, secondLocation]);
	});
});
