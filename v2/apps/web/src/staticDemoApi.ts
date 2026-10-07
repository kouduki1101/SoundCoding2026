type StaticAsset = { filename: string };

const samples = new Set(['recorded-returns-before', 'recorded-returns-after']);
const unitIdPattern = /^unit_[a-f0-9]{16}$/;

export function staticDemoAsset(path: string): StaticAsset | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('#')) return null;
  const url = new URL(path, 'https://static-demo.invalid');
  if (url.pathname === '/config' && !url.search) return { filename: 'config.json' };

  const sampleRoute = url.pathname.match(/^\/samples\/([^/]+)\/(bundle|relationships|structure)$/);
  const isComparisonDemo = url.pathname === '/comparison-demo/structure';
  if (!sampleRoute && !isComparisonDemo) return null;
  const sampleId = sampleRoute?.[1] ?? 'comparison-demo';
  const kind = sampleRoute?.[2] ?? 'structure';
  if (sampleRoute && !samples.has(sampleId)) return null;

  if (kind === 'bundle' && !url.search) return { filename: `${sampleId}.bundle.json` };
  if (kind === 'relationships') {
    const unitId = url.searchParams.get('unit_id');
    if (url.searchParams.size !== 1 || !unitId || !unitIdPattern.test(unitId)) return null;
    return { filename: `${sampleId}.relationships.${unitId}.json` };
  }
  if (kind !== 'structure') return null;
  if (!url.search) return { filename: `${sampleId}.structure.json` };
  const unitA = url.searchParams.get('unit_a');
  const unitB = url.searchParams.get('unit_b');
  const markers = url.searchParams.get('markers');
  if (
    url.searchParams.size !== 3 ||
    !unitA ||
    !unitB ||
    !unitIdPattern.test(unitA) ||
    !unitIdPattern.test(unitB) ||
    unitA === unitB ||
    (markers !== 'true' && markers !== 'false')
  )
    return null;
  return {
    filename: `${sampleId}.structure.${unitA}.${unitB}.${markers === 'true' ? '1' : '0'}.json`,
  };
}

export async function staticDemoApi<T>(path: string, body?: unknown, method?: string): Promise<T> {
  if (body !== undefined || (method ?? 'GET').toUpperCase() !== 'GET') {
    throw new Error('公開デモでは保存済みの結果だけを閲覧できます。');
  }
  const asset = staticDemoAsset(path);
  if (!asset) throw new Error('この公開デモには保存済みデータがありません。');
  const response = await fetch(`${import.meta.env.BASE_URL}demo-data/${asset.filename}`);
  if (!response.ok) throw new Error('保存済みデータを読み込めませんでした。');
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('保存済みデータの形式を確認できませんでした。');
  }
  if (!result || typeof result !== 'object' || !('data' in result)) {
    throw new Error('保存済みデータの形式を確認できませんでした。');
  }
  return (result as { data: T }).data;
}
