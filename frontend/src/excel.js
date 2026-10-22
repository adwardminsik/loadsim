import { readSheet } from 'read-excel-file/browser';

// 오더리스트 양식: 1행 헤더, A=번호(미사용) / B=품번 / C=수량  (API 명세 46번과 동일)
// 브라우저에서 미리보기용으로만 읽고, 실제 등록은 원본 파일을 백엔드에 올려서 처리합니다.
export async function parseOrderExcel(file) {
  const rows = await readSheet(file);
  const parsed = [];
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2; // 엑셀 행 번호
    const partNo = r[1] == null ? '' : String(r[1]).trim();
    const rawQty = r[2];
    if (!partNo && (rawQty == null || rawQty === '')) return; // 완전히 빈 행은 건너뜀

    const qty = typeof rawQty === 'number' ? rawQty : Number(String(rawQty ?? '').replace(/,/g, '').trim());
    let error = null;
    if (!partNo) error = '품번 없음';
    else if (!Number.isInteger(qty) || qty <= 0) error = '수량 오류';
    parsed.push({ row: rowNo, partNo, quantity: Number.isFinite(qty) ? qty : null, error });
  });
  return parsed;
}
