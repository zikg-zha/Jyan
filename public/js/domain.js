/** 前端领域常量（与 supabase/schema.sql 中的规则保持一致） */

export const META = {
  categories: ['荤菜', '素菜', '汤', '主食', '凉菜'],
  difficulties: ['简单', '中等', '困难'],
  flow: ['已接单', '采购中', '准备中', '烹饪中', '已完成'],
  statuses: ['待接单', '已接单', '采购中', '准备中', '烹饪中', '已完成', '已取消'],
  segments: ['进行中', '已完成', '已取消'],
  meal_times: ['今天午饭', '今天晚饭', '明天午饭', '明天晚饭', '周末午饭', '周末晚饭'],
  pending: '待接单',
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};

export function toDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 用餐时间文案 → 本地日期 YYYY-MM-DD */
export function resolveMealDate(mealTime, now = new Date()) {
  const d = new Date(now.getTime());
  const text = String(mealTime || '');
  if (text.includes('明天')) d.setDate(d.getDate() + 1);
  else if (text.includes('后天')) d.setDate(d.getDate() + 2);
  else if (text.includes('周末')) {
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 6 || day === 0 ? 0 : 6 - day));
  }
  return toDateStr(d);
}
