export interface GeminiModelCandidate {
  label: string;
  modelId?: string;
}

export type GeminiVersion = readonly number[];

const MIN_COMPATIBLE_GEMINI_VERSION: GeminiVersion = [3, 0];
const GEMINI_VERSION_PATTERN = /\bgemini[\s_-]+v?(\d+(?:[._-]\d+)*)(?![._-][._\d-])(?=$|[\s_(/-])/i;

export function parseGeminiVersion(name: string): GeminiVersion | undefined {
  const match = name.match(GEMINI_VERSION_PATTERN);
  if (!match) {
    return undefined;
  }

  const components = match[1].split(/[._-]/).map(Number);
  return components.every(Number.isSafeInteger) ? components : undefined;
}

export function compareGeminiVersions(a: GeminiVersion, b: GeminiVersion): number {
  const componentCount = Math.max(a.length, b.length);
  for (let index = 0; index < componentCount; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function isCompatibleGeminiVersion(version: GeminiVersion): boolean {
  return compareGeminiVersions(version, MIN_COMPATIBLE_GEMINI_VERSION) >= 0;
}

function getGeminiVersion(model: GeminiModelCandidate): GeminiVersion | undefined {
  let bestVersion: GeminiVersion | undefined;
  for (const name of [model.modelId, model.label]) {
    if (!name) {
      continue;
    }
    const version = parseGeminiVersion(name);
    if (version && (!bestVersion || compareGeminiVersions(version, bestVersion) > 0)) {
      bestVersion = version;
    }
  }
  return bestVersion;
}

export function shouldIncludeGeminiModel(model: GeminiModelCandidate): boolean {
  const version = getGeminiVersion(model);
  return version === undefined || isCompatibleGeminiVersion(version);
}

function matchesName(model: GeminiModelCandidate, parts: readonly string[]): boolean {
  return [model.label, model.modelId].some(name => {
    const lowerName = name?.toLowerCase();
    return lowerName !== undefined && parts.every(part => lowerName.includes(part));
  });
}

function selectLatestCompatible<T extends GeminiModelCandidate>(
  models: readonly T[],
  matches: (model: T) => boolean,
  getTierPriority: (model: T) => number = () => 0
): T | undefined {
  let latest: T | undefined;
  let latestVersion: GeminiVersion | undefined;
  let latestTierPriority = 0;
  let unknownVersionFallback: T | undefined;

  for (const model of models) {
    if (!matches(model)) {
      continue;
    }

    const version = getGeminiVersion(model);
    if (!version) {
      // Preserve API order for the fallback when no candidate has a usable version.
      unknownVersionFallback ??= model;
      continue;
    }
    if (!isCompatibleGeminiVersion(version)) {
      continue;
    }

    const versionComparison = latestVersion
      ? compareGeminiVersions(version, latestVersion)
      : 1;
    const tierPriority = getTierPriority(model);
    // Equal version and tier intentionally keep the first candidate in API order.
    if (versionComparison > 0 || (versionComparison === 0 && tierPriority > latestTierPriority)) {
      latest = model;
      latestVersion = version;
      latestTierPriority = tierPriority;
    }
  }

  return latest ?? unknownVersionFallback;
}

export function selectLatestGeminiFlash<T extends GeminiModelCandidate>(models: readonly T[]): T | undefined {
  return selectLatestCompatible(
    models,
    model => matchesName(model, ['gemini', 'flash']),
    model => {
      if (matchesName(model, ['high'])) {
        return 3;
      }
      if (matchesName(model, ['medium'])) {
        return 2;
      }
      return matchesName(model, ['low']) ? 1 : 0;
    }
  );
}

export function selectLatestGeminiProLow<T extends GeminiModelCandidate>(models: readonly T[]): T | undefined {
  return selectLatestCompatible(models, model =>
    matchesName(model, ['gemini', 'pro', 'low'])
  );
}
