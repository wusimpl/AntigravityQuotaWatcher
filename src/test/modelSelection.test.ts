import { strict as assert } from 'node:assert';
import Module = require('node:module');
import { test } from 'node:test';
import {
  compareGeminiVersions,
  parseGeminiVersion,
  selectLatestGeminiFlash,
  selectLatestGeminiProLow,
  shouldIncludeGeminiModel,
} from '../geminiModelSelection';

interface ModelFixture {
  label: string;
  modelId: string;
}

type GoogleCloudCodeClientModule = typeof import('../api/googleCloudCodeClient');

interface CommonJsModuleLoader {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
}

function model(label: string, modelId: string): ModelFixture {
  return { label, modelId };
}

const flash35High = model('Gemini 3.5 Flash (High)', 'gemini-3-flash-agent');
const flash35Medium = model('Gemini 3.5 Flash (Medium)', 'gemini-3.5-flash-low');
const flash35Low = model('Gemini 3.5 Flash (Low)', 'gemini-3.5-flash-extra-low');

function loadGoogleCloudCodeClient(): GoogleCloudCodeClientModule {
  const loader = Module as unknown as CommonJsModuleLoader;
  const originalLoad = loader._load;

  loader._load = (request, parent, isMain) => {
    if (request === 'vscode') {
      return {
        workspace: {
          getConfiguration: () => ({
            get: (_key: string, fallback: unknown) => fallback === 'DEBUG' ? 'ERROR' : fallback,
          }),
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    return Module.createRequire(__filename)('../api/googleCloudCodeClient') as GoogleCloudCodeClientModule;
  } finally {
    loader._load = originalLoad;
  }
}

const { GoogleCloudCodeClient } = loadGoogleCloudCodeClient();

test('parses and compares numeric Gemini versions', () => {
  assert.deepEqual(parseGeminiVersion('gemini-3.0-flash'), [3, 0]);
  assert.deepEqual(parseGeminiVersion('Gemini 3.1 Pro (Low)'), [3, 1]);
  assert.deepEqual(parseGeminiVersion('gemini-3-5-flash-high'), [3, 5]);
  assert.equal(parseGeminiVersion('Gemini 3..5 Flash'), undefined);
  assert.equal(parseGeminiVersion('Gemini next Flash'), undefined);

  const versionThreeTen = parseGeminiVersion('gemini-3.10-flash');
  const versionThreeFive = parseGeminiVersion('gemini-3.5-flash');
  assert.ok(versionThreeTen);
  assert.ok(versionThreeFive);
  assert.ok(compareGeminiVersions(versionThreeTen, versionThreeFive) > 0);
});

test('uses the best version from the alias and display label', () => {
  const flash30 = model('Gemini 3.0 Flash (High)', 'gemini-3-flash-preview');
  const flash31 = model('Gemini 3.1 Flash (High)', 'gemini-3.1-flash-preview');
  const unknown = model('Gemini Flash Experimental (High)', 'gemini-flash-experimental');

  assert.equal(selectLatestGeminiFlash([flash31, unknown, flash30, flash35High]), flash35High);
  assert.equal(selectLatestGeminiFlash([flash35High, flash30, flash31, unknown]), flash35High);
});

test('selects only the newest Pro Low model', () => {
  const proLow30 = model('Gemini 3.0 Pro (Low)', 'gemini-3-pro-preview');
  const proLow31 = model('Gemini 3.1 Pro (Low)', 'gemini-3-pro-preview');
  const proHigh35 = model('Gemini 3.5 Pro (High)', 'gemini-3-pro-preview');

  assert.equal(selectLatestGeminiProLow([proLow30, proHigh35, proLow31]), proLow31);
  assert.equal(selectLatestGeminiProLow([proLow31, proLow30, proHigh35]), proLow31);
});

test('prefers the observed High, Medium, and Low aliases in tier order', () => {
  const flash35Untiered = model('Gemini 3.5 Flash', 'gemini-3-flash-agent');
  const flash31 = model('Gemini 3.1 Flash (High)', 'gemini-3.1-flash-preview');

  assert.equal(selectLatestGeminiFlash([flash35Low, flash35Medium, flash35High, flash31]), flash35High);
  assert.equal(selectLatestGeminiFlash([flash35High, flash35Medium, flash35Low, flash31]), flash35High);
  assert.equal(selectLatestGeminiFlash([flash35Low, flash35Medium]), flash35Medium);
  assert.equal(selectLatestGeminiFlash([flash35Low]), flash35Low);
  assert.equal(selectLatestGeminiFlash([flash35Untiered, flash35Medium]), flash35Medium);
});

test('keeps first-seen candidates for exact ties and unknown-version fallback', () => {
  const duplicateHigh = model(flash35High.label, flash35High.modelId);
  const malformedFlash = model('Gemini 3..5 Flash (Medium)', 'gemini-3..5-flash-agent');
  const unknownFlash = model('Gemini Flash Experimental (High)', 'gemini-flash-experimental');
  const unknownProLow = model('Gemini Pro (Low)', 'gemini-pro-low');
  const legacyFlash = model('Gemini 2.5 Flash', 'gemini-2.5-flash');

  assert.equal(selectLatestGeminiFlash([flash35High, duplicateHigh]), flash35High);
  assert.equal(selectLatestGeminiFlash([duplicateHigh, flash35High]), duplicateHigh);
  assert.equal(selectLatestGeminiFlash([malformedFlash, unknownFlash]), malformedFlash);
  assert.equal(selectLatestGeminiFlash([unknownFlash, malformedFlash]), unknownFlash);
  assert.equal(selectLatestGeminiProLow([unknownProLow]), unknownProLow);
  assert.equal(selectLatestGeminiFlash([legacyFlash]), undefined);
});

test('extracts observed Google API models before selecting the Flash tier', async () => {
  const responseFixture = {
    models: {
      'gemini-3.5-flash-extra-low': {
        displayName: 'Gemini 3.5 Flash (Low)',
        quotaInfo: {
          remainingFraction: 0.25,
          resetTime: '2026-07-14T01:00:00.000Z',
        },
      },
      'gemini-3.5-flash-low': {
        displayName: 'Gemini 3.5 Flash (Medium)',
        quotaInfo: {
          remainingFraction: 0.5,
          resetTime: '2026-07-14T02:00:00.000Z',
        },
      },
      'gemini-3-flash-agent': {
        displayName: 'Gemini 3.5 Flash (High)',
        quotaInfo: {
          remainingFraction: 0.75,
          resetTime: '2026-07-14T03:00:00.000Z',
        },
      },
    },
  };
  const client = GoogleCloudCodeClient.getInstance();
  const requestTarget = client as unknown as {
    makeApiRequest(path: string, accessToken: string, body: object): Promise<unknown>;
  };
  const originalRequest = requestTarget.makeApiRequest;
  requestTarget.makeApiRequest = async () => responseFixture;

  try {
    const response = await client.fetchModelsQuota('fixture-token', 'fixture-project');
    assert.deepEqual(
      response.models.map(({ modelName, displayName, remainingQuota }) => ({
        modelName,
        displayName,
        remainingQuota,
      })),
      [
        {
          modelName: 'gemini-3.5-flash-extra-low',
          displayName: 'Gemini 3.5 Flash (Low)',
          remainingQuota: 0.25,
        },
        {
          modelName: 'gemini-3.5-flash-low',
          displayName: 'Gemini 3.5 Flash (Medium)',
          remainingQuota: 0.5,
        },
        {
          modelName: 'gemini-3-flash-agent',
          displayName: 'Gemini 3.5 Flash (High)',
          remainingQuota: 0.75,
        },
      ]
    );

    const extractedCandidates = response.models.map(extracted => model(
      extracted.displayName,
      extracted.modelName
    ));
    assert.equal(selectLatestGeminiFlash(extractedCandidates)?.modelId, 'gemini-3-flash-agent');
    assert.equal(
      selectLatestGeminiFlash(extractedCandidates.filter(candidate => candidate.modelId !== 'gemini-3-flash-agent'))?.modelId,
      'gemini-3.5-flash-low'
    );
    assert.equal(
      selectLatestGeminiFlash(extractedCandidates.filter(candidate => candidate.modelId.endsWith('extra-low')))?.modelId,
      'gemini-3.5-flash-extra-low'
    );
  } finally {
    requestTarget.makeApiRequest = originalRequest;
  }
});

test('keeps unknown Gemini aliases eligible for Google API fallback', () => {
  assert.equal(shouldIncludeGeminiModel(flash35High), true);
  assert.equal(shouldIncludeGeminiModel(model('Gemini Flash Experimental', 'MODEL_PLACEHOLDER_M47')), true);
  assert.equal(shouldIncludeGeminiModel(model('Gemini 3..5 Flash', 'gemini-3..5-flash-agent')), true);
  assert.equal(shouldIncludeGeminiModel(model('Gemini 3.5 Flash', 'gemini-2.5-flash')), true);
  assert.equal(shouldIncludeGeminiModel(model('Gemini 2.5 Flash', 'gemini-2.5-flash')), false);
});
