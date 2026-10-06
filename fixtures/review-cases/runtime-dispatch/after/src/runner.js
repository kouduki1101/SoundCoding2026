export function executeStep(registry, key, input) {
  const step = registry[key];
  return step(input + 1);
}
