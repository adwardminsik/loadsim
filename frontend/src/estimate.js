// 선택한 오더들의 적재율을 단순 합산해 대략적인 컨테이너별 적재율을 추정합니다. (정확한 값이 아닙니다)
//  - 컨테이너 종류가 다르면 합치지 않고 종류별로 따로 보여 줍니다.
//  - 같은 종류에서 모든 오더가 컨테이너 1대면 적재율을 그대로 더합니다(100%를 넘으면 넘는 대로 표시).
//  - 컨테이너가 2대 이상인 오더가 있으면 N번째 컨테이너끼리 더하고, 100%를 넘는 만큼은 다음 컨테이너로 넘깁니다.
//    마지막 컨테이너가 100%를 넘으면 넘는 대로 표시합니다.
const TYPE_RANK = { CONTAINER_20FT: 1, CONTAINER_40FT: 2, CONTAINER_40HC: 3 };

/** orders: [{ run: { status, containerType, rate, rates } }] → { groups: [{ type, slots: number[] }], excluded } */
export function estimateLoad(orders) {
  const byType = new Map();
  let excluded = 0;
  orders.forEach((o) => {
    const r = o.run;
    if (!r || r.status !== 'COMPLETED' || !r.containerType) {
      excluded += 1; // 적재 결과가 없는 오더는 계산에서 뺍니다
      return;
    }
    const rates = r.rates?.length ? r.rates : [r.rate];
    if (!byType.has(r.containerType)) byType.set(r.containerType, []);
    byType.get(r.containerType).push(rates);
  });

  const groups = [...byType.entries()]
    .sort((a, b) => (TYPE_RANK[a[0]] || 9) - (TYPE_RANK[b[0]] || 9))
    .map(([type, list]) => {
      const n = Math.max(...list.map((x) => x.length));
      const slots = Array.from({ length: n }, (_, i) => list.reduce((s, x) => s + (x[i] || 0), 0));
      for (let i = 0; i < n - 1; i += 1) {
        if (slots[i] > 100) {
          slots[i + 1] += slots[i] - 100;
          slots[i] = 100;
        }
      }
      return { type, slots };
    });
  return { groups, excluded };
}
