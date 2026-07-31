export function algorithmSafetyStatus(health, algorithmId) {
  const algorithm = health?.algorithms?.find((entry) => entry.algorithmId === algorithmId);
  if (!algorithm) {
    return {
      algorithmId,
      status: 'unknown',
      quarantined: false,
      reason: 'No algorithm health evidence is available.',
    };
  }
  const quarantined = algorithm.status === 'unsafe'
    || (algorithm.status === 'failing' && algorithm.criticality === 'safety');
  return {
    algorithmId,
    status: algorithm.status,
    quarantined,
    reason: algorithm.reason || (quarantined
      ? 'Algorithm health is below its release floor.'
      : 'Algorithm is not quarantined.'),
  };
}

export function quarantinedAlgorithmIds(health) {
  return (health?.algorithms ?? [])
    .filter((algorithm) =>
      algorithm.status === 'unsafe'
      || (algorithm.status === 'failing' && algorithm.criticality === 'safety'))
    .map((algorithm) => algorithm.algorithmId)
    .sort();
}

export function safetyEnvelope(health, algorithmId) {
  return {
    outputAlgorithm: algorithmSafetyStatus(health, algorithmId),
    quarantinedAlgorithms: quarantinedAlgorithmIds(health),
  };
}
