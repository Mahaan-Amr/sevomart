export function domIdPart(clientKey: string) {
  return encodeURIComponent(clientKey);
}

export function axisValueErrorId(axisClientKey: string, valueClientKey: string) {
  return `axis-value-error-${domIdPart(axisClientKey)}-${domIdPart(valueClientKey)}`;
}
